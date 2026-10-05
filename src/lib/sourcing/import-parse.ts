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
  ],
  category: ["category", "categories", "niche", "genre"],
  followers: ["followers", "follower count", "followers count", "reach", "follower"],
  approval: ["approval status", "approved", "approval", "status"],
  quotedFee: ["pricing", "price", "quoted price", "quote", "asking price", "rate", "charges"],
  agreedFee: ["negotiated pricing", "negotiated price", "negotiated", "final price", "agreed price", "final rate"],
  productCost: ["product cost", "product price", "product value", "cost of product"],
  phone: ["contact number", "phone", "mobile", "contact", "whatsapp", "phone number"],
  email: ["mail id", "email", "email id", "mail", "e mail"],
  address: ["address", "address optional", "delivery address", "shipping address", "full address"],
  confirmation: ["confirmation mail", "confirmation", "confirmation status", "confirmed"],
  liveUrl: ["live link", "live url", "post link", "reel link", "ig live link", "live"],
  notes: ["notes", "note", "remark", "remarks", "comment", "comments"],
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

    rows.push({
      sheet: sheetName,
      // +2: the header is line 1 and sheet_to_json is zero-based.
      line: i + 2,
      handle,
      name: get("name"),
      email,
      phone,
      address: get("address"),
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
    });
  });

  return { sheet: sheetName, rows, unmapped };
}

// Collapse a handle appearing on more than one sheet. The Vega workbook had
// two such rows out of 87; keeping both would trip the unique index halfway
// through the insert and make the count wrong.
export function dedupeRows(rows: SourcingImportRow[]): { rows: SourcingImportRow[]; duplicates: SourcingImportRow[] } {
  const seen = new Map<string, SourcingImportRow>();
  const duplicates: SourcingImportRow[] = [];
  for (const r of rows) {
    const key = r.handle;
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
