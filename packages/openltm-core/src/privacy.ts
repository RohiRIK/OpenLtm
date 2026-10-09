/**
 * privacy.ts — `<private>` / tag `private` visibility filter.
 *
 * Convention (tag-only, no schema migration): a memory tagged `private`
 * is omitted from auto-recall, SessionStart, default MCP recall, janitor
 * embed/dedup candidate scans, markdown export, and archive selection
 * unless the caller passes explicit includePrivate / opt-in.
 *
 * private ≠ encrypted — content is still plaintext in SQLite.
 */

export const PRIVATE_TAG = "private";

/** SQL predicate: `idColumn` is not a memory tagged private. For WHERE clauses that must exclude them before LIMIT. */
export function notPrivateSql(idColumn = "id"): string {
  return `${idColumn} NOT IN (SELECT mt.memory_id FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id WHERE lower(t.name) = '${PRIVATE_TAG}')`;
}

export function hasPrivateTag(tags: string[] | undefined | null): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.some((t) => t.toLowerCase() === PRIVATE_TAG);
}

/** Drop memories that carry the private tag (unless includePrivate). */
export function filterPrivateMemories<T extends { tags?: string[] }>(
  memories: T[],
  includePrivate = false,
): T[] {
  if (includePrivate) return memories;
  return memories.filter((m) => !hasPrivateTag(m.tags));
}
