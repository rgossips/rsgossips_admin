import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { QuoteResponseForm } from "../_components/quote-response-form";
import { acceptCounterOffer } from "../actions";

export const dynamic = "force-dynamic";

export default async function QuoteRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("service_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();

  // Requester display info
  let userLabel = "Unknown";
  const [{ data: inf }, { data: br }] = await Promise.all([
    admin.from("influencer_profiles").select("full_name, username, instagram_handle, contact_phone, email").eq("influencer_id", order.user_id).maybeSingle(),
    admin.from("brand_profiles").select("brand_name, contact_phone, contact_email").eq("brand_id", order.user_id).maybeSingle(),
  ]);
  const userPhone = (inf as any)?.contact_phone || (br as any)?.contact_phone || "";
  const userEmail = (inf as any)?.email || (br as any)?.contact_email || "";
  if (inf) userLabel = inf.full_name || inf.username || (inf.instagram_handle ? `@${inf.instagram_handle}` : "Influencer");
  else if (br) userLabel = br.brand_name || "Brand";

  // Timeline
  const { data: events } = await admin
    .from("service_order_events")
    .select("*")
    .eq("order_id", id)
    .order("occurred_at", { ascending: true });

  // Platform fee % for live preview in the response form
  const { data: feeRow } = await admin
    .from("platform_config")
    .select("value")
    .eq("key", "service_platform_fee_pct")
    .maybeSingle();
  const platformFeePct = Number((feeRow as any)?.value) || 15;

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/quote-requests"
        className="text-[12px] font-semibold text-indigo-600 hover:underline"
      >
        ← Quote requests
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-mono text-gray-400">{order.order_number}</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {order.service_title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            From <span className="font-semibold text-gray-700 dark:text-gray-200">{userLabel}</span>
            {userPhone && <> · {userPhone}</>}
            {userEmail && <> · {userEmail}</>}
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-amber-50 text-amber-700">
          {order.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — brief */}
        <div className="lg:col-span-2 space-y-4">
          <Card title="Project description">
            <p className="text-[13px] text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
              {order.description}
            </p>
          </Card>

          {order.asset_url && (
            <Card title="Asset link">
              <a
                href={order.asset_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-indigo-600 hover:underline break-all"
              >
                {order.asset_url}
              </a>
            </Card>
          )}

          {(order.style_references || order.notes) && (
            <Card title="Extras">
              {order.style_references && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                    Style references
                  </p>
                  <p className="text-[13px] text-gray-700 dark:text-gray-200">{order.style_references}</p>
                </div>
              )}
              {order.notes && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                    Additional notes
                  </p>
                  <p className="text-[13px] text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                    {order.notes}
                  </p>
                </div>
              )}
            </Card>
          )}

          <Card title="Timeline">
            <ul className="space-y-3">
              {(events || []).map((e) => (
                <li key={e.id} className="flex gap-3 text-[12px]">
                  <span className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-indigo-500" />
                  <div>
                    <p className="font-semibold text-gray-700 dark:text-gray-200">{e.label}</p>
                    <p className="text-gray-400">
                      {new Date(e.occurred_at).toLocaleString("en-IN")}
                    </p>
                  </div>
                </li>
              ))}
              {(events || []).length === 0 && (
                <li className="text-[12px] text-gray-400">No events yet.</li>
              )}
            </ul>
          </Card>
        </div>

        {/* Right — summary */}
        <div className="space-y-4">
          <Card title="Order summary">
            <Field label="Status" value={order.status.replace(/_/g, " ")} />
            <Field label="Scope" value={order.scope || "—"} />
            <Field label="Budget range" value={order.budget_range || "—"} />
            <Field
              label="Desired delivery"
              value={
                order.desired_delivery_date
                  ? new Date(order.desired_delivery_date).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"
              }
            />
            <Field
              label="Submitted"
              value={new Date(order.created_at).toLocaleString("en-IN")}
            />
          </Card>

          {/* Status-dependent action card. pending_quote → send quote /
              decline; counter_offered → accept counter, send new quote, or
              decline; everything else → read-only summary card. */}
          {order.status === "pending_quote" && (
            <QuoteResponseForm
              orderId={order.id}
              serviceTitle={order.service_title || ""}
              desiredDeliveryDate={order.desired_delivery_date}
              platformFeePct={platformFeePct}
            />
          )}

          {order.status === "counter_offered" && (
            <div className="space-y-3">
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                <p className="text-[11px] font-bold text-orange-700 dark:text-orange-300 uppercase tracking-wider">
                  Counter offer received
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                  ₹{Number(order.counter_amount || 0).toLocaleString("en-IN")}
                </p>
                {order.counter_message && (
                  <p className="text-[12px] text-gray-600 dark:text-gray-300 mt-2 italic">
                    "{order.counter_message}"
                  </p>
                )}
                <form
                  action={async () => {
                    "use server";
                    await acceptCounterOffer(order.id);
                  }}
                  className="mt-3"
                >
                  <button
                    type="submit"
                    className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
                  >
                    Accept counter — ₹{Number(order.counter_amount || 0).toLocaleString("en-IN")}
                  </button>
                </form>
              </div>
              <QuoteResponseForm
                orderId={order.id}
                serviceTitle={order.service_title || ""}
                desiredDeliveryDate={order.desired_delivery_date}
                platformFeePct={platformFeePct}
              />
            </div>
          )}

          {!["pending_quote", "counter_offered"].includes(order.status) && (
            <Card title="Quote summary">
              {order.quoted_amount ? (
                <>
                  <Field label="Quoted" value={`₹${Number(order.quoted_amount).toLocaleString("en-IN")}`} />
                  <Field label="Platform fee" value={`₹${Number(order.platform_fee_amount || 0).toLocaleString("en-IN")}`} />
                  <Field label="Total" value={`₹${Number(order.total_amount || 0).toLocaleString("en-IN")}`} />
                  <Field label="Advance" value={`${order.advance_pct}%`} />
                  <Field
                    label="Valid until"
                    value={order.quote_valid_until ? new Date(order.quote_valid_until).toLocaleDateString("en-IN") : "—"}
                  />
                </>
              ) : (
                <p className="text-[12px] text-gray-500 dark:text-gray-400">
                  No quote was sent on this order.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {subtitle && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
      )}
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px] py-1">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-700 dark:text-gray-200 text-right">{value}</span>
    </div>
  );
}
