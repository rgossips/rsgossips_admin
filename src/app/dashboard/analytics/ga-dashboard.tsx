"use client";

import Link, { useLinkStatus } from "next/link";
import { ButtonSpinner } from "@/components/spinner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GaOverview } from "./ga-actions";

const nf = new Intl.NumberFormat("en-IN");
const WINDOWS = [7, 30, 90] as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

/**
 * The spinner inside a window tab.
 *
 * `useLinkStatus` only reports anything from INSIDE the <Link>, which is why
 * this is its own component rather than state in the parent. It is the right
 * tool here for the reason the Next docs give: the destination is a dynamic
 * route with no `loading.js`, so the navigation genuinely blocks — switching
 * window re-runs four Analytics queries and takes a second or two, which is
 * long enough to look like nothing happened.
 *
 * Deliberately NOT a route-level `loading.tsx`: that would blank all four
 * charts and replace them with a skeleton on every tab press. Keeping the
 * current numbers on screen while the next set loads is less jarring, and
 * the spinner says which tab you asked for.
 */
function TabLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className={`inline-flex items-center gap-1.5 ${pending ? "opacity-80" : ""}`}>
      {pending && <ButtonSpinner />}
      {children}
    </span>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
      {subtitle && <p className="mt-0.5 mb-3 text-[11px] text-gray-400">{subtitle}</p>}
      {children}
    </div>
  );
}

const shortDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};
const shortMonth = (ym: string) => {
  const d = new Date(ym + "-01T00:00:00Z");
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
};

export function GaDashboard({ data, window: windowDays }: { data: GaOverview; window: number }) {
  // Not wired up yet — explain exactly what is missing rather than render
  // empty charts that look like zero traffic. Same choice the ai-usage page
  // makes while its migration is unapplied.
  if (data.notConfigured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950/30">
        <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">Google Analytics isn&apos;t connected yet</h2>
        <p className="mt-1 text-[13px] text-amber-800 dark:text-amber-300">{data.notConfigured}</p>
        <div className="mt-4 space-y-2 text-[13px] text-amber-900 dark:text-amber-200">
          <p className="font-semibold">Two values are needed, both from Google:</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <code className="rounded bg-amber-100 px-1 font-mono text-[12px] dark:bg-amber-900/40">GA_PROPERTY_ID</code>{" "}
              — the <strong>numeric</strong> property id from GA → Admin → Property Settings. Not the{" "}
              <code className="font-mono text-[12px]">G-EHKNXSHNB3</code> measurement id already on the website.
            </li>
            <li>
              <code className="rounded bg-amber-100 px-1 font-mono text-[12px] dark:bg-amber-900/40">GA_SERVICE_ACCOUNT_JSON</code>{" "}
              — a Google Cloud service-account key (raw JSON or base64), with the{" "}
              <strong>Google Analytics Data API</strong> enabled, and that service account&apos;s email added as a{" "}
              <strong>Viewer</strong> under GA → Admin → Property Access Management.
            </li>
          </ol>
          <p className="pt-1 text-[12px]">
            Both go in <code className="font-mono">.env.local</code> and in Netlify. Nothing is collected
            retroactively by this page — the website has been reporting to GA all along, so the history is
            already there waiting.
          </p>
        </div>
      </div>
    );
  }

  if (data.error && !data.daily?.length) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-[13px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
        {data.error}
      </div>
    );
  }

  const daily = data.daily || [];
  const monthly = data.monthly || [];
  const pages = data.topPages || [];
  const peak = daily.reduce((m, d) => Math.max(m, d.activeUsers), 0);

  return (
    <div className="space-y-5">
      {data.error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[12px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Some panels could not load: {data.error}
        </p>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active today" value={nf.format(data.rolling?.dau ?? 0)} hint="DAU · rolling 1 day" />
        <Stat label="Active this week" value={nf.format(data.rolling?.wau ?? 0)} hint="WAU · rolling 7 days" />
        <Stat label="Active this month" value={nf.format(data.rolling?.mau ?? 0)} hint="MAU · rolling 28 days" />
        <Stat
          label="Page visits"
          value={nf.format(data.totals?.pageViews ?? 0)}
          hint={`last ${windowDays} days · ${nf.format(data.totals?.sessions ?? 0)} sessions`}
        />
      </div>

      {/* Why these are not the whole story. Stated once, plainly. */}
      <p className="rounded-xl bg-gray-50 px-4 py-3 text-[12px] leading-relaxed text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
        Google Analytics is installed on the <strong>website only</strong>. The mobile app carries Firebase
        messaging but no analytics SDK, so its users are not counted here — measured against device sessions,
        that is about <strong>7%</strong> of active users. GA also counts signed-out visitors, which the
        database cannot see at all.
      </p>

      <div className="flex gap-1.5">
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={`/dashboard/analytics?days=${w}`}
            // The page is force-dynamic, so a prefetch cannot fetch the data
            // anyway; asking for one would spend a request to learn nothing.
            prefetch={false}
            aria-current={windowDays === w ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              windowDays === w
                ? "bg-indigo-600 text-white"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            <TabLabel>{w} days</TabLabel>
          </Link>
        ))}
      </div>

      <Panel title="Daily active users" subtitle={`Last ${windowDays} days · peak ${nf.format(peak)}`}>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="dauFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={(v) => shortDay(String(v))}
                formatter={(value, name) => [nf.format(Number(value ?? 0)), name === "activeUsers" ? "Active users" : String(name)]}
                contentStyle={{ fontSize: 12, borderRadius: 12 }}
              />
              <Area type="monotone" dataKey="activeUsers" stroke="#6366f1" strokeWidth={2} fill="url(#dauFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Page visits per day" subtitle={`Last ${windowDays} days`}>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={(v) => shortDay(String(v))}
                formatter={(value) => [nf.format(Number(value ?? 0)), "Page views"]}
                contentStyle={{ fontSize: 12, borderRadius: 12 }}
              />
              <Bar dataKey="pageViews" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel
        title="Monthly active users"
        /* The caveat that stops someone adding up the daily chart and
           getting a different, larger number. */
        subtitle="Last 12 months. Each month counts a person once, so this is NOT the sum of the daily chart above."
      >
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={(v) => shortMonth(String(v))}
                formatter={(value, name) => [nf.format(Number(value ?? 0)), name === "activeUsers" ? "Active users" : "Page views"]}
                contentStyle={{ fontSize: 12, borderRadius: 12 }}
              />
              <Bar dataKey="activeUsers" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Most visited pages" subtitle={`Last ${windowDays} days`}>
        {pages.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-gray-400">No page data for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-400 dark:border-gray-800">
                  <th className="py-2 pr-4 font-semibold">Page</th>
                  <th className="py-2 pr-4 text-right font-semibold">Views</th>
                  <th className="py-2 text-right font-semibold">Users</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.path} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="py-2 pr-4">
                      <span className="font-mono text-[12px] text-gray-700 dark:text-gray-300">{p.path}</span>
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold text-gray-900 dark:text-white">
                      {nf.format(p.views)}
                    </td>
                    <td className="py-2 text-right text-gray-500 dark:text-gray-400">{nf.format(p.users)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
