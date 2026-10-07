/**
 * Cap SessionStart / inject memory lists to injectTopN total (default 15).
 * Prefers a small global budget (~1/3) and fills the rest with project-scoped.
 */
export function applyInjectTopN<G, S>(
  globals: G[],
  scoped: S[],
  injectTopN?: number | null,
): { globals: G[]; scoped: S[] } {
  const topN =
    typeof injectTopN === "number" && Number.isFinite(injectTopN) && injectTopN > 0
      ? Math.floor(injectTopN)
      : 15;
  const globalBudget = Math.min(globals.length, Math.max(0, Math.ceil(topN / 3)));
  const g = globals.slice(0, globalBudget);
  const s = scoped.slice(0, Math.max(0, topN - g.length));
  return { globals: g, scoped: s };
}
