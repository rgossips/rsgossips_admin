import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { CampaignsTable } from "./campaigns-table";
import { CampaignFilters } from "./campaign-filters";
import { applicationsClosedBefore } from "@/lib/campaign-deadline";
import { RefreshButton } from "@/components/refresh-button";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { sanitizeSearchTerm } from "@/lib/validation";
import { BrandTypeFilter } from "@/components/brand-type-filter";
import { BRAND_TYPE_PARAM, brandTypeFilter } from "@/lib/brand-account-type";
import { applySort, compareBy, resolveSort, type SortOption } from "@/lib/sorting";
import { FilterBar } from "@/components/filter-bar";
import { requiredGender } from "@/lib/gender-target";

const BASE = "/dashboard/campaigns";

// The campaign trailer holds the brief's own fields (see CLAUDE.md,
// "Description / notes trailer metadata"). PostgREST cannot filter inside a
// JSON tail in a text column, so these three are filtered IN MEMORY after
// the query — safe here because this page loads the whole filtered set
// rather than a page of it, and the result count is taken afterwards.
const CAMPAIGN_TRAILER = "\n\n---\n";
function parseTrailer(description: string | null | undefined): Record<string, unknown> {
  const raw = String(description || "");
  const at = raw.indexOf(CAMPAIGN_TRAILER);
  const json = at !== -1 ? raw.slice(at + CAMPAIGN_TRAILER.length) : raw.trimStart().startsWith("{") ? raw : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Values measured on the live table, so every option has rows behind it:
// campaign_type barter 53 / paid 14 / hybrid 8; offering_type product 52 /
// service 23; shipping_required yes 31 / no 23; target_gender Any 26 /
// Female 9 / Male 6. Deliberately NOT offered: `platforms` (Instagram on all
// 75) and `target_cities` (All India on 74) — a filter whose every row gives
// the same answer is noise.
const CAMPAIGN_TYPES = ["barter", "paid", "hybrid"] as const;
const OFFERING_TYPES = ["product", "service"] as const;
const SHIPPING_MODES = ["yes", "no", "pickup"] as const;
const GENDER_BRIEFS = ["any", "male", "female"] as const;
// Lower bound of the band a campaign asks for, which is how briefs are
// actually written ("10k+ creators").
const FOLLOWER_FLOORS = ["0", "1000", "5000", "10000", "100000"] as const;

// `brand` is derived — the name comes from brand_profiles OR brand_invitations
// depending on who owns the campaign — so it is sorted in memory. Everything
// else is a real column and goes to PostgREST.
function campaignSorts(label: (k: string) => string): SortOption[] {
  return [
    { key: "created", column: "created_at", label: label("created"), defaultDir: "desc" },
    { key: "title", column: "title", label: label("title"), defaultDir: "asc" },
    { key: "brand", column: "created_at", label: label("brand"), defaultDir: "asc" },
    { key: "status", column: "status", label: label("status"), defaultDir: "asc" },
    { key: "slots", column: "max_influencers", label: label("slots"), defaultDir: "desc", nullsLast: true },
    { key: "start", column: "campaign_start_date", label: label("start"), defaultDir: "desc", nullsLast: true },
    { key: "deadline", column: "application_deadline", label: label("deadline"), defaultDir: "asc", nullsLast: true },
  ];
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const { search, status, category } = params;
  // Each validated against its allowlist before it can reach a query or a
  // comparison — same rule as the sort keys.
  const ctype = (CAMPAIGN_TYPES as readonly string[]).includes(params.ctype || "") ? params.ctype! : "";
  const offering = (OFFERING_TYPES as readonly string[]).includes(params.offering || "") ? params.offering! : "";
  const shipping = (SHIPPING_MODES as readonly string[]).includes(params.shipping || "") ? params.shipping! : "";
  const cgender = (GENDER_BRIEFS as readonly string[]).includes(params.cgender || "") ? params.cgender! : "";
  const fmin = (FOLLOWER_FLOORS as readonly string[]).includes(params.fmin || "") ? params.fmin! : "";
  const accountType = brandTypeFilter(params[BRAND_TYPE_PARAM]);
  const t = await getTranslations("DashboardCampaigns");
  const supabase = createAdminClient();
  const canWrite = await isAdminOrAbove();
  const searchTerm = sanitizeSearchTerm(search);

  const SORTS = campaignSorts((k) => t(`sort.${k}`));
  // `created` is the fallback, so a page with no ?sort keeps the
  // newest-first order it had before sorting existed.
  const sort = resolveSort(params.sort, SORTS, "created");

  let query = supabase
    .from("campaigns")
    // `description` is read ONLY to filter on the brief fields packed into
    // its trailer, and is stripped before the rows reach the client
    // component — the prose and base64-ish image URLs in there would
    // several times over outweigh the rest of the payload. Same shape as the
    // influencer list selecting instagram_access_token purely to derive a
    // status from it.
    .select("campaign_id, title, status, max_influencers, campaign_start_date, campaign_end_date, application_deadline, target_categories, brand_id, brand_invitation_id, created_by_admin, description, brand_profiles(brand_name), brand_invitations(brand_name)");
  query = applySort(query, sort);

  if (searchTerm) {
    query = query.ilike("title", `%${searchTerm}%`);
  }
  // Both branches share ONE cutoff with the badge — see lib/campaign-deadline.ts.
  const closedBefore = applicationsClosedBefore();
  if (status === "apps_closed") {
    // "Applications Closed" isn't a DB status — it's active campaigns whose
    // application window has lapsed. `.lt` on a timestamp excludes NULL
    // deadlines, which is right: no deadline means the window never closes.
    query = query.eq("status", "active").lt("application_deadline", closedBefore);
  } else if (status === "active") {
    // ...and because the dropdown offers that as a SIBLING of Active, Active
    // has to exclude it. Otherwise picking Active listed the closed ones too
    // (they are `status = 'active'` in the DB) and the rows came back wearing
    // an "Applications Closed" badge — 70 of 75 of them.
    query = query
      .eq("status", "active")
      .or(`application_deadline.is.null,application_deadline.gte.${closedBefore}`);
  } else if (status) {
    query = query.eq("status", status);
  }
  if (category) {
    const cats = category.split(",").filter(Boolean);
    if (cats.length > 0) {
      query = query.contains("target_categories", cats);
    }
  }
  // Real columns, so these narrow the query rather than the result.
  if (ctype) query = query.eq("campaign_type", ctype);
  if (fmin) query = query.gte("target_follower_min", Number(fmin));

  // Brand / agency (migration 075). A campaign is owned by a registered brand
  // (brand_id) or, for admin-created ones, an invitation (brand_invitation_id)
  // — so it counts as an agency's when either owner is labelled agency.
  // Filtering on the agency id lists keeps the URL short: agencies are the
  // minority, and "brand" is expressed as "neither owner is an agency".
  if (accountType) {
    const [agencyProfiles, agencyInvites] = await Promise.all([
      supabase.from("brand_profiles").select("brand_id").eq("account_type", "agency"),
      supabase.from("brand_invitations").select("id").eq("account_type", "agency"),
    ]);
    const profileIds = (agencyProfiles.data || []).map((r) => r.brand_id as string);
    const inviteIds = (agencyInvites.data || []).map((r) => r.id as string);
    if (accountType === "agency") {
      const clauses = [
        ...(profileIds.length ? [`brand_id.in.(${profileIds.join(",")})`] : []),
        ...(inviteIds.length ? [`brand_invitation_id.in.(${inviteIds.join(",")})`] : []),
      ];
      // No agencies labelled yet → nothing matches.
      query = clauses.length ? query.or(clauses.join(",")) : query.eq("campaign_id", "00000000-0000-0000-0000-000000000000");
    } else {
      if (profileIds.length) query = query.or(`brand_id.is.null,brand_id.not.in.(${profileIds.join(",")})`);
      if (inviteIds.length) query = query.or(`brand_invitation_id.is.null,brand_invitation_id.not.in.(${inviteIds.join(",")})`);
    }
  }

  const { data: campaigns, error } = await query;

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let rows = (campaigns as any[]) ?? [];

  // The three brief fields that live in the trailer. Applied BEFORE the
  // count below, so "12 campaigns" always matches the rows on screen.
  if (offering || shipping || cgender) {
    rows = rows.filter((c) => {
      const meta = parseTrailer(c.description);
      if (offering && String(meta.offering_type || "") !== offering) return false;
      if (shipping && String(meta.shipping_required || "") !== shipping) return false;
      if (cgender) {
        // requiredGender() is the single owner of what a brief restricts
        // (lib/gender-target.ts) — null means it names no one gender, which
        // is what "Open to all" asks for.
        const req = requiredGender(meta.target_gender);
        if (cgender === "any" ? req !== null : req !== cgender) return false;
      }
      return true;
    });
  }
  // The brand name lives on one of two embedded resources, so PostgREST
  // cannot order by it. Sorted here instead; this page loads the whole
  // filtered set rather than a page of it, so nothing is missed.
  if (sort.key === "brand") {
    rows = compareBy(
      rows,
      (c) => c.brand_profiles?.brand_name || c.brand_invitations?.brand_name || "",
      sort.ascending,
    );
  }
  const briefFilterFields = [
    { name: "ctype", label: t("filter.allTypes"), type: "select" as const, options: CAMPAIGN_TYPES.map((v) => ({ label: t(`filter.type.${v}`), value: v })) },
    { name: "offering", label: t("filter.allOfferings"), type: "select" as const, options: OFFERING_TYPES.map((v) => ({ label: t(`filter.offering.${v}`), value: v })) },
    { name: "shipping", label: t("filter.allShipping"), type: "select" as const, options: SHIPPING_MODES.map((v) => ({ label: t(`filter.shipping.${v}`), value: v })) },
    { name: "cgender", label: t("filter.allGenders"), type: "select" as const, options: GENDER_BRIEFS.map((v) => ({ label: t(`filter.gender.${v}`), value: v })) },
    { name: "fmin", label: t("filter.allFollowers"), type: "select" as const, options: FOLLOWER_FLOORS.map((v) => ({ label: t(`filter.followers.${v}`), value: v })) },
  ];

  const totalCount = rows.length;

  // Drop the description now that every filter and sort that needed it has
  // run. Nothing downstream reads it, and it is the biggest field on the row.
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const tableRows = rows.map(({ description: _description, ...rest }) => rest);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          {canWrite && (
            <Link
              href="/dashboard/campaigns/create"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-200/50 dark:shadow-indigo-900/30"
            >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
              {t("newCampaign")}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <CampaignFilters />
      <div className="-mt-2">
        <BrandTypeFilter />
      </div>
      {/* The brief's own fields. A FilterBar row rather than more controls
          inside CampaignFilters' drawer, which holds draft state and applies
          on confirm — these read straight from the URL like every other
          page's filters. */}
      <FilterBar fields={briefFilterFields} />

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          {t("loadError", { message: error.message })}
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
          {t("count", { count: totalCount })}
        </span>
      </div>

      {/* Table — checkboxes + bulk delete appear for super admins only */}
      <CampaignsTable campaigns={tableRows} sortOptions={SORTS} sort={sort} params={params} basePath={BASE} />
    </div>
  );
}
