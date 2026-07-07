import type { SupabaseClient } from "@supabase/supabase-js";

// Shared helpers for the bulk-invite server actions (influencers + brands).
// Kept server-safe (no "use server") so both action files can import them.

// Normalizes a free-text gender cell to one of the four canonical values.
// Case-insensitive; strips spaces/hyphens/underscores before matching so
// "Non binary", "non-binary", "NON_BINARY" all land on the same value.
// Anything unrecognized (including blank) falls back to prefer_not_to_say
// — bulk gender is therefore never a hard validation failure.
export function normalizeGender(raw: string | undefined | null): string {
  const compact = (raw || "").toString().trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!compact) return "prefer_not_to_say";
  if (compact === "male" || compact === "m") return "male";
  if (compact === "female" || compact === "f") return "female";
  if (compact === "nonbinary" || compact === "nb" || compact === "enby") return "non_binary";
  return "prefer_not_to_say";
}

// Escapes LIKE wildcards so an `ilike` behaves as an exact (but
// case-insensitive) match — Instagram handles legitimately contain `_`,
// which is a LIKE wildcard and would otherwise cause false-positive
// "already exists" hits (priya_sharma matching priyaXsharma).
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

// Bulk case-insensitive existence check. Returns the set of lowercased
// handles (from `column`) that already exist in `table` for the given
// list of Instagram usernames. Replaces the old per-row SELECT (2 queries
// × N rows, the source of the timeout) with a handful of batched `or`
// queries run in parallel. Sub-batched at 50 terms so the PostgREST query
// string stays well under URL length limits. Values are double-quoted so
// handles containing '.' don't break the or-filter grammar.
export async function fetchExistingHandles(
  client: SupabaseClient,
  table: string,
  column: string,
  igs: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(igs.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return found;

  const SUB = 50;
  const queries: Promise<{ data: Record<string, unknown>[] | null }>[] = [];
  for (let i = 0; i < unique.length; i += SUB) {
    const slice = unique.slice(i, i + SUB);
    const orFilter = slice.map((ig) => `${column}.ilike."${escapeLike(ig)}"`).join(",");
    queries.push(
      client.from(table).select(column).or(orFilter) as unknown as Promise<{ data: Record<string, unknown>[] | null }>,
    );
  }

  const results = await Promise.all(queries);
  for (const { data } of results) {
    for (const r of data || []) {
      const val = r?.[column];
      if (val) found.add(String(val).toLowerCase());
    }
  }
  return found;
}
