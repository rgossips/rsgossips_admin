// Turns a stored status token into a human label: underscores/hyphens become
// spaces and each word is capitalised. e.g. "under_review" -> "Under Review",
// "active" -> "Active", "not_applied" -> "Not Applied". Null/empty passes a
// caller-supplied fallback through unchanged.
export function formatStatus(value: string | null | undefined, fallback = ""): string {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  return raw
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
