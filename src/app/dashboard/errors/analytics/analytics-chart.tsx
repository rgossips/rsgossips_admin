"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ErrorDay = { date: string; label: string; errors: number; warnings: number; open: number; users: number };

type SeriesKey = "errors" | "warnings" | "open";

// Card colours carry the meaning (red = errors, amber = warnings, slate =
// still open) and double as the chart colours, so a card and its marks always
// read as the same series.
const SERIES: Record<SeriesKey, { label: string; sub: string; fill: string; on: string }> = {
  errors: { label: "Errors", sub: "error + fatal", fill: "#d9463b", on: "bg-[#d9463b] text-white border-[#d9463b]" },
  warnings: { label: "Warnings", sub: "warn", fill: "#e8a33b", on: "bg-[#e8a33b] text-white border-[#e8a33b]" },
  open: { label: "Open", sub: "not yet addressed", fill: "#334155", on: "bg-[#334155] text-white border-[#334155]" },
};

const tooltipStyle = {
  backgroundColor: "rgba(255,255,255,0.97)",
  border: "1px solid #e5e7eb",
  borderRadius: "10px",
  fontSize: "12px",
  padding: "8px 12px",
};

// Search Console-style toggle cards over a daily bar chart. Clicking a card
// shows/hides that series; "Affected users" overlays distinct users per day.
export function ErrorsAnalyticsChart({
  days,
  totals,
  statusLive,
}: {
  days: ErrorDay[];
  totals: { errors: number; warnings: number; open: number; users: number };
  // false until migration 068: nothing can be addressed, so Open = everything.
  statusLive: boolean;
}) {
  const [shown, setShown] = useState<Record<SeriesKey, boolean>>({ errors: true, warnings: true, open: false });
  const [showUsers, setShowUsers] = useState(false);
  const toggle = (k: SeriesKey) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const nothingPlotted = !shown.errors && !shown.warnings && !shown.open && !showUsers;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Toggle cards */}
      <div className="flex flex-wrap">
        {(Object.keys(SERIES) as SeriesKey[]).map((k, i) => {
          const s = SERIES[k];
          const on = shown[k];
          return (
            <button
              key={k}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => toggle(k)}
              className={`w-1/2 sm:w-56 border-b border-r px-6 py-5 text-left transition-colors cursor-pointer ${i === 0 ? "rounded-tl-2xl" : ""} ${
                on ? s.on : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/60"
              }`}
            >
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <span className={`flex h-4 w-4 items-center justify-center rounded-[3px] border ${on ? "border-white bg-white" : "border-gray-400 dark:border-gray-500"}`}>
                  {on && (
                    <svg className="h-3 w-3" style={{ color: s.fill }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                {s.label}
              </span>
              <span className="mt-2 block text-3xl font-normal tabular-nums">{totals[k].toLocaleString("en-IN")}</span>
              <span className={`mt-1 block text-[12px] ${on ? "text-white/85" : "text-gray-400"}`}>
                {k === "open" && !statusLive ? "all — tracking needs migration 068" : s.sub}
              </span>
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-4 pt-5 sm:px-6">
        <label className="mb-4 flex w-fit cursor-pointer items-center gap-2.5 text-[14px] text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={showUsers}
            onChange={(e) => setShowUsers(e.target.checked)}
            className="h-5 w-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
          />
          Affected users <span className="text-[12px] text-gray-400">({totals.users.toLocaleString("en-IN")} distinct)</span>
        </label>

        <p className="mb-1 text-[12px] text-gray-500">Items</p>
        <div className="relative">
          {nothingPlotted && (
            <p className="absolute inset-0 z-10 flex items-center justify-center text-[13px] text-gray-400">
              Select Errors, Warnings, Open or Affected users to plot.
            </p>
          )}
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={days} margin={{ top: 4, right: showUsers ? 8 : 0, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={{ stroke: "#9ca3af" }} minTickGap={24} />
              <YAxis yAxisId="items" allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
              {showUsers && (
                <YAxis yAxisId="users" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: "#6366f1" }} tickLine={false} axisLine={false} />
              )}
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(99,102,241,0.06)" }} />
              {shown.errors && <Bar yAxisId="items" dataKey="errors" name="Errors" stackId="items" fill={SERIES.errors.fill} maxBarSize={14} />}
              {shown.warnings && <Bar yAxisId="items" dataKey="warnings" name="Warnings" stackId="items" fill={SERIES.warnings.fill} maxBarSize={14} />}
              {/* Open is a subset of errors + warnings, so it's a line on the
                  same axis rather than a stacked bar (which would count rows twice). */}
              {shown.open && (
                <Line yAxisId="items" type="monotone" dataKey="open" name="Open" stroke={SERIES.open.fill} strokeWidth={2} dot={{ r: 2 }} />
              )}
              {showUsers && (
                <Line yAxisId="users" type="monotone" dataKey="users" name="Affected users" stroke="#6366f1" strokeWidth={2} dot={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
