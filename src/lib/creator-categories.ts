import { createAdminClient } from "@/utils/supabase/admin";

// Options for the influencer list's category filter. Built by scanning every
// creator's `categories` array — there is no category table to read, and the
// column is a Postgres array PostgREST can't DISTINCT for us.
//
// That scan ran on every page load, ahead of the rows the admin actually
// asked for. The set changes only when an admin edits a creator's categories,
// so a short cache costs nothing and removes a round trip from the critical
// path. A warm function reuses it; a redeploy clears it.
const TTL_MS = 300_000;
let cached: { at: number; options: { label: string; value: string }[] } | null = null;

export async function getCreatorCategoryOptions(): Promise<{ label: string; value: string }[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.options;

  const { data, error } = await createAdminClient().from("influencer_profiles").select("categories");
  // Keep serving the previous list on a failed read rather than emptying the
  // filter — an empty dropdown reads as "no categories exist".
  if (error) return cached?.options ?? [];

  const set = new Set<string>();
  for (const row of data || []) {
    if (Array.isArray(row.categories)) for (const c of row.categories) if (c) set.add(c as string);
  }
  const options = [...set].sort().map((cat) => ({ label: cat, value: cat }));
  cached = { at: Date.now(), options };
  return options;
}
