/**
 * decay.ts — Batch decay refresh using materialised decay_score column (Phase 4).
 * Two SQL UPDATE statements inside one transaction replace the old O(N) JS loop.
 */
import { getDb } from "../shared-db.js";

export interface DecayResult {
  /** Memories whose decay_score was refreshed. */
  refreshed: number;
  /** Memories that crossed the deprecation threshold this run. */
  deprecated: number;
}

const SQL_REFRESH = `
  UPDATE memories
  SET decay_score = CASE
    WHEN importance = 5       THEN CAST(importance AS REAL) * confidence
    WHEN confirm_count >= 10  THEN CAST(importance AS REAL) * confidence
    WHEN importance = 4 THEN CAST(importance AS REAL) * confidence
                           * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 180.0)
    WHEN importance = 3 THEN CAST(importance AS REAL) * confidence
                           * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 90.0)
    WHEN importance = 2 THEN CAST(importance AS REAL) * confidence
                           * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 30.0)
    ELSE                      CAST(importance AS REAL) * confidence
                           * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 14.0)
  END
  WHERE status = 'active'
`;

const SQL_DEPRECATE = `
  UPDATE memories
  SET status = 'deprecated'
  WHERE status = 'active'
    AND importance < 5
    AND confirm_count < 10
    AND decay_score < 0.25
`;

export function runDecay(): DecayResult {
  const db = getDb();

  const run = db.transaction(() => {
    db.run(SQL_REFRESH);
    const refreshed = db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n;

    db.run(SQL_DEPRECATE);
    const deprecated = db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n;

    return { refreshed, deprecated };
  });

  return run();
}

/** Touch a memory's last_used_at timestamp when it is recalled or confirmed. */
export function touchMemory(memoryId: number): void {
  const db = getDb();
  db.run(`UPDATE memories SET last_used_at = datetime('now') WHERE id = ?`, [memoryId]);
}
