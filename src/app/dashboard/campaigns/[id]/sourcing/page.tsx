import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove, getAdminProfile } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import { SEAT_HOLDING_APPLICATION_STATUSES, countSeats, describeSeats } from "@/lib/sourcing/seats";
import { ALL_MAIN_STAGES, STAGE_LABEL, STAGE_STYLE, defaultFulfilmentMode, type BookingStage, type FulfilmentMode } from "@/lib/sourcing/stages";
import { SourcingTable } from "./sourcing-table";
import { AddBookingButton } from "./add-booking";
import { listAssignableAdmins } from "./outreach-actions";
import { BulkCreateButton } from "./bulk-create";
import { ApprovedApplicants } from "./approved-applicants";

export const dynamic = "force-dynamic";

// The campaign metadata trailer: the prose description, a blank line, a
// "---" line, then JSON. Same contract the campaign forms write.
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

// Managed sourcing for one campaign — the second intake path beside the
// portal's own applications.
//
// The campaign is an ordinary campaign. This is a tab on it, not a different
// kind of campaign, and the seat counter at the top spans BOTH paths so a
// brand's 100 slots cannot quietly become 140.
export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isAdminOrAbove())) redirect("/dashboard/campaigns");

  // Who is looking, and what they are allowed to press. The actions
  // re-check all of it; this only decides what to render.
  const me = await getAdminProfile();
  const adminList = await listAssignableAdmins();
  const admins = adminList.admins || [];
  const isSuperAdmin = me.role === "super_admin";
  // A super_admin stands in when nobody holds the approver flag, which is
  // also the state before admin migration 005 is applied.
  const approvers = admins.filter((a) => a.isApprover);
  const canApprove =
    approvers.some((a) => a.id === me.userId) || (approvers.length === 0 && isSuperAdmin);

  const admin = createAdminClient();

  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select("campaign_id, title, max_influencers, campaign_type, description, brand_profiles(brand_name), brand_invitations(brand_name)")
    .eq("campaign_id", id)
    .maybeSingle();
  if (campErr) logError("sourcing.campaign", campErr, { id });
  if (!campaign) notFound();

  const [bookingsRes, appsRes] = await Promise.all([
    admin
      .from("campaign_bookings")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false }),
    // The portal's own half of the roster. Opening Sourcing should answer
    // "who is on this campaign", which is both paths — not just the people
    // an admin typed in.
    admin
      .from("campaign_applications")
      .select("id, influencer_id, status, created_at, shipping_address, influencer_profiles(full_name, username, instagram_handle, followers_count)")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false }),
  ]);

  // The tables arrive with migration 081. Until it is applied the page says
  // so instead of rendering an empty list that looks like "no bookings yet".
  // PGRST205 = the table is not in the schema cache, i.e. migration 081
  // has not been applied. That is a state this page is DESIGNED to handle,
  // so it renders the panel below and says nothing to the error log — an
  // expected, handled condition logged as an error is just noise in the
  // triage queue. Any other failure is real and still gets recorded.
  const notLive = !!bookingsRes.error;
  if (bookingsRes.error && bookingsRes.error.code !== "PGRST205") {
    logError("sourcing.bookings", bookingsRes.error, { id });
  }

  const bookings = bookingsRes.data || [];

  // Who moved each row last.
  //
  // Every action on this page already writes a campaign_booking_events
  // row carrying actor_id — that is the audit trail. This reads the most
  // recent one per booking so the trail is VISIBLE on the row rather than
  // only recoverable from the table. One query for the whole page, not
  // one per row.
  //
  // Resolved to a name here rather than stored on the booking: there is no
  // outreach_updated_by column, and adding one would duplicate what the
  // events table already records properly.
  const lastActions: Record<string, { note: string; actorName: string; at: string } | null> = {};
  if (bookings.length) {
    const { data: events } = await admin
      .from("campaign_booking_events")
      .select("booking_id, note, actor_id, created_at, kind")
      .in(
        "booking_id",
        bookings.map((b) => b.id),
      )
      .order("created_at", { ascending: false });
    const nameById = new Map(admins.map((a) => [a.id, a.name]));
    for (const e of events || []) {
      const key = String(e.booking_id);
      // Ordered newest-first, so the first one seen per booking wins.
      if (lastActions[key]) continue;
      lastActions[key] = {
        note: String(e.note || e.kind || "updated"),
        actorName: nameById.get(String(e.actor_id)) || "an admin",
        // Fixed IST, computed on the server and passed down as a string —
        // the same reason the errors page does it this way: a locale-
        // dependent render would differ between server and client.
        at: new Date(e.created_at).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        }),
      };
    }
  }
  const applications = appsRes.data || [];
  const seats = countSeats(campaign.max_influencers, applications, bookings);

  // The ones holding a seat through the portal. Same statuses the seat
  // counter uses, so the list and the number can never disagree.
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const approvedApplicants = (applications as any[]).filter((a) =>
    (SEAT_HOLDING_APPLICATION_STATUSES as readonly string[]).includes(a.status),
  );

  // Funnel across the happy path, so an admin can see where everyone is
  // stuck without reading the table.
  const byStage = new Map<string, number>();
  for (const b of bookings) byStage.set(b.stage, (byStage.get(b.stage) || 0) + 1);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const camp = campaign as any;
  const brandName = camp.brand_profiles?.brand_name || camp.brand_invitations?.brand_name || "—";

  // How this campaign's product reaches a creator, by default. Taken from
  // the campaign's own brief rather than asked at import time: an admin
  // adding sixty creators should not have to answer a logistics question
  // sixty times, and the route is editable per booking afterwards.
  //
  //   ships it        -> we send it, so "ship"
  //   pickup          -> the creator collects; no parcel of ours, no refund
  //   a product, but no shipping -> they buy it and we pay them back
  //   a service/stay  -> nothing physical moves
  const defaultMode: FulfilmentMode = defaultFulfilmentMode(parseTrailer(camp.description));

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/campaigns/${id}`}
            className="text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← {campaign.title || "Campaign"}
          </Link>
          <h1 className="mt-1 text-xl font-black text-gray-900 dark:text-gray-100">Outreach tracker</h1>
          <p className="text-[12px] text-gray-500">
            {brandName} · creators we are reaching out to by hand. They fill the same seats as portal applicants.
          </p>
        </div>
      </div>

      {!notLive && (
        <div className="flex flex-wrap items-start gap-2">
          <AddBookingButton campaignId={id} defaultMode={defaultMode} />
          <BulkCreateButton campaignId={id} defaultMode={defaultMode} />
        </div>
      )}

      {notLive ? (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-5 py-10 text-center dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">The outreach tracker isn&apos;t live yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-amber-800 dark:text-amber-300">
            Apply migration <span className="font-mono">081_campaign_bookings</span> in rgossips_web and this tab
            starts working. Nothing is backfilled — bookings accrue from then on.
          </p>
        </div>
      ) : (
        <>
          {/* Seats — the number this whole tab exists to keep honest. */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-black text-gray-900 dark:text-white">
                {seats.capacity === null ? seats.taken : `${seats.taken} / ${seats.capacity}`}
              </span>
              <span className="text-[13px] text-gray-500 dark:text-gray-400">{describeSeats(seats)}</span>
              {seats.over && (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  over capacity
                </span>
              )}
            </div>
            {seats.capacity !== null && (
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className={`h-full rounded-full ${seats.over ? "bg-amber-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, Math.round((seats.taken / seats.capacity) * 100))}%` }}
                />
              </div>
            )}
          </div>

          {/* Funnel */}
          {bookings.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ALL_MAIN_STAGES.filter((s) => byStage.get(s)).map((s) => (
                <span
                  key={s}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${STAGE_STYLE[s as BookingStage]}`}
                >
                  {STAGE_LABEL[s as BookingStage]}
                  <span className="font-black">{byStage.get(s)}</span>
                </span>
              ))}
            </div>
          )}

          <ApprovedApplicants applicants={approvedApplicants} campaignId={id} />

          <div>
            <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">
              Sourced by hand <span className="font-normal text-gray-400">({bookings.length})</span>
            </h2>
            <SourcingTable
              bookings={bookings}
              campaignId={id}
              admins={admins}
              currentAdminId={me.userId || ""}
              isSuperAdmin={isSuperAdmin}
              canApprove={canApprove}
              lastActions={lastActions}
            />
          </div>
        </>
      )}
    </div>
  );
}
