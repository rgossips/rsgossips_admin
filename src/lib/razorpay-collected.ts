// "Collected amount" straight from Razorpay — the only complete record of
// money received. The DB stores escrow + service payments but never
// subscription charges (renewals leave no row at all), so summing tables
// would undercount. App Store / Play purchases don't go through Razorpay and
// are NOT included.
//
// Server-only: needs RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET (the same live
// keys the consumer app's edge functions use). Never import from a client
// component.

const API = "https://api.razorpay.com/v1/payments";
// Razorpay rejects `from` below 2000-01-01 ("from must be between 946684800
// and 4765046400") — `from=0` failed the whole all-time scan with a 400.
const EARLIEST_FROM_SEC = 946684800;
const PAGE = 100; // Razorpay's max `count`
const MAX_PAGES = 200; // 20k payments per scan — a guard, not an expected size
// All-time total before today changes only through refunds, so it is cached
// and topped up with today's live figure on every request.
const HISTORY_TTL_MS = 30 * 60_000;

type RazorpayPayment = {
  id: string;
  amount: number; // paise
  amount_refunded?: number; // paise
  currency: string;
  status: string;
  captured: boolean;
  created_at: number; // unix seconds
};

export type CollectedResult =
  | { ok: true; todayPaise: number; totalPaise: number; todayCount: number; totalIsPartial: boolean }
  | { ok: false; reason: "not_configured" | "api_error"; message: string };

function authHeader(): string | null {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return null;
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

// Money actually kept: captured payments minus anything refunded. A fully
// refunded payment nets to 0; failed/authorized-only payments never count.
function netPaise(p: RazorpayPayment): number {
  if (!p.captured || p.currency !== "INR") return 0;
  return Math.max(0, p.amount - (p.amount_refunded || 0));
}

async function sumRange(auth: string, fromSec: number, toSec: number): Promise<{ paise: number; count: number; partial: boolean }> {
  let paise = 0;
  let count = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${API}?from=${fromSec}&to=${toSec}&count=${PAGE}&skip=${page * PAGE}`;
    const res = await fetch(url, { headers: { Authorization: auth }, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Razorpay ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { items?: RazorpayPayment[] };
    const items = json.items || [];
    for (const p of items) {
      const n = netPaise(p);
      if (n > 0) {
        paise += n;
        count++;
      }
    }
    if (items.length < PAGE) return { paise, count, partial: false };
  }
  return { paise, count, partial: true };
}

// Module-level memo: survives between requests on a warm server instance;
// a cold start simply rescans.
let history: { beforeSec: number; paise: number; partial: boolean; at: number } | null = null;

export async function getRazorpayCollected(todayStartSec: number): Promise<CollectedResult> {
  const auth = authHeader();
  if (!auth) {
    return { ok: false, reason: "not_configured", message: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set on the admin app." };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const stale = !history || history.beforeSec !== todayStartSec || Date.now() - history.at > HISTORY_TTL_MS;
    const [today, past] = await Promise.all([
      sumRange(auth, todayStartSec, nowSec),
      stale
        ? sumRange(auth, EARLIEST_FROM_SEC, todayStartSec - 1).then((r) => {
            history = { beforeSec: todayStartSec, paise: r.paise, partial: r.partial, at: Date.now() };
            return history;
          })
        : Promise.resolve(history!),
    ]);
    return {
      ok: true,
      todayPaise: today.paise,
      todayCount: today.count,
      totalPaise: past.paise + today.paise,
      totalIsPartial: past.partial || today.partial,
    };
  } catch (e) {
    return { ok: false, reason: "api_error", message: e instanceof Error ? e.message : String(e) };
  }
}
