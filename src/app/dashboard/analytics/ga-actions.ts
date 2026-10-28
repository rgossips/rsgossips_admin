"use server";

import { requireAdmin } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import { gaConfigured, runReport } from "@/lib/analytics/ga";

export type DayPoint = { date: string; activeUsers: number; pageViews: number; sessions: number };
export type MonthPoint = { month: string; activeUsers: number; pageViews: number };
export type PageRow = { path: string; views: number; users: number };

export type GaOverview = {
  error?: string;
  /** Set when GA simply isn't wired up yet, so the page can explain rather than look broken. */
  notConfigured?: string;
  daily?: DayPoint[];
  monthly?: MonthPoint[];
  topPages?: PageRow[];
  rolling?: { dau: number; wau: number; mau: number };
  totals?: { pageViews: number; sessions: number };
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Everything the analytics page shows, in one call.
 *
 * ONE SUBTLETY WORTH KEEPING RIGHT: monthly active users is NOT the sum of
 * daily active users. GA dedupes people within whatever grain you ask for,
 * so a creator who visits on twelve days is twelve daily-actives but one
 * monthly-active. Summing the daily series would therefore overstate the
 * month by several times over. The monthly figures come from their own query
 * with a `yearMonth` dimension, and the rolling DAU/WAU/MAU from GA's own
 * active1DayUsers / active7DayUsers / active28DayUsers metrics.
 */
export async function getGaOverview(days = 30): Promise<GaOverview> {
  try {
    await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }

  const cfg = gaConfigured();
  if (!cfg.configured) return { notConfigured: cfg.reason };

  const window = Math.min(Math.max(Math.trunc(days) || 30, 7), 365);
  const end = new Date();
  const start = new Date(end.getTime() - (window - 1) * 86400000);
  const monthStart = new Date(end.getTime() - 364 * 86400000);

  const [dailyRes, monthlyRes, pagesRes, rollingRes] = await Promise.all([
    runReport({
      dimensions: ["date"],
      metrics: ["activeUsers", "screenPageViews", "sessions"],
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      limit: 400,
      // Page views and sessions ARE additive across days, so a total is
      // meaningful. Active users is not, which is why the headline MAU
      // comes from active28DayUsers below rather than from any total.
      withTotals: true,
    }),
    runReport({
      dimensions: ["yearMonth"],
      metrics: ["activeUsers", "screenPageViews"],
      startDate: fmtDate(monthStart),
      endDate: fmtDate(end),
      limit: 24,
    }),
    runReport({
      dimensions: ["pagePath"],
      metrics: ["screenPageViews", "activeUsers"],
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      limit: 20,
      orderByMetric: "screenPageViews",
    }),
    // GA's own rolling-window metrics. They must be queried WITHOUT a date
    // dimension — they describe the window ending on the last day, not a
    // per-day value.
    runReport({
      metrics: ["active1DayUsers", "active7DayUsers", "active28DayUsers"],
      startDate: fmtDate(end),
      endDate: fmtDate(end),
    }),
  ]);

  // One failed panel should not blank the page; report the first real error
  // but keep whatever else came back.
  const firstError = [dailyRes, monthlyRes, pagesRes, rollingRes].find((r) => !r.ok);
  if (firstError && !firstError.ok) {
    logError("analytics.ga", new Error(firstError.error), { window });
    if (!dailyRes.ok && !monthlyRes.ok) return { error: firstError.error };
  }

  const daily: DayPoint[] = dailyRes.ok
    ? dailyRes.data.rows.map((r) => ({
        // GA returns YYYYMMDD.
        date: `${r.dims[0]?.slice(0, 4)}-${r.dims[0]?.slice(4, 6)}-${r.dims[0]?.slice(6, 8)}`,
        activeUsers: r.metrics[0] ?? 0,
        pageViews: r.metrics[1] ?? 0,
        sessions: r.metrics[2] ?? 0,
      }))
    : [];

  const monthly: MonthPoint[] = monthlyRes.ok
    ? monthlyRes.data.rows.map((r) => ({
        month: `${r.dims[0]?.slice(0, 4)}-${r.dims[0]?.slice(4, 6)}`,
        activeUsers: r.metrics[0] ?? 0,
        pageViews: r.metrics[1] ?? 0,
      }))
    : [];

  const topPages: PageRow[] = pagesRes.ok
    ? pagesRes.data.rows.map((r) => ({ path: r.dims[0] || "/", views: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 }))
    : [];

  const rolling = rollingRes.ok
    ? {
        dau: rollingRes.data.rows[0]?.metrics[0] ?? rollingRes.data.totals[0] ?? 0,
        wau: rollingRes.data.rows[0]?.metrics[1] ?? rollingRes.data.totals[1] ?? 0,
        mau: rollingRes.data.rows[0]?.metrics[2] ?? rollingRes.data.totals[2] ?? 0,
      }
    : undefined;

  const totals = dailyRes.ok
    ? {
        pageViews: dailyRes.data.totals[1] ?? daily.reduce((n, d) => n + d.pageViews, 0),
        sessions: dailyRes.data.totals[2] ?? daily.reduce((n, d) => n + d.sessions, 0),
      }
    : undefined;

  return { daily, monthly, topPages, rolling, totals, error: firstError && !firstError.ok ? firstError.error : undefined };
}
