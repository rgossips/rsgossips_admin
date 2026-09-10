import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { MarkPaidForm } from "./_components/mark-paid-form";
import { FixPayoutDetails } from "./_components/fix-payout-details";

export const dynamic = "force-dynamic";

const formatINR = (paise: number | null | undefined) =>
  paise == null
    ? "—"
    : "₹" + Math.round((paise as number) / 100).toLocaleString("en-IN");

const formatDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const STATUS_LABEL: Record<string, { key: string; class: string }> = {
  scheduled: { key: "status.scheduled", class: "bg-amber-50 text-amber-700" },
  pending_creator_info: {
    key: "status.pendingCreatorInfo",
    class: "bg-slate-100 text-slate-500",
  },
  processed: { key: "status.paid", class: "bg-emerald-50 text-emerald-700" },
};

const FILTERS = [
  { id: "scheduled", labelKey: "filters.scheduled" },
  { id: "pending_creator_info", labelKey: "filters.pendingCreatorInfo" },
  { id: "processed", labelKey: "filters.processed" },
  { id: "all", labelKey: "filters.all" },
];

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const sp = (await searchParams) || {};
  const filter = sp.status || "scheduled";

  const t = await getTranslations("DashboardPayouts");
  const admin = createAdminClient();
  const canWrite = await isAdminOrAbove();

  // Pull applications in any payout state, then filter in the query.
  // Order: oldest release first so the queue is FIFO for the admin.
  let q = admin
    .from("campaign_applications")
    .select(
      "id, influencer_id, campaign_id, escrow_amount, payout_status, payout_release_at, payout_scheduled_at, payout_processed_at, payout_utr, payout_method",
    );

  if (filter === "scheduled") q = q.eq("payout_status", "scheduled");
  else if (filter === "pending_creator_info") q = q.eq("payout_status", "pending_creator_info");
  else if (filter === "processed") q = q.eq("payout_status", "processed").order("payout_processed_at", { ascending: false }).limit(50);
  else q = q.in("payout_status", ["scheduled", "pending_creator_info", "processed", "failed"]).order("payout_release_at", { ascending: true });

  if (filter !== "processed") q = q.order("payout_release_at", { ascending: true, nullsFirst: false });

  const { data: apps, error } = await q;

  // Bulk side-fetches for creator + campaign + primary payment method.
  const creatorIds = [...new Set((apps || []).map((a: any) => a.influencer_id).filter(Boolean))];
  const campaignIds = [...new Set((apps || []).map((a: any) => a.campaign_id).filter(Boolean))];

  const [creatorsRes, campaignsRes, paymentMethodsRes] = await Promise.all([
    creatorIds.length > 0
      ? admin
          .from("influencer_profiles")
          .select("influencer_id, full_name, username, instagram_handle, profile_photo_url")
          .in("influencer_id", creatorIds)
      : Promise.resolve({ data: [] as any[] }),
    campaignIds.length > 0
      ? admin
          .from("campaigns")
          .select("campaign_id, title, brand_id, brand_invitation_id")
          .in("campaign_id", campaignIds)
      : Promise.resolve({ data: [] as any[] }),
    creatorIds.length > 0
      ? admin
          .from("payment_methods")
          .select(
            "id, user_id, type, label, upi_id, account_holder_name, bank_name, account_number, ifsc, is_primary, validation_status",
          )
          .in("user_id", creatorIds)
          .eq("is_primary", true)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const creators = new Map<string, any>(
    (creatorsRes.data || []).map((c: any) => [c.influencer_id, c]),
  );
  const campaigns = new Map<string, any>(
    (campaignsRes.data || []).map((c: any) => [c.campaign_id, c]),
  );
  const paymentMethods = new Map<string, any>(
    (paymentMethodsRes.data || []).map((p: any) => [p.user_id, p]),
  );

  // Tab counts
  const { data: allRows } = await admin
    .from("campaign_applications")
    .select("payout_status");
  const allStatuses = (allRows || []).map((r: any) => r.payout_status);
  const counts: Record<string, number> = {
    scheduled: allStatuses.filter((s) => s === "scheduled").length,
    pending_creator_info: allStatuses.filter((s) => s === "pending_creator_info").length,
    processed: allStatuses.filter((s) => s === "processed").length,
    all: allStatuses.filter((s) => !!s).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("subtitle")}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <a
              key={f.id}
              href={`?status=${f.id}`}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                active
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {t(f.labelKey)}
              <span className={`ml-2 text-[10px] font-bold ${active ? "text-white/80" : "text-gray-400"}`}>
                {counts[f.id] ?? 0}
              </span>
            </a>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        {(apps || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            {t("emptyState")}
          </div>
        ) : (
          // Scroll + min-width apply only at lg — the desktop grid rows are
          // wide; the mobile card variant reflows and must not be forced wide.
          <div className="lg:overflow-x-auto">
          <div className="divide-y divide-gray-100 dark:divide-gray-800 lg:min-w-225">
            {(apps || []).map((app: any) => {
              const creator = creators.get(app.influencer_id);
              const campaign = campaigns.get(app.campaign_id);
              const pm = paymentMethods.get(app.influencer_id);
              const statusBase = STATUS_LABEL[app.payout_status];
              const statusInfo = statusBase
                ? { label: t(statusBase.key), class: statusBase.class }
                : {
                    label: app.payout_status || "—",
                    class: "bg-slate-100 text-slate-500",
                  };
              return (
                <PayoutRow
                  key={app.id}
                  app={app}
                  creator={creator}
                  campaign={campaign}
                  paymentMethod={pm}
                  statusInfo={statusInfo}
                  canWrite={canWrite}
                />
              );
            })}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function PayoutRow({
  app,
  creator,
  campaign,
  paymentMethod,
  statusInfo,
  canWrite,
}: {
  app: any;
  creator: any;
  campaign: any;
  paymentMethod: any;
  statusInfo: { label: string; class: string };
  canWrite: boolean;
}) {
  const t = await getTranslations("DashboardPayouts");
  const creatorName = creator?.full_name || creator?.username || t("unknownCreator");
  const handle = creator?.instagram_handle ? `@${creator.instagram_handle}` : "";

  // Render the primary payment method in a compact form so the admin can
  // copy/paste straight into their banking portal.
  let methodLine = "—";
  let methodHint = "";
  if (paymentMethod) {
    if (paymentMethod.type === "upi") {
      methodLine = paymentMethod.upi_id || "—";
      methodHint = paymentMethod.account_holder_name || "";
    } else if (paymentMethod.type === "bank") {
      const last4 = paymentMethod.account_number
        ? `••${String(paymentMethod.account_number).slice(-4)}`
        : "";
      methodLine = `${paymentMethod.bank_name || t("bankFallback")} ${last4} · IFSC ${paymentMethod.ifsc || "—"}`;
      methodHint = paymentMethod.account_holder_name || "";
    }
  } else if (app.payout_status === "pending_creator_info") {
    methodLine = t("waitingForMethod");
  }

  const isPaid = app.payout_status === "processed";

  const creatorBlock = creator?.influencer_id ? (
    <Link href={`/dashboard/influencers/${creator.influencer_id}`} className="font-bold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">
      {creatorName}
    </Link>
  ) : (
    <span className="font-bold text-gray-900 dark:text-white">{creatorName}</span>
  );

  return (
    <>
    {/* Mobile card — same fields, reflowed; the SAME MarkPaidForm instance. */}
    <div className="lg:hidden p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm truncate">
          {creatorBlock}
          {handle && <span className="text-[11px] text-gray-400 ml-1">{handle}</span>}
          {campaign?.title && <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{campaign.title}</p>}
        </div>
        <span className="text-sm font-black text-gray-900 dark:text-white shrink-0">{formatINR(app.escrow_amount)}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusInfo.class}`}>{statusInfo.label}</span>
        <span className="text-[11px] text-gray-400">
          {isPaid ? `${t("paid")} · ${formatDate(app.payout_processed_at)}` : `${t("released")} · ${formatDate(app.payout_release_at || app.payout_scheduled_at)}`}
        </span>
      </div>
      {methodLine && methodLine !== "—" && (
        <p className="text-[12px] font-mono text-gray-700 dark:text-gray-300 break-all">{methodLine}{methodHint ? ` · ${methodHint}` : ""}</p>
      )}
      {!isPaid && app.payout_status === "scheduled" && (
        <MarkPaidForm applicationId={app.id} defaultMethod={paymentMethod?.type === "upi" ? "upi" : "imps"} canWrite={canWrite} />
      )}
      {!isPaid && app.payout_status === "pending_creator_info" && (
        <span className="text-[11px] text-gray-400 italic">{t("noMethodOnFile")}</span>
      )}
      {/* Recovery for a bounced transfer: reject the saved details so the
          creator is told why, and/or enter the ones support collected. */}
      {!isPaid && (
        <FixPayoutDetails
          userId={app.influencer_id}
          paymentMethodId={paymentMethod?.id || null}
          canWrite={canWrite}
        />
      )}
    </div>

    {/* Desktop grid row — unchanged, just hidden on mobile. */}
    <div className="hidden lg:grid p-4 grid-cols-12 gap-4 items-start">
      {/* Creator — name + handle link to the influencer detail page */}
      <div className="col-span-3 min-w-0">
        {creator?.influencer_id ? (
          <Link
            href={`/dashboard/influencers/${creator.influencer_id}`}
            className="group block"
          >
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:underline transition-colors">
              {creatorName}
            </p>
            {handle && (
              <p className="text-[11px] text-gray-400 truncate group-hover:text-indigo-500 transition-colors">
                {handle}
              </p>
            )}
          </Link>
        ) : (
          <>
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{creatorName}</p>
            {handle && <p className="text-[11px] text-gray-400 truncate">{handle}</p>}
          </>
        )}
        {campaign?.title && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
            {campaign.title}
          </p>
        )}
      </div>

      {/* Amount + status */}
      <div className="col-span-2">
        <p className="text-base font-black text-gray-900 dark:text-white">{formatINR(app.escrow_amount)}</p>
        <span
          className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusInfo.class}`}
        >
          {statusInfo.label}
        </span>
      </div>

      {/* Payment method */}
      <div className="col-span-4 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
          {paymentMethod?.type === "bank" ? t("methodLabel.bank") : paymentMethod?.type === "upi" ? t("methodLabel.upi") : t("methodLabel.default")}
        </p>
        <p className="text-[12px] font-mono text-gray-800 dark:text-gray-200 truncate" title={methodLine}>
          {methodLine}
        </p>
        {methodHint && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{methodHint}</p>}
        {paymentMethod?.validation_status === "manual" && (
          <p className="text-[10px] text-amber-600 font-semibold mt-1">
            {t("notAutoVerified")}
          </p>
        )}
      </div>

      {/* Date column */}
      <div className="col-span-1 text-[11px] text-gray-500 dark:text-gray-400">
        {isPaid ? (
          <>
            <p className="font-semibold text-emerald-600">{t("paid")}</p>
            <p>{formatDate(app.payout_processed_at)}</p>
            {app.payout_utr && (
              <p className="mt-1 font-mono text-[10px] text-gray-400 break-all">{app.payout_utr}</p>
            )}
          </>
        ) : (
          <>
            <p className="font-semibold">{t("released")}</p>
            <p>{formatDate(app.payout_release_at || app.payout_scheduled_at)}</p>
          </>
        )}
      </div>

      {/* Action */}
      <div className="col-span-2 flex justify-end">
        {!isPaid && app.payout_status === "scheduled" && (
          <MarkPaidForm
            applicationId={app.id}
            defaultMethod={paymentMethod?.type === "upi" ? "upi" : "imps"}
            canWrite={canWrite}
          />
        )}
        {!isPaid && app.payout_status === "pending_creator_info" && (
          <span className="text-[11px] text-gray-400 italic">{t("noMethodOnFile")}</span>
        )}
      </div>
      <div className="col-span-12 flex justify-end pt-2">
        {!isPaid && (
          <FixPayoutDetails
            userId={app.influencer_id}
            paymentMethodId={paymentMethod?.id || null}
            canWrite={canWrite}
          />
        )}
      </div>
    </div>
    </>
  );
}
