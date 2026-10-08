// Reading a sourcing workbook — header matching and value normalisation.
//
// Plain module, no "use server": the parse runs in the BROWSER (the xlsx
// read already does, in bulk-invite), so a 300-row workbook never crosses
// the wire as a file. Only the normalised rows do, which is also what makes
// the preview free — classification is the only thing that needs a server.
//
// Shaped against the real Vega workbook: four sheets by tier, DIFFERENT
// columns on each, follower counts written "15.9k", handles written as full
// profile URLs, two phone numbers in one cell, prices written "10k". None of
// that is tidy, and none of it should have to be tidied by hand before an
// upload.

export type SourcingImportRow = {
  // Spreadsheet provenance, so a warning can point at a real cell.
  sheet: string;
  line: number;
  handle: string;
  // The handle cell exactly as the sheet wrote it. Kept because a handle
  // that parses to nonsense can only be diagnosed — or corrected — by
  // seeing the original: a pasted reel URL yields the handle "reel", and
  // the raw cell is the only way to tell that from a creator called reel.
  handleRaw: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  tier: string;
  category: string;
  followers: number | null;
  quotedFee: number | null;
  agreedFee: number | null;
  productCost: number | null;
  liveUrl: string;
  notes: string;
  // What the sheet's own status columns imply about where this creator
  // already stands. Never past `confirmed` — the later stages involve money
  // and must be walked deliberately.
  stage: "shortlisted" | "price_agreed" | "confirmed" | "declined";
  warnings: string[];
  // ── Historical columns, raw ────────────────────────────────────────────
  //
  // Left as the sheet wrote them. A backfill needs to tell "Barter" apart
  // from an unreadable number and "Live" apart from blank, and `stage`
  // above has already collapsed that detail away. Interpreting these is
  // import-vega.ts's job, not this parser's.
  progress: string;
  commercial: string;
  finalPayment: string;
  deliverables: string;
  product: string;
  orderId: string;
  // ISO date, or null when the cell was blank or unreadable.
  liveDate: string | null;
};

// Header aliases, lowercased and stripped of punctuation. One sheet says
// "Insta handle", another "Instagram Link"; matching on a canonical form
// beats maintaining an exact-label map for every workbook a brand sends.
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "creator name", "influencer name", "full name", "creator"],
  handle: [
    "insta handle",
    "instagram handle",
    "handle",
    "instagram",
    "insta",
    "instagram link",
    "instagram url",
    "profile link",
    "insta link",
    "username",
    // The payment workbook calls the column "Profile".
    "profile",
    // The Vega workbooks say "IG Link". Missing these meant every row in
    // those sheets parsed with no handle and was silently dropped as a
    // spacer — a seven-campaign import that reported success and wrote
    // nothing. Distinct from "ig live link" below, which is the deliverable.
    "ig link",
    "ig handle",
    "ig profile",
    "ig url",
    "ig",
  ],
  category: ["category", "categories", "niche", "genre"],
  followers: ["followers", "follower count", "followers count", "reach", "follower"],
  approval: ["approval status", "approved", "approval", "status"],
  quotedFee: ["pricing", "price", "quoted price", "quote", "asking price", "rate", "charges"],
  agreedFee: ["negotiated pricing", "negotiated price", "negotiated", "final price", "agreed price", "final rate"],
  productCost: ["product cost", "product price", "product value", "cost of product"],
  // "number" on its own is what the Vega barter sheets call the phone
  // column (168 rows). "s no" canonicalises differently, so the row-number
  // column is not caught by it.
  phone: ["contact number", "phone", "mobile", "contact", "whatsapp", "phone number", "number", "phone no", "contact no"],
  email: ["mail id", "email", "email id", "mail", "e mail", "gmail", "mail address"],
  address: ["address", "address optional", "delivery address", "shipping address", "full address"],
  confirmation: ["confirmation mail", "confirmation", "confirmation status", "confirmed"],
  liveUrl: ["live link", "live url", "post link", "reel link", "ig live link", "live"],
  notes: ["notes", "note", "remark", "remarks", "comment", "comments"],
  // Columns the historical Vega workbooks carry. Every one of these landed
  // in `unmapped` before, so adding them collides with nothing.
  //
  // `commercial` is kept RAW and separate from quotedFee on purpose: the
  // cell often reads "Barter" rather than a number, and that distinction is
  // what decides whether a finished row means "paid" or "no fee at all".
  progress: ["progress", "current status", "update", "video status"],
  commercial: ["commercial", "commercials", "deal type", "deal"],
  liveDate: ["live date", "posting date", "go live date", "posted on"],
  finalPayment: ["final payment", "payout status", "payment status", "payment"],
  deliverables: ["deliverables", "deliverable"],
  product: ["product", "product name", "sku"],
  orderId: ["order id", "order no", "order number"],
  // The address arrives split across up to four columns; parseSheet joins
  // them rather than letting the first non-empty one win.
  city: ["city", "town"],
  state: ["state"],
  pincode: ["pincode", "pin code", "pin", "zip", "postal code"],
};

const canon = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Build header label -> field name for one sheet's actual headers.
export function mapHeaders(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const c = canon(h);
    if (!c) continue;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(c)) {
        // Two headers may legitimately map to one field — the Macro sheet
        // carries both "Notes" and "Remark" — so BOTH are recorded and the
        // row reader takes the first that has a value. Letting the first
        // header win instead silently dropped whatever was in the second.
        out[h] = field;
        break;
      }
    }
  }
  return out;
}

// "@foo", "instagram.com/foo/", "https://www.instagram.com/foo?igsh=..." -> "foo"
export function handleFromCell(raw: string): string {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/^@+/, "");
  v = v.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  v = v.replace(/^instagram\.com\//i, "");
  // A cell can hold a name AND a link; take the first whitespace-free token
  // that looks like a handle.
  v = v.split(/[\s,|]+/).filter(Boolean)[0] || "";
  v = v.replace(/[/?#].*$/, "");
  return v.toLowerCase().replace(/[^a-z0-9._]/g, "");
}

// "5k" 5000 · "15.9k" 15900 · "1.2m" 1200000 · "35,000" 35000 · "12 K" 12000
export function parseCount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  // Strip everything before the first digit rather than enumerating currency
  // prefixes: price cells arrive as "Rs 10k", "INR 10,000", "₹10k" and
  // "10k/-", and a prefix list will always be one spelling short.
  const s = String(raw)
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/^[^0-9]*/, "");
  const m = s.match(/^([0-9]*\.?[0-9]+)([km])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return Math.round(n * mult);
}

// Prices come through the same reader — "10k" is ten thousand rupees here
// just as it is ten thousand followers there. Rupees out; the server does
// the single rupees -> paise conversion.
export const parseMoney = parseCount;

// "9528225691/ +91 94111 87807" -> "9528225691". The raw cell survives in
// the row's notes so the second number is not lost.
export function parsePhone(raw: string): { phone: string; extra: boolean } {
  const s = String(raw || "");
  const candidates = s.split(/[/,;|&]+|\bor\b/i);
  for (const c of candidates) {
    const digits = c.replace(/\D/g, "").replace(/^0+/, "").replace(/^91(?=\d{10}$)/, "");
    if (digits.length === 10) return { phone: digits, extra: candidates.length > 1 };
  }
  const all = s.replace(/\D/g, "");
  return { phone: all ? all.slice(-10) : "", extra: candidates.length > 1 };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// Typos we flag but NEVER silently correct — "fixing" an address to one the
// creator does not own sends their fee confirmation to a stranger.
const SUSPECT_DOMAINS = ["gnail.com", "gmial.com", "gmail.co", "gmai.com", "yahooo.com", "hotmai.com", "gmail.cm"];

export function parseEmail(raw: string): { email: string; warning: string | null } {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return { email: "", warning: null };
  if (!EMAIL_RE.test(v)) return { email: v, warning: `"${v}" doesn't look like an email` };
  const domain = v.split("@")[1] || "";
  if (SUSPECT_DOMAINS.includes(domain)) return { email: v, warning: `"${v}" — is that domain a typo?` };
  return { email: v, warning: null };
}

// A date cell, which arrives two completely different ways in one column:
// 104 rows are strings like "30/09/26" and 11 are raw Excel serials like
// 46122, because somebody retyped a few cells and Excel converted those.
//
// Day-first is unambiguous for these workbooks — the day is 13 or higher on
// most rows and never a valid month — but it is still only a convention, so
// anything landing outside a sane window is rejected with a warning instead
// of silently becoming a date in 1905 or 2087.
const DATE_FLOOR = Date.UTC(2024, 0, 1);
const DATE_CEIL = Date.UTC(2027, 11, 31);

export function parseSheetDate(raw: unknown): { iso: string | null; warning: string | null } {
  if (raw == null || String(raw).trim() === "") return { iso: null, warning: null };

  let ms: number | null = null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel's epoch is 1899-12-30: 1900 is treated as a leap year, and the
    // two-day offset absorbs that bug.
    ms = Date.UTC(1899, 11, 30) + Math.round(raw) * 86_400_000;
  } else {
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const yearRaw = Number(m[3]);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        ms = Date.UTC(year, month - 1, day);
      }
    } else {
      const parsed = Date.parse(s);
      if (Number.isFinite(parsed)) ms = parsed;
    }
  }

  if (ms == null || !Number.isFinite(ms)) {
    return { iso: null, warning: `Couldn't read the date "${String(raw)}"` };
  }
  if (ms < DATE_FLOOR || ms > DATE_CEIL) {
    return { iso: null, warning: `The date "${String(raw)}" is outside 2024-2027 — ignored` };
  }
  return { iso: new Date(ms).toISOString(), warning: null };
}

const YES = /^(yes|y|approved|done|ok|confirmed|true|1)$/i;
const NO = /^(no|n|rejected|declined|not interested|false|0)$/i;
const SENT = /^(sent|mail sent|shared|yes|done)$/i;

// Where the sheet's own columns say this creator already stands.
//
// Capped at `confirmed` on purpose. A sheet cell reading "Reimbursed" is
// someone's memory of a payment, and importing it would make the portal
// assert a payout happened without a record of who made it — so the later
// stages are walked in the portal, where each one is logged.
function inferStage(approval: string, confirmation: string): SourcingImportRow["stage"] {
  const a = String(approval || "").trim();
  const c = String(confirmation || "").trim();
  if (NO.test(a)) return "declined";
  if (c && SENT.test(c)) return "confirmed";
  if (YES.test(a)) return "price_agreed";
  return "shortlisted";
}

export type ParsedSheet = { sheet: string; rows: SourcingImportRow[]; unmapped: string[] };

// One sheet of a workbook. `records` is what XLSX.sheet_to_json gives back.
export function parseSheet(
  sheetName: string,
  records: Record<string, unknown>[],
  headers: string[],
): ParsedSheet {
  const headerMap = mapHeaders(headers);
  const unmapped = headers.filter((h) => canon(h) && !headerMap[h]);
  const rows: SourcingImportRow[] = [];

  records.forEach((rec, i) => {
    const get = (field: string): string => {
      for (const [label, f] of Object.entries(headerMap)) {
        if (f === field) {
          const v = rec[label];
          if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
        }
      }
      return "";
    };

    // The cell UNSTRINGIFIED. A date written by Excel arrives as the number
    // 46122, and `get` above would hand on "46122", which no date parser
    // can tell apart from a typo. Only the date reader needs this.
    const getRaw = (field: string): unknown => {
      for (const [label, f] of Object.entries(headerMap)) {
        if (f === field) {
          const v = rec[label];
          if (v !== undefined && v !== null && String(v).trim() !== "") return v;
        }
      }
      return null;
    };

    const handle = handleFromCell(get("handle"));
    // A row with no handle is a spacer, a total line or a stray note. There
    // is nothing to book and nothing to warn about.
    if (!handle) return;

    const warnings: string[] = [];
    const { phone, extra } = parsePhone(get("phone"));
    const { email, warning: emailWarn } = parseEmail(get("email"));
    if (emailWarn) warnings.push(emailWarn);

    const rawPhone = get("phone");
    const noteParts = [get("notes")];
    if (extra && rawPhone) noteParts.push(`Other contact: ${rawPhone}`);

    const quotedFee = parseMoney(get("quotedFee"));
    const agreedFee = parseMoney(get("agreedFee"));
    if (get("quotedFee") && quotedFee === null) warnings.push(`Couldn't read the price "${get("quotedFee")}"`);
    if (get("agreedFee") && agreedFee === null) warnings.push(`Couldn't read the negotiated price "${get("agreedFee")}"`);

    const { iso: liveDate, warning: dateWarn } = parseSheetDate(getRaw("liveDate"));
    if (dateWarn) warnings.push(dateWarn);

    // One shipping address split across up to four columns. Joining beats
    // first-non-empty-wins, which kept only the street and lost the city,
    // state and pincode on every row of the VHSB-07 sheet.
    //
    // Then the headerless tail. On the VHSCC-01 sheet the header row stops
    // at "Address" but three further columns carry state, city and pincode
    // for 18 of its 75 rows; with no header, sheet_to_json names them
    // __EMPTY, __EMPTY_1, __EMPTY_2 and nothing would ever map them. They
    // are treated as address overflow — which is what an unlabelled column
    // sitting past the address column is — and only when this sheet has an
    // address column at all, so a stray blank header elsewhere is ignored.
    const hasAddressColumn = Object.values(headerMap).includes("address");
    const overflow = hasAddressColumn
      ? Object.keys(rec)
          .filter((k) => /^__EMPTY(_\d+)?$/.test(k))
          // Numeric order, so __EMPTY_2 precedes __EMPTY_10.
          .sort((a, b) => Number(a.split("_")[3] ?? 0) - Number(b.split("_")[3] ?? 0))
          .map((k) => String(rec[k] ?? "").trim())
          .filter(Boolean)
      : [];

    const address = [get("address"), get("city"), get("state"), get("pincode"), ...overflow]
      .map((p) => p.trim())
      .filter(Boolean)
      .join(", ");

    rows.push({
      sheet: sheetName,
      // +2: the header is line 1 and sheet_to_json is zero-based.
      line: i + 2,
      handle,
      handleRaw: get("handle"),
      name: get("name"),
      email,
      phone,
      address,
      // The sheet name IS the tier in every workbook we have been sent.
      tier: sheetName,
      category: get("category"),
      followers: parseCount(get("followers")),
      quotedFee,
      agreedFee,
      productCost: parseMoney(get("productCost")),
      liveUrl: get("liveUrl"),
      notes: noteParts.filter(Boolean).join(" · "),
      stage: inferStage(get("approval"), get("confirmation")),
      warnings,
      progress: get("progress"),
      commercial: get("commercial"),
      finalPayment: get("finalPayment"),
      deliverables: get("deliverables"),
      product: get("product"),
      orderId: get("orderId"),
      liveDate,
    });
  });

  return { sheet: sheetName, rows, unmapped };
}

// Collapse a handle appearing on more than one sheet. The Vega workbook had
// two such rows out of 87; keeping both would trip the unique index halfway
// through the insert and make the count wrong.
//
// `keyOf` defaults to the bare handle, which is right when every sheet in
// the workbook feeds ONE campaign — the only case this was written for.
//
// It is WRONG, and silently so, when the sheets feed different campaigns.
// The unique index is on (campaign_id, lower(handle)), so the same creator
// on two campaigns is two legitimate bookings; the historical backfill has
// 37 such creators across its seven sheets and the default key would
// discard 37 real rows while reporting a tidy-looking "duplicates
// collapsed" count. Those callers pass `r => sheet|handle`.
export function dedupeRows(
  rows: SourcingImportRow[],
  keyOf: (r: SourcingImportRow) => string = (r) => r.handle,
): { rows: SourcingImportRow[]; duplicates: SourcingImportRow[] } {
  const seen = new Map<string, SourcingImportRow>();
  const duplicates: SourcingImportRow[] = [];
  for (const r of rows) {
    const key = keyOf(r);
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, r);
      continue;
    }
    // Keep the richer row rather than whichever came first — the duplicate
    // often carries the price the other one is missing.
    const score = (x: SourcingImportRow) =>
      (x.agreedFee ? 2 : 0) + (x.quotedFee ? 1 : 0) + (x.email ? 1 : 0) + (x.phone ? 1 : 0) + (x.address ? 1 : 0);
    if (score(r) > score(prior)) {
      seen.set(key, r);
      duplicates.push(prior);
    } else {
      duplicates.push(r);
    }
  }
  return { rows: [...seen.values()], duplicates };
}
