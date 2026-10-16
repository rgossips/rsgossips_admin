import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { MarkPaidForm } from "./_components/mark-paid-form";
import { FixPayoutDetails } from "./_components/fix-payout-details";
import { BarterDeliveries } from "./_components/barter-deliveries";
import { SortMenu } from "@/components/sort-controls";
import { applySort, resolveSort, sortHref, type SortOption } from "@/lib/sorting";
import { fulfilmentState, normalizeShippingMode, type ShippingMode } from "@/lib/barter-fulfilment";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/payouts";

// Cards at every width, so the menu is the only sort affordance. Amount is
// the one that earns its place here: this is a queue of money owed, and
// "biggest payment first" is a real question an admin asks before a run.
//
// `escrow_amount` is PAISE on this table — the sort does not care, but
// anything comparing it to a rupee figure would.
function payoutSorts(label: (k: string) => string): SortOption[] {
  const tiebreak = { column: "id", ascending: true };
  return [
    { key: "releaseAt", column: "payout_release_at", label: label("releaseAt"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "amount", column: "escrow_amount", label: label("amount"), defaultDir: "desc", nullsLast: true, tiebreak },
    { key: "processedAt", column: "payout_processed_at", label: label("processedAt"), defaultDir: "desc", nullsLast: true, tiebreak },
    { key: "scheduledAt", column: "payout_scheduled_at", label: label("scheduledAt"), defaultDir: "desc", nullsLast: true, tiebreak },
    { key: "status", column: "payout_status", label: label("status"), defaultDir: "asc", tiebreak },
  ];
}

/**
 * What this creator is owed, in PAISE.
 *
 * Two columns hold the figure and they are in different units.
 * `escrow_amount` is paise and is written by the escrow flow;
 * `final_agreed_rate` is RUPEES and is what an admin types on the campaign
 * page. A barter or hand-run campaign only ever has the second, which is
 * why the queue showed "—" for a creator the campaign page said was owed
 * Rs 2,000. Resolved once, here, because multiplying by 100 in the wrong
 * branch is a hundredfold error in somebody's bank transfer.
 */
/**
 * Still needs the money sent.
 *
 * `scheduled` is the escrow flow's way of saying it; `status = payment`
 * with no payout row is the admin flow's. Both mean an admin has to make a
 * transfer, so both get the Mark-paid form — otherwise a creator shows in
 * the queue with no way to action them, which is worse than not showing.
 */
function awaitingTransfer(app: { payout_status?: string | null; status?: string | null }): boolean {
  if (app.payout_status === "processed" || app.payout_status === "completed") return false;
  return app.payout_status === "scheduled" || (!app.payout_status && app.status === "payment");
}

function owedPaise(app: { escrow_amount?: number | null; final_agreed_rate?: number | null }): number | null {
  if (typeof app.escrow_amount === "number" && Number.isFinite(app.escrow_amount)) return app.escrow_amount;
  if (typeof app.final_agreed_rate === "number" && Number.isFinite(app.final_agreed_rate)) {
    return Math.round(app.final_agreed_rate * 100);
  }
  return null;
}

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
  searchParams?: Promise<{ status?: string; sort?: string }>;
}) {
  const sp = (await searchParams) || {};
  const filter = sp.status || "scheduled";

  const t = await getTranslations("DashboardPayouts");
  const SORTS = payoutSorts((k) => t(`sort.${k}`));
  const sort = resolveSort(sp.sort, SORTS, filter === "processed" ? "processedAt" : "releaseAt");
  const admin = createAdminClient();
  const canWrite = await isAdminOrAbove();

  // Pull applications in any payout state, then filter in the query.
  // Order: oldest release first so the queue is FIFO for the admin.
  let q = admin
    .from("campaign_applications")
    .select(
      "id, influencer_id, campaign_id, escrow_amount, final_agreed_rate, status, payout_status, payout_release_at, payout_scheduled_at, payout_processed_at, payout_utr, payout_method, shipping_address, shipping_address_requested_at, shipping_tracking_url, shipping_expected_at, product_received, product_received_at",
    );

  // WHAT COUNTS AS OWED, and why this is not just payout_status.
  //
  // payout_status is written by the consumer app's escrow-release flow. An
  // admin who moves an application to `payment` from the campaign page —
  // which is how every barter and hand-run campaign gets there — never
  // touches it. So the campaign page said "Payment released — Rs 2,000" and
  // this queue showed "Ready to pay 0" for the same creator, because the two
  // screens were reading different columns. Money owed is money owed however
  // it got there, so `status = payment` with no payout_status yet counts.
  //
  // Constants only in these .or() strings — no user input is interpolated,
  // which is the thing sanitizeSearchTerm exists to guard.
  const OWED_BY_STATUS = "and(status.eq.payment,payout_status.is.null)";
  if (filter === "scheduled") q = q.or(`payout_status.eq.scheduled,${OWED_BY_STATUS}`);
  else if (filter === "pending_creator_info") q = q.eq("payout_status", "pending_creator_info");
  else if (filter === "processed") q = q.eq("payout_status", "processed");
  else q = q.or(`payout_status.in.(scheduled,pending_creator_info,processed,failed),${OWED_BY_STATUS}`);

  // The default order depends on the tab, and both defaults are deliberate:
  // an open queue is FIFO by release date (oldest money owed first), while
  // Processed is a history and reads newest first. An explicit ?sort
  // overrides either.
  q = applySort(q, sort);
  if (filter === "processed") q = q.limit(50);

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
          .select("campaign_id, title, brand_id, brand_invitation_id, description")
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

  // Is a PRODUCT owed on this campaign too, and has it gone yet?
  //
  // An admin settling a creator needs to know whether they owe money, a
  // parcel, or both — paying someone and forgetting the product is the
  // failure this answers. Shipping mode lives in the campaign description
  // trailer and fulfilmentState (lib/barter-fulfilment.ts) owns the stage,
  // so neither rule is re-invented here.
  //
  // The separator is SIX characters. The barter-deliveries component slices
  // sep + 5 and gets away with it only because JSON.parse tolerates the
  // stray leading newline; spelling it correctly here avoids relying on that.
  const CAMPAIGN_TRAILER = "\n\n---\n";
  const shippingMode = new Map<string, ShippingMode>();
  for (const c of (campaignsRes.data || []) as { campaign_id: string; description: string | null }[]) {
    const desc = String(c.description || "");
    const at = desc.indexOf(CAMPAIGN_TRAILER);
    const json = at !== -1 ? desc.slice(at + CAMPAIGN_TRAILER.length) : desc.trim().startsWith("{") ? desc : "";
    if (!json) continue;
    try {
      shippingMode.set(c.campaign_id, normalizeShippingMode(JSON.parse(json).shipping_required));
    } catch {
      // A malformed trailer means we simply do not know, which is the same
      // as "nothing ships" for this chip. One bad campaign must not take
      // the payout queue down.
    }
  }

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
    .select("payout_status, status");
  const rows = (allRows || []) as { payout_status: string | null; status: string | null }[];
  // Same predicate the query above uses. Written once as a function so the
  // tab count and the list it leads to cannot drift — a tab reading 0 over
  // a list with a row in it is exactly the bug this whole change fixes.
  const owedWithoutPayoutRow = (r: { payout_status: string | null; status: string | null }) =>
    !r.payout_status && r.status === "payment";
  const counts: Record<string, number> = {
    scheduled: rows.filter((r) => r.payout_status === "scheduled" || owedWithoutPayoutRow(r)).length,
    pending_creator_info: rows.filter((r) => r.payout_status === "pending_creator_info").length,
    processed: rows.filter((r) => r.payout_status === "processed").length,
    all: rows.filter((r) => !!r.payout_status || owedWithoutPayoutRow(r)).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("subtitle")}
        </p>
      </div>

      {/* Product owed, not money owed — same job, so it lives here. Renders
          nothing when every barter delivery is settled. */}
      <BarterDeliveries />

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <a
              key={f.id}
              href={sortHref(BASE, { ...sp, status: f.id }, sort.token)}
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
        {/* Always visible: this page has no table header to click. */}
        <SortMenu options={SORTS} current={sort} basePath={BASE} params={sp} className="ml-auto" />
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
              // Does a parcel still owe this creator too? Only campaigns
              // that ship anything can, and fulfilmentState decides where
              // it has got to.
              const mode = shippingMode.get(app.campaign_id) || "no";
              const delivery = mode === "no" ? null : fulfilmentState(app, mode).stage;
              const productOutstanding =
                !!delivery && delivery !== "received" && delivery !== "not_applicable";
              const statusBase = STATUS_LABEL[app.payout_status];
              // A row owed by application status has no payout_status to
              // label, and "—" would read as "no idea". It is ready to pay.
              const statusInfo = statusBase
                ? { label: t(statusBase.key), class: statusBase.class }
                : awaitingTransfer(app)
                  ? { label: t("status.scheduled"), class: "bg-amber-50 text-amber-700" }
                  : {
                      label: app.payout_status || "—",
                      class: "bg-slate-100 text-slate-500",
                    };
              return (
                <PayoutRow
                  key={app.id}
                  app={app}
                  productOutstanding={productOutstanding}
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
  productOutstanding,
  canWrite,
}: {
  app: any;
  creator: any;
  campaign: any;
  paymentMethod: any;
  statusInfo: { label: string; class: string };
  /** A parcel is owed on this campaign as well as the money. */
  productOutstanding: boolean;
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

  // What is still outstanding for this creator, in one chip, because
  // "payment or product or both" is the question an admin opens this page
  // with. Money is implied by being in this queue at all; the chip exists
  // to stop a parcel being forgotten once the transfer is made.
  const owesChip = productOutstanding ? (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
      title={t("alsoShipHint")}
    >
      {isPaid ? t("owesProduct") : t("owesBoth")}
    </span>
  ) : null;

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
        <span className="text-sm font-black text-gray-900 dark:text-white shrink-0">{formatINR(owedPaise(app))}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusInfo.class}`}>{statusInfo.label}</span>
        {owesChip}
        <span className="text-[11px] text-gray-400">
          {isPaid ? `${t("paid")} · ${formatDate(app.payout_processed_at)}` : `${t("released")} · ${formatDate(app.payout_release_at || app.payout_scheduled_at)}`}
        </span>
      </div>
      {methodLine && methodLine !== "—" && (
        <p className="text-[12px] font-mono text-gray-700 dark:text-gray-300 break-all">{methodLine}{methodHint ? ` · ${methodHint}` : ""}</p>
      )}
      {!isPaid && awaitingTransfer(app) && (
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
        <p className="text-base font-black text-gray-900 dark:text-white">{formatINR(owedPaise(app))}</p>
        <span
          className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusInfo.class}`}
        >
          {statusInfo.label}
        </span>
        {owesChip && <span className="ml-1 inline-block">{owesChip}</span>}
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
        {!isPaid && awaitingTransfer(app) && (
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
