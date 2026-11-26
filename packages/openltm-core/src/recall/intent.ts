/**
 * recall/intent.ts — What kind of answer a recall query is after.
 *
 * Pure, English-only heuristics (the store is English-only). Two shapes change
 * how recall ranks and cuts its results:
 *   - "recency":   the newest value of something ("current", "latest", "now").
 *                  Newer memories get a bounded boost among relevant hits.
 *   - "aggregate": every instance of something ("list all", "how many").
 *                  The adaptive cutoff is skipped so the tail is not trimmed.
 * Anything else is null and recall ranks as before.
 */

export type QueryIntent = "recency" | "aggregate";

const RECENCY_RE = /\b(?:current(?:ly)?|latest|newest|now|nowadays|most recent(?:ly)?|these days|as of today|still|anymore|any more)\b/i;
const AGGREGATE_RE = /\b(?:all|every|each|list|how many|which ones|everything|enumerate)\b/i;

/** The query's intent, or null. Aggregate wins when both match ("list all current …"). */
export function detectQueryIntent(query: string | undefined | null): QueryIntent | null {
  if (!query) return null;
  if (AGGREGATE_RE.test(query)) return "aggregate";
  if (RECENCY_RE.test(query)) return "recency";
  return null;
}

/**
 * Recency rank of each memory among the candidates, in [0,1]: 1 = newest,
 * 0 = oldest. Event time (occurred_at) leads; created_at fills in when unknown.
 * Equal times share a value; a single candidate scores 1.
 */
export function recencyRanks(rows: ReadonlyArray<{ id: number; created_at: string; occurred_at?: string | null }>): Map<number, number> {
  const times = rows.map((r) => ({ id: r.id, t: Date.parse(toIso(r.occurred_at ?? r.created_at)) || 0 }));
  const distinct = [...new Set(times.map((x) => x.t))].sort((a, b) => a - b);
  const out = new Map<number, number>();
  for (const { id, t } of times) {
    out.set(id, distinct.length <= 1 ? 1 : distinct.indexOf(t) / (distinct.length - 1));
  }
  return out;
}

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → ISO for Date.parse. */
function toIso(s: string): string {
  return /^\d{4}-\d{2}-\d{2} \d/.test(s) ? `${s.replace(" ", "T")}Z` : s;
}
