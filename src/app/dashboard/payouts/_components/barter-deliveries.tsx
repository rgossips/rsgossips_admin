import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { logError } from "@/lib/log";
import {
  STAGE_LABEL,
  STAGE_STYLE,
  fulfilmentState,
  normalizeShippingMode,
  type ShippingMode,
} from "@/lib/barter-fulfilment";

// Barter deliveries queue.
//
// A barter creator is paid in product, so "who is still owed something" isn't
// only a money question — it's also whose parcel has no address, hasn't been
// dispatched, or went out and was never confirmed. That belongs next to
// payouts because it is the same job: things we owe people.
//
// Only rows needing a human appear. Delivered ones drop off by themselves,
// and the overdue test is derived at render (lib/barter-fulfilment.ts), so
// nothing schedules or stores it.

// Statuses where a product could be in flight. Mirrors DISPATCHABLE in the
// shared module — pending and rejected rows have nothing to deliver.
const LIVE_STATUSES = ["approved", "submitted", "revision_needed", "accepted", "live_submitted", "payment", "completed"];

type Row = {
  id: string;
  campaign_id: string;
  influencer_id: string;
  status: string;
  shipping_address: string | null;
  shipping_address_requested_at: string | null;
  shipping_tracking_url: string | null;
  shipping_expected_at: string | null;
  product_received: boolean | null;
  product_received_at: string | null;
};

export async function BarterDeliveries() {
  const admin = createAdminClient();

  // Which campaigns move a product? The answer is in the description
  // trailer, not a column, so it can't be a SQL filter — read the barter
  // campaigns and parse.
  const { data: campaigns, error: campErr } = await admin
    .from("campaigns")
    .select("campaign_id, title, description")
    .eq("campaign_type", "barter")
    .in("status", ["active", "paused", "completed"]);
  if (campErr) {
    logError("barter-deliveries.campaigns", campErr);
    return null;
  }

  const shipping = new Map<string, { title: string; mode: ShippingMode }>();
  for (const c of campaigns || []) {
    const description = c.description || "";
    const sep = description.indexOf("\n\n---\n");
    const jsonStr = sep !== -1 ? description.slice(sep + 5) : description.startsWith("{") ? description : "";
    if (!jsonStr) continue;
    try {
      const mode = normalizeShippingMode(JSON.parse(jsonStr).shipping_required);
      if (mode !== "no") shipping.set(c.campaign_id, { title: c.title || "Untitled campaign", mode });
    } catch {
      /* a malformed trailer means we can't tell — leave it out */
    }
  }
  if (shipping.size === 0) return null;

  const { data: rows, error } = await admin
    .from("campaign_applications")
    .select(
      "id, campaign_id, influencer_id, status, shipping_address, shipping_address_requested_at, shipping_tracking_url, shipping_expected_at, product_received, product_received_at",
    )
    .in("campaign_id", [...shipping.keys()])
    .in("status", LIVE_STATUSES);
  if (error) {
    logError("barter-deliveries.applications", error);
    return null;
  }

  // Keep only what somebody has to act on.
  const open = (rows as Row[] | null || [])
    .map((r) => ({ row: r, camp: shipping.get(r.campaign_id)!, state: fulfilmentState(r, shipping.get(r.campaign_id)!.mode) }))
    .filter(
      ({ state }) =>
        state.stage === "awaiting_address" ||
        state.stage === "ready_to_ship" ||
        state.stage === "not_received" ||
        (state.stage === "shipped" && state.receiptOverdue),
    );
  if (open.length === 0) return null;

  const creatorIds = [...new Set(open.map((o) => o.row.influencer_id).filter(Boolean))];
  const { data: creators } = await admin
    .from("influencer_profiles")
    .select("influencer_id, full_name, username, instagram_handle")
    .in("influencer_id", creatorIds);
  const nameOf = new Map(
    (creators || []).map((c) => [
      c.influencer_id,
      c.full_name || c.username || (c.instagram_handle ? `@${c.instagram_handle}` : "A creator"),
    ]),
  );

  // Most urgent first: nothing arrived, then overdue, then unshipped, then
  // the ones we can't even address.
  const RANK = { not_received: 0, shipped: 1, ready_to_ship: 2, awaiting_address: 3 } as Record<string, number>;
  open.sort((a, b) => (RANK[a.state.stage] ?? 9) - (RANK[b.state.stage] ?? 9) || b.state.daysOverdue - a.state.daysOverdue);

  const awaitingAddress = open.filter((o) => o.state.stage === "awaiting_address").length;
  const toShip = open.filter((o) => o.state.stage === "ready_to_ship").length;
  const chase = open.filter((o) => o.state.receiptOverdue || o.state.stage === "not_received").length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Barter deliveries</h2>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {open.length}
        </span>
        <p className="w-full text-[12px] text-gray-500 dark:text-gray-400 sm:w-auto">
          Product owed to a creator. {awaitingAddress > 0 && `${awaitingAddress} with no address. `}
          {toShip > 0 && `${toShip} ready to ship. `}
          {chase > 0 && `${chase} to chase.`}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {open.map(({ row, camp, state }) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_STYLE[state.stage]}`}>
              {STAGE_LABEL[state.stage]}
            </span>
            <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
              {nameOf.get(row.influencer_id) || "A creator"}
            </span>
            <Link
              href={`/dashboard/campaigns/${row.campaign_id}`}
              className="min-w-0 flex-1 truncate text-[12px] text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {camp.title}
            </Link>
            {state.receiptOverdue && (
              <span className="shrink-0 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {state.daysOverdue === 0 ? "due today" : `${state.daysOverdue}d overdue`}
              </span>
            )}
            {state.stage === "awaiting_address" && (
              <span className="shrink-0 text-[11px] text-gray-400">
                {state.addressRequested ? "asked, no reply" : "not asked yet"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
