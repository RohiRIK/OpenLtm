/**
 * recall/adaptive.ts — Adaptive cutoff for query recall.
 *
 * A fixed limit returns the same number of memories whether one matches or
 * ten do, so a narrow question pads the context with weak hits. This trims
 * the tail by match strength instead: a hit stays when it matches at least
 * `minRatio` as strongly as the best hit. The first `minResults` hits always
 * stay, so a query whose matches are all weak still gets an answer.
 *
 * Match strength is the stronger of the two retrievers' own signals, each
 * relative to its best hit: BM25 for full-text, cosine similarity for vectors.
 * Priors (importance, decay, project scope) never decide the cut; they only
 * order the hits. Inspired by memvid's adaptive retrieval (relative threshold).
 */

export interface AdaptiveCutoffOptions {
  /** Keep hits whose strength is at least this fraction of the best (default 0.3). */
  minRatio?: number;
  /** Never cut below this many hits (default 3). */
  minResults?: number;
}

export const ADAPTIVE_DEFAULTS = { minRatio: 0.3, minResults: 3 } as const;

/**
 * strengths — per-id match strength in [0,1].
 * @param ftsRelative BM25 relative to the best FTS hit, (0,1]
 * @param semantic    cosine similarity, [0,1]
 */
export function matchStrengths(
  ids: readonly number[],
  ftsRelative: ReadonlyMap<number, number>,
  semantic: ReadonlyMap<number, number>,
): Map<number, number> {
  const topSemantic = Math.max(0, ...semantic.values());
  const out = new Map<number, number>();
  for (const id of ids) {
    const fts = ftsRelative.get(id) ?? 0;
    const sem = topSemantic > 0 ? (semantic.get(id) ?? 0) / topSemantic : 0;
    out.set(id, Math.max(fts, sem));
  }
  return out;
}

/** Trim ranked hits (best first) by relative match strength. Order is kept. */
export function adaptiveCutoff<T extends { id: number }>(
  ranked: readonly T[],
  strengths: ReadonlyMap<number, number>,
  opts: AdaptiveCutoffOptions = {},
): T[] {
  const minRatio = opts.minRatio ?? ADAPTIVE_DEFAULTS.minRatio;
  const minResults = opts.minResults ?? ADAPTIVE_DEFAULTS.minResults;
  const best = Math.max(0, ...ranked.map((r) => strengths.get(r.id) ?? 0));
  if (best <= 0) return [...ranked];
  return ranked.filter((r, i) => i < minResults || (strengths.get(r.id) ?? 0) >= best * minRatio);
}
