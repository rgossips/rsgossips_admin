import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove, getAdminProfile } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import { SEAT_HOLDING_APPLICATION_STATUSES, countSeats, describeSeats } from "@/lib/sourcing/seats";
import { defaultFulfilmentMode, type FulfilmentMode } from "@/lib/sourcing/stages";
import { OutreachDesk, type Booking, type BookingEvent } from "./outreach-desk";
import { AddBookingButton } from "./add-booking";
import { PoolPicker } from "./pool-picker";
import type { ActorContext } from "@/lib/sourcing/outreach";
import type { OutreachContext } from "./outreach-control";
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

  const bookings = (bookingsRes.data || []) as Booking[];
  // The tracker ends at the quote approval, so a handed-over creator is no
  // longer queued — OutreachDesk drops them from "All active" and from
  // every stage view except their own "On the campaign" tile. The whole
  // list is still passed down: filtering here instead would leave that
  // tile permanently reading 0, and "who did we put on this campaign" is
  // worth being able to answer.
  const handedOff = bookings.filter((b) => b.stage === "handed_off").length;

  const events: Record<string, BookingEvent[]> = {};
  if (bookings.length) {
    const { data: rows } = await admin
      .from("campaign_booking_events")
      .select("booking_id, note, kind, actor_id, created_at")
      .in(
        "booking_id",
        bookings.map((b) => b.id),
      )
      .order("created_at", { ascending: false });
    const nameById = new Map(admins.map((a) => [a.id, a.name]));
    for (const e of rows || []) {
      const key = String(e.booking_id);
      (events[key] ||= []).push({
        booking_id: key,
        note: String(e.note || e.kind || "updated"),
        actorName: nameById.get(String(e.actor_id)) || "an admin",
        // Fixed IST, formatted on the server and passed down as a string:
        // a locale-dependent render would differ between server and client
        // and trip a hydration mismatch.
        at: new Date(e.created_at).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }

  const applications = appsRes.data || [];

  // Does this creator ALSO hold a seat through the portal? It decides what
  // the decline confirmation can honestly promise: countSeats counts a
  // creator once across both routes, so dropping the booking of somebody
  // who also applied frees nothing — their application still holds it.
  const seatHolderIds = new Set(
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (applications as any[])
      .filter((a) => (SEAT_HOLDING_APPLICATION_STATUSES as readonly string[]).includes(a.status))
      .map((a) => String(a.influencer_id))
      .filter(Boolean),
  );
  for (const b of bookings) {
    b.hasApplication = !!b.influencer_id && seatHolderIds.has(String(b.influencer_id));
  }
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

  const actor: ActorContext = {
    actorId: me.userId || "",
    name: me.fullName || "an admin",
    isSuperAdmin,
    isApprover: canApprove,
    isViewer: me.role === "viewer",
  };
  const outreachCtx: OutreachContext = {
    campaignId: id,
    admins,
    actor,
    // Shown as "waiting on …". The first configured approver stands for all
    // of them: any approver can act, so naming one is a label rather than
    // an assignment.
    approverName: approvers[0]?.name || "an approver",
  };

  // Wider than the max-w-6xl the other dashboard pages use. This table
  // carries seven columns and two of them hold CONTROLS rather than text —
  // the Action cell stacks Approve / Send back / Reject and then an outcome
  // dropdown under them — so at 1152px the buttons wrapped and the Outreach
  // column squeezed the assignee onto three lines. Still capped rather than
  // full-bleed: the notes and summary text are prose, and prose running the
  // width of a 4K monitor is its own readability problem.
  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
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

      {/* No room, no door. A seat is taken the moment a quote is APPROVED,
          so this counts commitments rather than conversations — a campaign
          can still have twenty people in outreach against four seats, which
          is the point of having a pipeline. The actions refuse it again
          server-side; this only avoids offering a button that would fail. */}
      {!notLive && seats.capacity !== null && seats.remaining === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">All {seats.capacity} seats are taken.</p>
          <p className="mt-0.5">
            Creators already in the pipeline can still be moved along. To add anyone new, raise the slot count on the
            campaign — or drop someone who is no longer going ahead.
          </p>
        </div>
      ) : (
        !notLive && (
          <div className="flex flex-wrap items-start gap-2">
            <PoolPicker
              campaignId={id}
              defaultMode={defaultMode}
              admins={admins}
              currentAdminId={me.userId || ""}
            />
            <AddBookingButton
              campaignId={id}
              defaultMode={defaultMode}
              isApprover={canApprove}
              approverName={approvers[0]?.name || "an approver"}
            />
            <BulkCreateButton campaignId={id} defaultMode={defaultMode} />
          </div>
        )
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

          <ApprovedApplicants applicants={approvedApplicants} campaignId={id} />

          <div>
            <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">
              Sourced by hand <span className="font-normal text-gray-400">({bookings.length - handedOff})</span>
              {handedOff > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  · {handedOff} approved and now on the campaign
                </span>
              )}
            </h2>
            <OutreachDesk bookings={bookings} ctx={outreachCtx} events={events} />
          </div>
        </>
      )}
    </div>
  );
}
