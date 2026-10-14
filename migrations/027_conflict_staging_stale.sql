-- Allow 'stale' on memory_conflict_staging: a pending row whose memories are
-- no longer both active is retired as stale instead of staying pending forever.
-- SQLite cannot alter a CHECK constraint, so rebuild the table.
CREATE TABLE memory_conflict_staging_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  older_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  newer_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  term TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'accepted', 'rejected', 'coexist', 'stale')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(older_id, newer_id)
);
INSERT INTO memory_conflict_staging_new (id, older_id, newer_id, term, status, created_at)
  SELECT id, older_id, newer_id, term, status, created_at FROM memory_conflict_staging;
-- Guard: abort (CHECK failure -> error -> rollback) unless every row was
-- copied, before the old table is dropped.
CREATE TEMP TABLE _m027_row_guard (ok INTEGER NOT NULL CHECK(ok = 1));
INSERT INTO _m027_row_guard (ok)
  SELECT (SELECT COUNT(*) FROM memory_conflict_staging) = (SELECT COUNT(*) FROM memory_conflict_staging_new);
DROP TABLE _m027_row_guard;
DROP TABLE memory_conflict_staging;
ALTER TABLE memory_conflict_staging_new RENAME TO memory_conflict_staging;
CREATE INDEX IF NOT EXISTS idx_conflict_staging_status
  ON memory_conflict_staging(status, created_at DESC);
