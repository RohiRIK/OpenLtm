/**
 * sql.ts — Shared SQL fragments and connection helpers. Dependency-free (only
 * bun:sqlite): hooks import it by relative path without loading core.
 */
import { Database } from "bun:sqlite";

/**
 * Open an existing database for reads only. Not `{ readonly: true }`: a WAL
 * database whose last writer closed cleanly has no -shm file, and a readonly
 * connection cannot create one, so the open fails with SQLITE_CANTOPEN.
 */
export function openQueryOnly(path: string): Database {
  const db = new Database(path, { readwrite: true, create: false });
  db.exec("PRAGMA busy_timeout=500; PRAGMA query_only=ON;");
  return db;
}

// busy_timeout first: journal_mode=WAL needs a lock and would fail fast with
// SQLITE_BUSY while another process is writing.
export const CONNECTION_PRAGMAS = "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;";

/** Counts memories as used; append `(?, ?, ...)` with their ids. */
export const RECORD_USAGE_SQL =
  `UPDATE memories SET last_used_at = datetime('now'), last_recalled_at = datetime('now'),
          recall_count = recall_count + 1,
          first_recalled_at = COALESCE(first_recalled_at, datetime('now'))
   WHERE id IN `;
