"use client";

import { useRef, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface FulfilmentData {
  month: string;
  completed: number;
  ongoing: number;
}

interface WeeklyCampaignData {
  week: string;
  count: number;
}

interface SignupData {
  month: string;
  influencers: number;
  brands: number;
}

interface DailySignupData {
  day: string;
  influencers: number;
  brands: number;
}

type ChartProps =
  | { type: "fulfilment"; data: FulfilmentData[] }
  | { type: "weeklyCampaigns"; data: WeeklyCampaignData[] }
  // `daily[m]` = that month's per-day rows; enables double-click drill-down.
  | { type: "signups"; data: SignupData[]; daily?: DailySignupData[][] };

const tooltipStyle = {
  backgroundColor: "rgba(255,255,255,0.95)",
  border: "none",
  borderRadius: "12px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  fontSize: "12px",
  padding: "8px 12px",
};

const axisStyle = { fontSize: 11, fill: "#9ca3af" };

export function DashboardCharts(props: ChartProps) {
  if (props.type === "fulfilment") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={props.data}>
          <defs>
            <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="ongoingGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={30} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area
            type="monotone"
            dataKey="completed"
            stroke="#6366f1"
            fill="url(#completedGradient)"
            strokeWidth={2.5}
          />
          <Area
            type="monotone"
            dataKey="ongoing"
            stroke="#22d3ee"
            fill="url(#ongoingGradient)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (props.type === "weeklyCampaigns") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={props.data}>
          <defs>
            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="week" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={30} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" fill="url(#barGradient)" radius={[8, 8, 0, 0]} barSize={48} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (props.type === "signups") {
    return <SignupsChart data={props.data} daily={props.daily} />;
  }

  return null;
}

// Monthly signups with a day-by-day drill-down: double-click a month to
// expand it, "All months" to go back. Module scope (it owns state) so it
// isn't recreated on every parent render.
function SignupsChart({ data, daily }: { data: SignupData[]; daily?: DailySignupData[][] }) {
  const [month, setMonth] = useState<number | null>(null);
  // Which month the pointer is over. Recharts reports the hovered category on
  // mouse move; the wrapper's native dblclick then reads it.
  const hovered = useRef<number | null>(null);
  const canDrill = !!daily && daily.length === data.length;
  const drilled = canDrill && month !== null;
  // One row shape for both views: `label` is the month name or the day number.
  const rows: { label: string; influencers: number; brands: number }[] = drilled
    ? daily![month!].map((d) => ({ label: d.day, influencers: d.influencers, brands: d.brands }))
    : data.map((d) => ({ label: d.month, influencers: d.influencers, brands: d.brands }));

  const onDoubleClick = () => {
    if (!canDrill || drilled || hovered.current === null) return;
    setMonth(hovered.current);
  };

  return (
    <div>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2 text-xs">
        {drilled ? (
          <>
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {data[month!].month} · daily ({data[month!].influencers + data[month!].brands} signups)
            </span>
            <button
              type="button"
              onClick={() => setMonth(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 cursor-pointer"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              All months
            </button>
          </>
        ) : (
          canDrill && <span className="text-gray-400">Double-click a month to see it day by day</span>
        )}
      </div>
      <div
        onDoubleClick={onDoubleClick}
        onMouseLeave={() => (hovered.current = null)}
        className={canDrill && !drilled ? "cursor-zoom-in select-none" : undefined}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={rows}
            onMouseMove={(state) => {
              const idx = Number(state?.activeTooltipIndex);
              hovered.current = Number.isInteger(idx) && idx >= 0 ? idx : null;
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="label"
              tick={axisStyle}
              axisLine={false}
              tickLine={false}
              interval={drilled ? "preserveStartEnd" : 0}
              minTickGap={drilled ? 8 : 0}
            />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label) => (drilled ? `${data[month!].month} ${label}` : String(label))}
            />
            <Bar dataKey="influencers" fill="#22d3ee" radius={[6, 6, 0, 0]} maxBarSize={drilled ? 10 : 20} />
            <Bar dataKey="brands" fill="#f472b6" radius={[6, 6, 0, 0]} maxBarSize={drilled ? 10 : 20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
