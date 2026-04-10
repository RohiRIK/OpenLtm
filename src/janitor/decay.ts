/**
 * decay.ts — Memory decay logic using half-life model.
 * Uses computeDecayScore from src/db.ts for unified decay calculation.
 */
import { getDb } from "../shared-db.js";
import { computeDecayScore, type Memory } from "../db.js";

/** Canonical deprecation threshold - must match src/db.ts */
const DEPRECATION_THRESHOLD = 0.25;

export interface DecayResult {
  /** Number of memories that crossed the threshold and were deprecated. */
  deprecated: number;
  /** Total active memories scanned. */
  scanned: number;
}

/**
 * Run decay on all active memories using unified half-life model.
 *
 * Logic:
 * 1. For each active memory, compute decay score using computeDecayScore()
 * 2. If score < threshold, mark as deprecated
 * 3. High-importance (5) memories never decay (half-life = Infinity)
 * 4. Memories with confirm_count >= 10 never decay (protected from decay)
 */
export function runDecay(): DecayResult {
  const db = getDb();
  const result: DecayResult = { deprecated: 0, scanned: 0 };

  const memories = db
    .query<
      Memory,
      []
    >(
      `SELECT * FROM memories WHERE status = 'active'`,
    )
    .all();

  result.scanned = memories.length;

  for (const mem of memories) {
    // Protected from decay: confirm_count >= 10 OR importance = 5
    if (mem.confirm_count >= 10 || mem.importance === 5) continue;

    const score = computeDecayScore(mem);

    if (score < DEPRECATION_THRESHOLD) {
      // Mark as deprecated
      db.run(
        `UPDATE memories SET status = 'deprecated' WHERE id = ?`,
        [mem.id],
      );
      result.deprecated++;
    }
  }

  return result;
}

/**
 * Touch a memory's last_used_at timestamp.
 * Called when a memory is recalled/used in a session.
 */
export function touchMemory(memoryId: number): void {
  const db = getDb();
  db.run(
    `UPDATE memories SET last_used_at = datetime('now') WHERE id = ?`,
    [memoryId],
  );
}
