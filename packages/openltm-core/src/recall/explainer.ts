/**
 * recall/explainer.ts — Pure function that builds a score breakdown for each recall result.
 * No DB access. No side effects. Deterministic.
 *
 * Score formula:
 *   totalScore = (fts * 0.40) + (semantic * 0.35) + (importance * 0.15) + (recency * 0.10)
 *   When provider is disabled, FTS weight absorbs the semantic slot:
 *   totalScore = (fts * 0.75) + (importance * 0.15) + (recency * 0.10)
 */

export type MemoryTemperature = "hot" | "warm" | "cool" | "cold";

export interface RecallExplainer {
  ftsRank: number | null;
  semanticScore: number | null;
  importanceBoost: number;
  recencyBoost: number;
  totalScore: number;
  temperature: MemoryTemperature;
}

export interface ExplainerInput {
  importance: number;
  recall_count: number;
  last_recalled_at: string | null | undefined;
  ftsRank?: number | null;
  semanticScore?: number | null;
}

/** Compute memory temperature from access pattern. */
export function computeTemperature(
  recallCount: number,
  lastRecalledAt: string | null | undefined,
): MemoryTemperature {
  const daysSince = lastRecalledAt
    ? (Date.now() - new Date(lastRecalledAt).getTime()) / 86_400_000
    : Infinity;

  if (recallCount >= 10 || daysSince <= 7) return "hot";
  if (recallCount >= 3 || daysSince <= 30) return "warm";
  if (recallCount >= 1 || daysSince <= 90) return "cool";
  return "cold";
}

/** Build a RecallExplainer for a single memory result. Pure function — no I/O. */
export function buildExplainer(input: ExplainerInput): RecallExplainer {
  const importanceBoost = Math.min(input.importance, 5) / 5;

  const daysSince = input.last_recalled_at
    ? (Date.now() - new Date(input.last_recalled_at).getTime()) / 86_400_000
    : 90;
  const recencyBoost = Math.max(0, 1 - daysSince / 90);

  const ftsRank = input.ftsRank ?? null;
  const semanticScore = input.semanticScore ?? null;

  let totalScore: number;
  if (semanticScore !== null && ftsRank !== null) {
    totalScore = (ftsRank * 0.40) + (semanticScore * 0.35) + (importanceBoost * 0.15) + (recencyBoost * 0.10);
  } else if (ftsRank !== null) {
    totalScore = (ftsRank * 0.75) + (importanceBoost * 0.15) + (recencyBoost * 0.10);
  } else if (semanticScore !== null) {
    totalScore = (semanticScore * 0.75) + (importanceBoost * 0.15) + (recencyBoost * 0.10);
  } else {
    totalScore = (importanceBoost * 0.15) + (recencyBoost * 0.10);
  }

  return {
    ftsRank,
    semanticScore,
    importanceBoost,
    recencyBoost,
    totalScore,
    temperature: computeTemperature(input.recall_count, input.last_recalled_at),
  };
}
