/**
 * Dedup key normalization for memory deduplication.
 * Produces a stable string key from arbitrary content.
 */
export function normalizeKey(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")   // strip punctuation
    .replace(/\s+/g, " ")       // collapse whitespace
    .trim()
    .substring(0, 200);          // cap length
}
