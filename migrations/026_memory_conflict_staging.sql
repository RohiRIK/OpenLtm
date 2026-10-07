-- Staged supersede/contradiction conflicts for human review (no auto-apply).
CREATE TABLE IF NOT EXISTS memory_conflict_staging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  older_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  newer_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  term TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'accepted', 'rejected', 'coexist')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(older_id, newer_id)
);

CREATE INDEX IF NOT EXISTS idx_conflict_staging_status
  ON memory_conflict_staging(status, created_at DESC);
