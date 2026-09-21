import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { createAdminClient } from "@/utils/supabase/admin";
import { RefreshButton } from "@/components/refresh-button";
import { NUDGE_KEYS, type NudgeKey } from "@/lib/nudges/constants";
import { allSegments, loadNudgeContext } from "@/lib/nudges/segments";
import { nudgeSecret, readAutoEnabled } from "@/lib/nudges/send";
import { NudgesClient, type NudgeCardData } from "./nudges-client";

export const dynamic = "force-dynamic";

// Module scope: reading the clock during render trips react-hooks/purity.
function weekAgoIso() {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

// Creator nudges — re-engagement emails + in-app pushes. Admin-only: it
// shows creators' names and sends to them. See src/lib/nudges/*.
export default async function NudgesPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  const [ctx, autoEnabled] = await Promise.all([loadNudgeContext(), readAutoEnabled()]);
  const segments = allSegments(ctx);

  // Sends in the last 7 days per nudge, and how many creators opted out.
  const sentWeek: Partial<Record<NudgeKey, number>> = {};
  if (ctx.live) {
    const { data } = await createAdminClient().from("creator_nudge_sends").select("nudge_key").gte("sent_at", weekAgoIso());
    for (const r of data || []) sentWeek[r.nudge_key as NudgeKey] = (sentWeek[r.nudge_key as NudgeKey] ?? 0) + 1;
  }

  const cards: NudgeCardData[] = NUDGE_KEYS.map((key) => {
    const list = segments[key];
    return {
      key,
      eligible: list.length,
      withEmail: list.filter((r) => r.email).length,
      sentWeek: sentWeek[key] ?? 0,
      // Names + ids only — addresses stay on the server.
      recipients: list.map((r) => ({
        userId: r.userId,
        name: r.name,
        handle: r.handle,
        hasEmail: !!r.email,
        // Only the Instagram nudge labels its rows with the connection state.
        igStatus: key === "c3" ? r.vars.igStatus : undefined,
      })),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">Creator Nudges</h1>
          <p className="text-[12px] text-gray-500">
            Emails + in-app notifications that bring creators back and move them to a plan.{" "}
            {ctx.profiles.length.toLocaleString("en-IN")} creators · {ctx.optedOut.size} unsubscribed.
          </p>
        </div>
        <RefreshButton />
      </div>

      {!ctx.live && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          Apply RS_Gossips <strong>migration 074</strong> (<code>npx supabase db push</code>) — until then nothing can be sent or recorded.
        </p>
      )}
      {!nudgeSecret() && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          Set <code>NUDGE_SECRET</code> (any random string, 24+ characters) in <code>.env.local</code> and on Netlify. It signs the
          unsubscribe links and protects the automatic job — sending is blocked without it.
        </p>
      )}

      <NudgesClient cards={cards} autoEnabled={autoEnabled} live={ctx.live} />
    </div>
  );
}
