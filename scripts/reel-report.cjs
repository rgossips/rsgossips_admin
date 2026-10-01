// Build the Adinfinity analytics sheet in one pass: per-reel metrics plus a
// live follower check for every creator.
//
//   node scripts/reel-report.cjs
//
// Two things this gets right that a naive version does not:
//
// 1. HIDDEN LIKE COUNTS. A creator can switch off public like counts. When
//    they have, Instagram still returns a `like_count` — but it is a
//    placeholder (3 on every such post), not the truth. The giveaway is
//    `like_and_view_counts_disabled: true`. Writing the placeholder makes the
//    column silently wrong and drags any average down with it, so those cells
//    are marked "hidden" instead. View counts stay: play_count is real even
//    when likes are masked.
//
// 2. THE SHEET RANGE. Writing a cell outside the sheet's `!ref` leaves it
//    invisible to Excel and to sheet_to_json — the data is in the file and
//    nothing reads it. Any new column has to extend the range.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SOURCE = process.env.SOURCE_XLSX || "C:/Users/rocko/Downloads/Vega X Adinfinity.xlsx";
const BASE = process.env.BASE_XLSX || "C:/Users/rocko/Downloads/Adinfinity Analytics (filled).xlsx";
const OUT = process.env.OUT_XLSX || "C:/Users/rocko/Downloads/Adinfinity Analytics (final).xlsx";
const SHEET = "Sep";
const CONCURRENCY = 3;

const key = (() => {
  const env = fs.readFileSync(path.resolve(__dirname, "..", ".env.local"), "utf8");
  const k = (env.match(/^HIKER_API_KEY=(.*)$/m) || [])[1];
  if (!k) throw new Error("HIKER_API_KEY missing from .env.local");
  return k.trim().replace(/^["']|["']$/g, "");
})();

const api = async (p) => {
  const r = await fetch("https://api.hikerapi.com" + p, { headers: { "x-access-key": key, accept: "application/json" } });
  if (r.status === 402) throw new Error("HikerAPI out of credits");
  if (!r.ok) return { __error: `HTTP ${r.status}` };
  return r.json();
};

const shortcode = (u) => { const m = String(u || "").match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : ""; };
const handleOf = (u) => { const m = String(u || "").match(/instagram\.com\/([A-Za-z0-9._]+)/i); return m ? m[1].toLowerCase().replace(/\/$/, "") : ""; };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// "6,628" -> 6628 | "28.4k" -> 28400
const parseFollowers = (v) => {
  if (typeof v === "number") return v;
  const s = String(v || "").trim().toLowerCase().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([km])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.round(n * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1)) : null;
};

async function pool(items, worker) {
  const queue = [...items];
  let done = 0;
  const run = async () => {
    while (queue.length) {
      await worker(queue.shift());
      if (++done % 20 === 0) console.log(`  ${done}/${items.length}…`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

(async () => {
  // Handles come from the source workbook, joined on the reel shortcode.
  const src = XLSX.readFile(SOURCE);
  const handleByCode = new Map();
  for (const name of src.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(src.Sheets[name], { header: 1, defval: "" });
    const h = (rows[0] || []).map((x) => String(x).trim());
    for (let i = 1; i < rows.length; i++) {
      const sc = shortcode(rows[i][h.indexOf("IG Live Link")]);
      if (sc && !handleByCode.has(sc)) handleByCode.set(sc, handleOf(rows[i][h.indexOf("IG Link")]));
    }
  }

  const wb = XLSX.readFile(BASE);
  const ws = wb.Sheets[SHEET];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const H = rows[0].map((x) => String(x).trim());
  const C = {
    link: H.indexOf("Live Link"),
    followers: H.indexOf("Followers"),
    views: H.indexOf("Views"),
    likes: H.indexOf("Likes"),
    comments: H.findIndex((h) => /^comm?ments$/i.test(h)),
    share: H.indexOf("Share"),
    repost: H.indexOf("Repost"),
  };
  // New columns appended after the last existing one.
  const NEW = ["Followers (checked)", "Variance %", "Saves", "Likes/View %", "Data note"];
  const firstNew = H.length;
  NEW.forEach((label, i) => { ws[XLSX.utils.encode_cell({ r: 0, c: firstNew + i })] = { t: "s", v: label }; });

  const put = (r, c, v) => {
    if (c < 0 || v === null || v === undefined || v === "") return;
    ws[XLSX.utils.encode_cell({ r, c })] = typeof v === "number" ? { t: "n", v } : { t: "s", v: String(v) };
  };

  // ── per-reel metrics ───────────────────────────────────────────────
  const reelJobs = [];
  for (let i = 1; i < rows.length; i++) {
    const url = String(rows[i][C.link] || "").trim();
    if (shortcode(url)) reelJobs.push({ r: i, url });
  }
  console.log(`fetching ${reelJobs.length} reels…`);
  let hidden = 0, failed = 0;
  await pool(reelJobs, async (job) => {
    const j = await api("/v2/media/by/url?url=" + encodeURIComponent(job.url.split("?")[0]));
    const m = j?.items?.[0] || j?.media || j?.data;
    if (!m || j.__error) { failed++; put(job.r, firstNew + 4, "lookup failed"); return; }
    const views = num(m.play_count) ?? num(m.ig_play_count) ?? num(m.view_count);
    put(job.r, C.views, views);
    // Likes only when the creator has not hidden them.
    if (m.like_and_view_counts_disabled) {
      hidden++;
      put(job.r, C.likes, "hidden");
      put(job.r, firstNew + 4, "creator hides like counts");
    } else {
      put(job.r, C.likes, num(m.like_count));
      if (views && num(m.like_count) !== null && views > 0) {
        put(job.r, firstNew + 3, Math.round((m.like_count / views) * 1000) / 10);
      }
    }
    put(job.r, C.comments, num(m.comment_count));
    put(job.r, C.share, num(m.reshare_count) ?? num(m.share_count));
    put(job.r, C.repost, num(m.media_repost_count));
    put(job.r, firstNew + 2, num(m.save_count));
  });

  // ── follower check, one call per unique handle ─────────────────────
  const byHandle = new Map();
  for (let i = 1; i < rows.length; i++) {
    const h = handleByCode.get(shortcode(rows[i][C.link]));
    if (!h) continue;
    if (!byHandle.has(h)) byHandle.set(h, []);
    byHandle.get(h).push(i);
  }
  console.log(`\nchecking ${byHandle.size} creator profiles…`);
  const variances = [];
  await pool([...byHandle.entries()], async ([handle, rowIdx]) => {
    const j = await api("/v1/user/by/username?username=" + encodeURIComponent(handle));
    const now = num(j?.follower_count);
    for (const i of rowIdx) {
      if (now === null) { put(i, firstNew, "not found"); continue; }
      put(i, firstNew, now);
      const claimed = parseFollowers(rows[i][C.followers]);
      if (claimed) {
        const v = Math.round(((now - claimed) / claimed) * 100);
        put(i, firstNew + 1, v);
        variances.push({ row: i + 1, name: rows[i][1], handle, claimed, now, v });
      }
    }
  });

  // Extend the sheet range, or none of the new columns exist as far as Excel
  // is concerned.
  const range = XLSX.utils.decode_range(ws["!ref"]);
  range.e.c = Math.max(range.e.c, firstNew + NEW.length - 1);
  ws["!ref"] = XLSX.utils.encode_range(range);

  XLSX.writeFile(wb, OUT);

  console.log(`\nreels: ${reelJobs.length - failed} ok, ${failed} failed | ${hidden} creators hide their like counts`);
  const over = variances.filter((x) => x.v <= -20).sort((a, b) => a.v - b.v);
  const grew = variances.filter((x) => x.v >= 50).sort((a, b) => b.v - a.v);
  const close = variances.filter((x) => Math.abs(x.v) <= 10).length;
  console.log(`followers: ${variances.length} compared | ${close} within 10% of the sheet | ${over.length} overstated by 20%+ | ${grew.length} grown 50%+`);
  if (over.length) { console.log("\noverstated in the sheet:"); over.slice(0, 15).forEach((o) => console.log(`  row ${o.row} ${String(o.name).slice(0, 22)} @${o.handle}: sheet ${o.claimed} -> actual ${o.now} (${o.v}%)`)); }
  if (grew.length) { console.log("\ngrown since the sheet was made:"); grew.slice(0, 8).forEach((o) => console.log(`  row ${o.row} ${String(o.name).slice(0, 22)}: ${o.claimed} -> ${o.now} (+${o.v}%)`)); }
  console.log(`\nwritten to ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
