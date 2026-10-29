import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { CampaignsTable } from "./campaigns-table";
import { CampaignFilters } from "./campaign-filters";
import { RefreshButton } from "@/components/refresh-button";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { sanitizeSearchTerm } from "@/lib/validation";
import { BrandTypeFilter } from "@/components/brand-type-filter";
import { BRAND_TYPE_PARAM, brandTypeFilter } from "@/lib/brand-account-type";
import { applySort, compareBy, resolveSort, type SortOption } from "@/lib/sorting";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { requiredGender } from "@/lib/gender-target";
import { applyStatusFilter, resolveStatusFilter } from "./campaign-status-filter";

const BASE = "/dashboard/campaigns";

const PAGE_SIZE = 20;

// Upper bound on the in-memory path's scan (see `needsScan` below). PostgREST
// will not return more than 1000 rows in one response anyway, so this is both
// the cap and the honest ceiling: past 1000 matching campaigns the brief
// filters and the brand sort would describe only the first 1000 of them. 79
// campaigns exist today, so there is 12x headroom — but an unbounded fetch
// behind a filter chip is how a page dies quietly in two years.
const BRIEF_SCAN_CAP = 1000;

// The campaign trailer holds the brief's own fields (see CLAUDE.md,
// "Description / notes trailer metadata"). PostgREST cannot filter inside a
// JSON tail in a text column, so these three are filtered IN MEMORY — which
// is why they force the scanning path rather than a server-side page.
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
//
// EVERY option carries the same tiebreak, and it is load-bearing now that the
// list is paged: PostgREST guarantees no order within equal values, so a page
// boundary that falls inside a tie shows a row twice or never. These columns
// tie heavily — `status` has three distinct values across 79 rows, and
// `slots`/`budget` repeat across a brand's campaigns. `campaign_id` is the
// primary key, so one tiebreak settles all of them.
const TIEBREAK = { column: "campaign_id", ascending: true } as const;

function campaignSorts(label: (k: string) => string): SortOption[] {
  return [
    { key: "created", column: "created_at", label: label("created"), defaultDir: "desc", tiebreak: TIEBREAK },
    { key: "title", column: "title", label: label("title"), defaultDir: "asc", tiebreak: TIEBREAK },
    { key: "brand", column: "created_at", label: label("brand"), defaultDir: "asc", tiebreak: TIEBREAK },
    { key: "status", column: "status", label: label("status"), defaultDir: "asc", tiebreak: TIEBREAK },
    { key: "slots", column: "max_influencers", label: label("slots"), defaultDir: "desc", nullsLast: true, tiebreak: TIEBREAK },
    // Biggest first on the first click — the reason to sort by budget is to
    // find the campaigns with money in them. nullsLast is belt and braces:
    // every row carries a value today, but a future insert need not.
    { key: "budget", column: "budget_total", label: label("budget"), defaultDir: "desc", nullsLast: true, tiebreak: TIEBREAK },
    { key: "start", column: "campaign_start_date", label: label("start"), defaultDir: "desc", nullsLast: true, tiebreak: TIEBREAK },
    { key: "deadline", column: "application_deadline", label: label("deadline"), defaultDir: "asc", nullsLast: true, tiebreak: TIEBREAK },
  ];
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const { search, category } = params;
  // Absent means the default (Active), never "every status" — see
  // campaign-status-filter.ts for why that is its own value.
  const statusFilter = resolveStatusFilter(params.status);
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);
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

  // WHY THIS BRANCHES. Three of the filters below read the brief's JSON
  // trailer and one of the sorts reads an embedded brand name, and PostgREST
  // can evaluate neither — so those have to see the whole matching set to
  // filter or order it. Asking the database for one page of 20 first and then
  // applying them would filter WITHIN that page: 20 rows in, 3 out, page 2
  // showing 7, and a total that disagrees with the rows under it. So the
  // ordinary path takes a server-side `.range()`, and the derived path scans
  // (capped) and pages in memory. Same shape as the errors list's "our bugs
  // only" filter — but note the filters are built ONCE below and the branch is
  // only the final `.range()`/`.limit()`, because rebuilding the query for the
  // derived path is how that page silently drops its other filters.
  const needsScan = Boolean(offering || shipping || cgender) || sort.key === "brand";

  const COLUMNS =
    "campaign_id, title, status, max_influencers, budget_total, campaign_start_date, campaign_end_date, application_deadline, target_categories, brand_id, brand_invitation_id, created_by_admin, brand_profiles(brand_name), brand_invitations(brand_name)";

  // Brand / agency (migration 075). A campaign is owned by a registered brand
  // (brand_id) or, for admin-created ones, an invitation (brand_invitation_id)
  // — so it counts as an agency's when either owner is labelled agency.
  // Filtering on the agency id lists keeps the URL short: agencies are the
  // minority, and "brand" is expressed as "neither owner is an agency".
  //
  // Resolved BEFORE the builder below so that builder can be synchronous and
  // therefore callable twice — see the out-of-range retry.
  let agencyProfileIds: string[] = [];
  let agencyInviteIds: string[] = [];
  if (accountType) {
    const [agencyProfiles, agencyInvites] = await Promise.all([
      supabase.from("brand_profiles").select("brand_id").eq("account_type", "agency"),
      supabase.from("brand_invitations").select("id").eq("account_type", "agency"),
    ]);
    agencyProfileIds = (agencyProfiles.data || []).map((r) => r.brand_id as string);
    agencyInviteIds = (agencyInvites.data || []).map((r) => r.id as string);
  }

  // ONE builder, so the retry below cannot possibly carry a different filter
  // set from the first attempt. (The errors list's derived branch rebuilds its
  // query inline and silently drops its other filters — this shape is what
  // stops that happening here.)
  function buildQuery() {
    let q = supabase
      .from("campaigns")
      // `description` is read ONLY to filter on the brief fields packed into
      // its trailer, and is stripped before the rows reach the client
      // component — the prose and base64-ish image URLs in there would
      // several times over outweigh the rest of the payload (measured: 158 KB
      // across 79 rows, ~2 KB a row). So it is now selected only on the path
      // that actually reads it; the paged path never asks for it at all.
      .select(needsScan ? `${COLUMNS}, description` : COLUMNS, { count: "exact" });
    q = applySort(q, sort);

    if (searchTerm) q = q.ilike("title", `%${searchTerm}%`);
    q = applyStatusFilter(q, statusFilter);
    if (category) {
      const cats = category.split(",").filter(Boolean);
      if (cats.length > 0) q = q.contains("target_categories", cats);
    }
    // Real columns, so these narrow the query rather than the result.
    if (ctype) q = q.eq("campaign_type", ctype);
    if (fmin) q = q.gte("target_follower_min", Number(fmin));

    if (accountType === "agency") {
      const clauses = [
        ...(agencyProfileIds.length ? [`brand_id.in.(${agencyProfileIds.join(",")})`] : []),
        ...(agencyInviteIds.length ? [`brand_invitation_id.in.(${agencyInviteIds.join(",")})`] : []),
      ];
      // No agencies labelled yet → nothing matches.
      q = clauses.length ? q.or(clauses.join(",")) : q.eq("campaign_id", "00000000-0000-0000-0000-000000000000");
    } else if (accountType) {
      if (agencyProfileIds.length) q = q.or(`brand_id.is.null,brand_id.not.in.(${agencyProfileIds.join(",")})`);
      if (agencyInviteIds.length) q = q.or(`brand_invitation_id.is.null,brand_invitation_id.not.in.(${agencyInviteIds.join(",")})`);
    }
    return q;
  }

  // The branch is ONLY the final `.range()`/`.limit()` — every filter above is
  // already on the builder, so the two paths cannot select different campaigns.
  // `p` is ignored on the scanning path, which slices in memory further down.
  const fetchPage = (p: number) =>
    needsScan
      ? buildQuery().limit(BRIEF_SCAN_CAP)
      : buildQuery().range((p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1);

  let effectivePage = page;
  let { data: campaigns, count, error } = await fetchPage(page);

  // PostgREST answers an offset past the end with PGRST103 ("Requested range
  // not satisfiable") rather than an empty page, and `count` comes back NULL
  // with it — so the total it knows cannot be used to clamp. Left alone, a
  // stale `?page=4` link on a list that has since shrunk renders a red
  // "failed to load" banner over a perfectly healthy table. Every filter
  // control drops the page cursor, so reaching this needs a typed or
  // bookmarked URL: it costs one extra round trip in a case that should not
  // arise, and never touches the normal path.
  if (error?.code === "PGRST103" && effectivePage > 1) {
    effectivePage = 1;
    ({ data: campaigns, count, error } = await fetchPage(1));
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let rows = (campaigns as any[]) ?? [];
  // On the paged path the database has already counted the matching set. On
  // the scanning path `count` describes what was SCANNED, not what survives
  // the trailer filters, so it is recomputed after them.
  let totalCount = count ?? 0;

  if (needsScan) {
    // The three brief fields that live in the trailer. Applied BEFORE the
    // count, so "12 campaigns" always matches the rows on screen.
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
    // cannot order by it. Sorted here instead, across the whole scanned set
    // — ordering one page of 20 would only shuffle that page.
    if (sort.key === "brand") {
      rows = compareBy(
        rows,
        (c) => c.brand_profiles?.brand_name || c.brand_invitations?.brand_name || "",
        sort.ascending,
      );
    }
    totalCount = rows.length;
    // The scanning path pages in memory, so an out-of-range page is simply an
    // empty slice — PGRST103 cannot occur here. Clamp it anyway so the
    // paginator and the rows agree about which page is being shown.
    if ((effectivePage - 1) * PAGE_SIZE >= totalCount) effectivePage = 1;
    rows = rows.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);
  }

  const briefFilterFields = [
    { name: "ctype", label: t("filter.allTypes"), type: "select" as const, options: CAMPAIGN_TYPES.map((v) => ({ label: t(`filter.type.${v}`), value: v })) },
    { name: "offering", label: t("filter.allOfferings"), type: "select" as const, options: OFFERING_TYPES.map((v) => ({ label: t(`filter.offering.${v}`), value: v })) },
    { name: "shipping", label: t("filter.allShipping"), type: "select" as const, options: SHIPPING_MODES.map((v) => ({ label: t(`filter.shipping.${v}`), value: v })) },
    { name: "cgender", label: t("filter.allGenders"), type: "select" as const, options: GENDER_BRIEFS.map((v) => ({ label: t(`filter.gender.${v}`), value: v })) },
    { name: "fmin", label: t("filter.allFollowers"), type: "select" as const, options: FOLLOWER_FLOORS.map((v) => ({ label: t(`filter.followers.${v}`), value: v })) },
  ];

  // Drop the description now that every filter and sort that needed it has
  // run. Nothing downstream reads it, and it is the biggest field on the row.
  // Only the scanning path selected it at all; this is a no-op on the other.
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
          {/* Housekeeping, not a daily action — a campaign ending is not an
              event anything listens for, so undecided applicants on a
              finished campaign wait forever unless someone looks. */}
          {canWrite && (
            <Link
              href="/dashboard/campaigns/close-ended"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("closeEnded")}
            </Link>
          )}
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
      <div className="mb-6 space-y-3 [&>*:last-child]:mb-0">
        <CampaignFilters />
        <BrandTypeFilter />
      {/* The brief's own fields. A FilterBar row rather than more controls
          inside CampaignFilters' drawer, which holds draft state and applies
          on confirm — these read straight from the URL like every other
          page's filters. */}
        <FilterBar fields={briefFilterFields} />
      </div>

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

      <Pagination
        basePath={BASE}
        pageParam="page"
        currentParams={params}
        page={effectivePage}
        perPage={PAGE_SIZE}
        total={totalCount}
      />
    </div>
  );
}
