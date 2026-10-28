/**
 * sql.ts — Shared SQL fragments. Dependency-free: hooks import it by relative
 * path without loading core.
 */

// busy_timeout first: journal_mode=WAL needs a lock and would fail fast with
// SQLITE_BUSY while another process is writing.
export const CONNECTION_PRAGMAS = "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;";

/** Counts memories as used; append `(?, ?, ...)` with their ids. */
export const RECORD_USAGE_SQL =
  `UPDATE memories SET last_used_at = datetime('now'), last_recalled_at = datetime('now'),
          recall_count = recall_count + 1,
          first_recalled_at = COALESCE(first_recalled_at, datetime('now'))
   WHERE id IN `;
