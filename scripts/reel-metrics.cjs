// Fill Views / Likes / Comments on the Adinfinity Analytics sheet from the
// reel links, via HikerAPI.
//
//   node scripts/reel-metrics.cjs --dry      list what would be fetched
//   node scripts/reel-metrics.cjs            fetch and write the workbook
//
// Why HikerAPI and not a plain fetch: Instagram serves logged-out visitors a
// shell page with no counts in it at all — checked, 638KB of HTML containing
// no like_count, play_count or og:description. The public
// /api/v1/media/shortcode/<code>/info/ endpoint 404s. So reading a public
// reel needs a provider with logged-in infrastructure, and HIKER_API_KEY is
// the one this project already pays for and already uses for enrichment.
//
// Each call spends HikerAPI credits — roughly one per reel, 104 of them.
//
// Share and Repost are NOT fetched and cannot be: Instagram exposes share and
// repost counts only to the account that owns the post, through its own
// insights. No third-party API can see them for someone else's reel. Those
// two columns stay empty for the creators to report, or stay at zero.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const WORKBOOK = process.env.ANALYTICS_XLSX || "C:/Users/rocko/Downloads/Adinfinity Analytics (filled).xlsx";
const OUT = process.env.ANALYTICS_OUT || "C:/Users/rocko/Downloads/Adinfinity Analytics (with metrics).xlsx";
const SHEET = process.env.ANALYTICS_SHEET || "Sep";

const HIKER_BASE = "https://api.hikerapi.com";
const CONCURRENCY = 3; // polite; the provider rate-limits above this
const RETRIES = 2;

function apiKey() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const key = (env.match(/^HIKER_API_KEY=(.*)$/m) || [])[1];
  if (!key) throw new Error("HIKER_API_KEY is not set in .env.local");
  return key.trim().replace(/^["']|["']$/g, "");
}

const shortcode = (u) => {
  const m = String(u || "").match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
};

// HikerAPI has shipped more than one media shape over the years, and a reel's
// view count has lived under four different names. Probe them all rather than
// writing `undefined` into the sheet.
function pick(obj, names) {
  for (const n of names) {
    const v = obj?.[n];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function readMetrics(payload) {
  // v2 answers {num_results, items:[...]}; older shapes put the object at the
  // top level or under .media/.data. Take whichever is there.
  const m = payload?.items?.[0] || payload?.media || payload?.data || payload || {};
  return {
    views: pick(m, ["play_count", "ig_play_count", "view_count", "video_view_count", "video_play_count"]),
    likes: pick(m, ["like_count", "likes", "edge_liked_by_count"]),
    comments: pick(m, ["comment_count", "comments", "edge_media_to_comment_count"]),
    // Instagram shows these only to the post owner in its own UI, but the
    // private-API media object carries them, so a provider sees them too.
    shares: pick(m, ["reshare_count", "share_count"]),
    reposts: pick(m, ["media_repost_count"]),
    saves: pick(m, ["save_count"]),
    owner: m?.user?.username || m?.owner?.username || null,
    taken_at: m?.taken_at || null,
  };
}

async function fetchOne(url, key) {
  // Strip the ?stkn= share token — it is per-share and not part of the media id.
  const clean = String(url).split("?")[0];
  let lastError = "";
  for (const endpoint of ["/v2/media/by/url", "/v1/media/by/url"]) {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const res = await fetch(`${HIKER_BASE}${endpoint}?url=${encodeURIComponent(clean)}`, {
          headers: { "x-access-key": key, accept: "application/json" },
        });
        const text = await res.text();
        if (res.status === 402) throw new Error("HikerAPI account is out of credits — top up at hikerapi.com/billing");
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        if (!res.ok) {
          lastError = `HTTP ${res.status} ${text.slice(0, 80)}`;
          break; // try the other endpoint shape
        }
        const metrics = readMetrics(JSON.parse(text));
        if (metrics.views === null && metrics.likes === null && metrics.comments === null && metrics.shares === null) {
          lastError = "response carried no counts";
          break;
        }
        return { ok: true, ...metrics };
      } catch (e) {
        if (/out of credits/.test(e.message)) throw e; // fatal, not worth retrying
        lastError = e.message;
      }
    }
  }
  return { ok: false, error: lastError || "no data" };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const wb = XLSX.readFile(WORKBOOK);
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`sheet "${SHEET}" not found in ${WORKBOOK}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const H = rows[0].map((x) => String(x).trim());
  const cLink = H.indexOf("Live Link");
  // The sheet spells it "Commments" — match whatever is actually there.
  const cViews = H.indexOf("Views");
  const cLikes = H.indexOf("Likes");
  const cComments = H.findIndex((h) => /^comm?ments$/i.test(h));
  const cShare = H.indexOf("Share");
  const cRepost = H.indexOf("Repost");
  if (cLink < 0 || cViews < 0 || cLikes < 0 || cComments < 0) {
    throw new Error(`columns not found: ${JSON.stringify({ cLink, cViews, cLikes, cComments })}`);
  }

  const jobs = [];
  for (let i = 1; i < rows.length; i++) {
    const url = String(rows[i][cLink] || "").trim();
    if (!url) continue;
    // Don't re-buy a row somebody already filled.
    if (String(rows[i][cViews] ?? "").trim() !== "") continue;
    if (!shortcode(url)) {
      console.log(`row ${i + 1}: not a recognisable reel/post link — ${url.slice(0, 60)}`);
      continue;
    }
    jobs.push({ row: i, url });
  }

  console.log(`${jobs.length} reels to fetch (rows already carrying Views are skipped)`);
  if (dry) {
    jobs.slice(0, 10).forEach((j) => console.log(`  row ${j.row + 1}  ${shortcode(j.url)}`));
    if (jobs.length > 10) console.log(`  …and ${jobs.length - 10} more`);
    return;
  }

  const key = apiKey();
  let done = 0, failed = 0;
  const failures = [];

  // Small pool rather than Promise.all over 104 — the provider rate-limits.
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      const r = await fetchOne(job.url, key);
      if (r.ok) {
        const put = (c, v) => {
          if (v === null) return;
          ws[XLSX.utils.encode_cell({ r: job.row, c })] = { t: "n", v };
        };
        put(cViews, r.views);
        put(cLikes, r.likes);
        put(cComments, r.comments);
        put(cShare, r.shares);
        put(cRepost, r.reposts);
        done++;
      } else {
        failed++;
        failures.push(`row ${job.row + 1} ${shortcode(job.url)} — ${r.error}`);
      }
      if ((done + failed) % 10 === 0) console.log(`  ${done + failed}/${jobs.length}…`);
    }
  };

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (e) {
    console.error(`\nStopped: ${e.message}`);
    console.error("Whatever was fetched before the stop is written below.");
  }

  XLSX.writeFile(wb, OUT);
  console.log(`\nfetched: ${done} | failed: ${failed}`);
  if (failures.length) {
    console.log("failures:");
    failures.slice(0, 20).forEach((f) => console.log("  " + f));
    if (failures.length > 20) console.log(`  …and ${failures.length - 20} more`);
  }
  console.log(`\nwritten to ${OUT}`);
  console.log("Share and Repost come from the media object's reshare_count / media_repost_count.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
