import { createAdminClient } from "@/utils/supabase/admin";
import {
  deleteStayCampaign,
  getStaySectionTitle,
  moveStayCampaign,
  toggleStayCampaignActive,
} from "./actions";
import { AddFeaturedCampaignButton } from "./_components/add-featured-campaign";
import { StaySectionTitleEditor } from "./_components/section-title-editor";
import { isAdminOrAbove } from "@/lib/require-super-admin";

import { ActionButton } from "@/components/action-button";
export const dynamic = "force-dynamic";

export default async function FeaturedStayPage() {
  const admin = createAdminClient();
  const canWrite = await isAdminOrAbove();
  const sectionTitle = await getStaySectionTitle();

  // section='stay' filters to the Plan Your Stay carousel only;
  // Featured Campaigns picks live under /dashboard/featured-campaigns.
  const { data: featured, error } = await admin
    .from("featured_campaigns")
    .select("id, campaign_id, position, is_active")
    .eq("section", "stay")
    .order("position", { ascending: true });

  let campaignsById: Record<string, any> = {};
  if (featured && featured.length > 0) {
    const ids = featured.map((r) => r.campaign_id);
    const { data: campaigns } = await admin
      .from("campaigns")
      .select(
        "campaign_id, title, brand_id, brand_invitation_id, status, application_deadline, target_categories"
      )
      .in("campaign_id", ids);

    const brandIds = [...new Set((campaigns || []).map((c: any) => c.brand_id).filter(Boolean))];
    const invIds = [...new Set((campaigns || []).map((c: any) => c.brand_invitation_id).filter(Boolean))];
    const brandMap: Record<string, { name: string; logo: string }> = {};
    if (brandIds.length > 0) {
      const { data } = await admin
        .from("brand_profiles")
        .select("brand_id, brand_name, gstin_trade_name, logo_url")
        .in("brand_id", brandIds);
      (data || []).forEach((p: any) => {
        brandMap[p.brand_id] = { name: p.gstin_trade_name || p.brand_name || "", logo: p.logo_url || "" };
      });
    }
    if (invIds.length > 0) {
      const { data } = await admin
        .from("brand_invitations")
        .select("id, brand_name, logo_url")
        .in("id", invIds);
      (data || []).forEach((inv: any) => {
        brandMap[inv.id] = { name: inv.brand_name || "", logo: inv.logo_url || "" };
      });
    }
    (campaigns || []).forEach((c: any) => {
      const brand = brandMap[c.brand_invitation_id] || brandMap[c.brand_id] || { name: "Unknown brand", logo: "" };
      campaignsById[c.campaign_id] = { ...c, brand };
    });
  }

  const activeCount = (featured || []).filter((r) => r.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Plan Your Stay</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Hand-picked list shown in the &ldquo;Plan your stay with us&rdquo;
            carousel on the influencer home page. Curated separately
            from{" "}
            <a href="/dashboard/featured-campaigns" className="text-indigo-500 hover:underline">
              Featured Campaigns
            </a>
            . Lower position = appears first.
          </p>
        </div>
        {canWrite && <AddFeaturedCampaignButton />}
      </div>

      <StaySectionTitleEditor initialTitle={sectionTitle} canWrite={canWrite} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatPill label="Total" value={(featured || []).length} />
        <StatPill label="Active" value={activeCount} accent="text-emerald-600" />
        <StatPill label="Hidden" value={(featured || []).length - activeCount} accent="text-gray-400" />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(featured || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No stay picks yet. Click <span className="font-semibold text-indigo-500">Feature a campaign</span> to add one.
            <p className="text-[11px] text-gray-300 mt-2">Until you publish at least one, the influencer home falls back to a built-in placeholder list.</p>
          </div>
        ) : (
          (featured || []).map((f) => {
            const c = campaignsById[f.campaign_id];
            return <FeaturedRow key={f.id} row={f} campaign={c} canWrite={canWrite} />;
          })
        )}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent || "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

function FeaturedRow({ row, campaign, canWrite }: { row: any; campaign: any; canWrite: boolean }) {
  const brandName = campaign?.brand?.name || "Unknown brand";
  const brandLogo = campaign?.brand?.logo || "";
  const title = campaign?.title || "(missing — campaign deleted)";
  const deadline = campaign?.application_deadline;
  return (
    <div className="flex items-center gap-4 p-4">
      <span className="shrink-0 text-[11px] font-bold text-gray-500 dark:text-gray-400 w-6 text-center">
        {row.position}
      </span>

      {brandLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brandLogo} alt={brandName} className="w-12 h-12 rounded-lg object-cover" />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">
          {brandName.charAt(0).toUpperCase()}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{title}</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
          {brandName}
          {campaign?.status ? ` · ${campaign.status}` : ""}
          {deadline ? ` · deadline ${new Date(deadline).toLocaleDateString()}` : ""}
        </p>
      </div>

      {canWrite && (
        <>
          <form
            action={async () => {
              "use server";
              await moveStayCampaign(row.id, "up");
            }}
          >
            <ActionButton
              title="Move up"
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              ↑
            </ActionButton>
          </form>
          <form
            action={async () => {
              "use server";
              await moveStayCampaign(row.id, "down");
            }}
          >
            <ActionButton
              title="Move down"
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              ↓
            </ActionButton>
          </form>
        </>
      )}

      <span
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
          row.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
        }`}
      >
        {row.is_active ? "Active" : "Hidden"}
      </span>

      {canWrite && (
        <>
          <form
            action={async () => {
              "use server";
              await toggleStayCampaignActive(row.id, !row.is_active);
            }}
          >
            <ActionButton
              className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              {row.is_active ? "Hide" : "Show"}
            </ActionButton>
          </form>

          <form
            action={async () => {
              "use server";
              await deleteStayCampaign(row.id);
            }}
          >
            <ActionButton
              className="shrink-0 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-[12px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
            >
              Delete
            </ActionButton>
          </form>
        </>
      )}
    </div>
  );
}
