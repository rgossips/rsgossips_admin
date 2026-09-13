import type { createAdminClient } from "@/utils/supabase/admin";

// Phone-number search for the influencer and brand lists.
//
// Phones are NOT in one column PostgREST can filter:
//   * creators + brands sign in by phone → auth.users.phone ("91XXXXXXXXXX")
//   * brand_profiles.contact_phone → 10 digits, no country code
//   * influencer_invitations.notes JSON trailer → "91 XXXXXXXXXX" (with a
//     space; written by enrichment, patchy)
// So a phone query is resolved to row ids here (digit-only, format-agnostic
// substring match), and the page folds those ids into its search `.or()`.
// brand_invitations carry no phone anywhere, so they can't be matched.

type Admin = ReturnType<typeof createAdminClient>;

// Minimum digits before a query is treated as a phone number. 4 lets admins
// search by a remembered fragment ("9873"); 3 or fewer matches almost every
// number. The name/GSTIN clauses still apply alongside, so a digit run that
// is really part of a GSTIN or handle keeps matching those rows too.
const MIN_PHONE_DIGITS = 4;
// Keeps the generated `id.in.(…)` filter a sane URL length.
const MAX_MATCHED_IDS = 300;

// Returns the query's digits when it looks like a phone number ("+91 98765
// 43210", "098765-43210", "9873"), else null. Anything with letters is a
// name search, not a phone search.
export function phoneQueryDigits(raw: string | null | undefined): string | null {
  const compact = (raw || "").replace(/[\s+\-().]/g, "");
  if (!/^\d+$/.test(compact)) return null;
  const digits = compact.replace(/^0+/, ""); // trunk prefix: 098765… → 98765…
  return digits.length >= MIN_PHONE_DIGITS ? digits : null;
}

// Stored values differ in whether they carry the 91 country code, so a
// 12-digit "91…" query also tries its 10-digit local part.
export function phoneMatches(stored: string | null | undefined, query: string): boolean {
  const s = (stored || "").replace(/\D/g, "");
  if (!s) return false;
  if (s.includes(query)) return true;
  return query.length === 12 && query.startsWith("91") && s.includes(query.slice(2));
}

export type AuthUserLite = { id: string; phone?: string | null };

// Every auth user, paged — listUsers caps a page at 1000.
export async function listAllAuthUsers(admin: Admin): Promise<AuthUserLite[]> {
  const users: AuthUserLite[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) break;
    users.push(...data.users.map((u) => ({ id: u.id, phone: u.phone })));
    if (data.users.length < 1000) break;
  }
  return users;
}

export function authIdsByPhone(users: AuthUserLite[], query: string): string[] {
  return users.filter((u) => phoneMatches(u.phone, query)).map((u) => u.id).slice(0, MAX_MATCHED_IDS);
}

// Registered brands whose contact_phone matches. The table is small and
// already loaded unpaginated by the brands page, so matching in memory is
// cheaper than guessing every stored format in SQL.
export async function brandIdsByContactPhone(admin: Admin, query: string): Promise<string[]> {
  const { data } = await admin.from("brand_profiles").select("brand_id, contact_phone").not("contact_phone", "is", null);
  return (data || []).filter((b) => phoneMatches(b.contact_phone, query)).map((b) => b.brand_id).slice(0, MAX_MATCHED_IDS);
}

// Same trailer contract as invited-influencer-row's parseMeta: JSON after a
// "\n---\n" separator, or the whole notes value when it starts with "{".
function notesMeta(notes: string | null): Record<string, unknown> | null {
  if (!notes) return null;
  const sep = notes.indexOf("\n---\n");
  const json = sep !== -1 ? notes.slice(sep + 5) : notes.startsWith("{") ? notes : "";
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

// Pending influencer invitations whose notes trailer carries a matching phone.
// The phone lives in JSON inside a text column, so it's paged and parsed here
// (PostgREST caps a page at 1000; there are ~1.7k pending rows).
export async function influencerInvitationIdsByPhone(admin: Admin, query: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("influencer_invitations")
      .select("id, notes")
      .eq("status", "pending")
      .ilike("notes", '%"phone"%')
      .order("id")
      .range(from, from + 999);
    if (error || !data) break;
    for (const r of data) {
      const phone = notesMeta(r.notes)?.phone;
      if (typeof phone === "string" || typeof phone === "number") {
        if (phoneMatches(String(phone), query)) ids.push(r.id);
      }
    }
    if (data.length < 1000 || ids.length >= MAX_MATCHED_IDS) break;
  }
  return ids.slice(0, MAX_MATCHED_IDS);
}
