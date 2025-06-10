// Returns "W123" for either "W123" or "https://openalex.org/W123"
// Non-destructive; leaves already-clean IDs unchanged.
export function normalizeOpenAlexId(raw: string): string {
  return raw.replace(/^https?:\/\/openalex\.org\//, "");
}
