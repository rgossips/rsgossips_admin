import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { ResolveActions } from "./resolve-actions";

export const dynamic = "force-dynamic";

const formatINR = (paise: number | null) =>
  paise == null ? "—" : "₹" + Math.round(paise / 100).toLocaleString("en-IN");
const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: d, error } = await admin
    .from("escrow_disputes_v")
    .select("*")
    .eq("application_id", id)
    .single();

  if (error || !d) {
    return (
      <div>
        <Link href="/dashboard/disputes" className="text-violet-600 text-sm font-semibold">← Back to disputes</Link>
        <p className="mt-6 text-gray-500">Dispute not found.</p>
      </div>
    );
  }

  const links = Array.isArray(d.submission_links) ? d.submission_links : [];
  const resolved = d.escrow_status !== "disputed";

  return (
    <div>
      <Link href="/dashboard/disputes" className="text-violet-600 text-sm font-semibold">← Back to disputes</Link>

      <div className="mt-4 mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {d.campaign_title || "Campaign"}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Dispute on application <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{d.application_id}</code>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Escrow">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Amount held" value={formatINR(d.escrow_amount)} highlight />
              <Field label="Funded at" value={formatDate(d.escrow_funded_at)} />
              <Field label="Razorpay payment" value={d.escrow_payment_id || "—"} mono />
              <Field label="Current status" value={d.escrow_status} />
            </div>
          </Section>

          <Section title="Dispute">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Field label="Opened at" value={formatDate(d.dispute_opened_at)} />
              <Field label="Resolution" value={d.dispute_resolution || "—"} />
              <Field label="Resolved at" value={formatDate(d.dispute_resolved_at)} />
              <Field label="Application status" value={d.application_status} />
            </div>
            {d.dispute_reason && (
              <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Brand's reason</p>
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{d.dispute_reason}</p>
              </div>
            )}
          </Section>

          {links.length > 0 && (
            <Section title={`Deliverables submitted (${links.length})`}>
              <ul className="space-y-2">
                {links.map((l: any, i: number) => (
                  <li key={i} className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-600 font-semibold text-sm hover:underline break-all"
                    >
                      {l.label || l.type || `Deliverable ${i + 1}`}
                    </a>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{l.url}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Parties">
            <div className="flex items-center gap-3 mb-4">
              {d.brand_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.brand_logo_url} alt={d.brand_name} className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-500">
                  {(d.brand_name || "B").charAt(0)}
                </div>
              )}
              <div>
                <p className="text-xs uppercase font-bold text-gray-400">Brand</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{d.brand_name || "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {d.influencer_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.influencer_avatar_url} alt={d.influencer_name} className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-500">
                  {(d.influencer_name || d.influencer_username || "C").charAt(0)}
                </div>
              )}
              <div>
                <p className="text-xs uppercase font-bold text-gray-400">Creator</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {d.influencer_name || (d.influencer_username ? `@${d.influencer_username}` : "—")}
                </p>
                {d.final_agreed_rate != null && (
                  <p className="text-xs text-gray-500 mt-0.5">Agreed: ₹{Number(d.final_agreed_rate).toLocaleString("en-IN")}</p>
                )}
              </div>
            </div>
          </Section>

          {!resolved ? (
            <Section title="Resolve">
              <ResolveActions applicationId={d.application_id} amount={d.escrow_amount} />
            </Section>
          ) : (
            <Section title="Resolved">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                This dispute was resolved via <strong>{d.dispute_resolution}</strong> on{" "}
                {formatDate(d.dispute_resolved_at)}.
              </p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p
        className={`text-sm ${highlight ? "font-black text-violet-600" : "font-semibold text-gray-900 dark:text-white"} ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value || "—"}
      </p>
    </div>
  );
}
