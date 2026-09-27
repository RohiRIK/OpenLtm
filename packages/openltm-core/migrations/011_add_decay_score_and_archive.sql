-- Migration 011: materialised decay_score column + memory_archive table
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.

-- Add pre-computed decay_score to memories (defaults to 1.0; janitor refreshes on first run)
ALTER TABLE memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0;
CREATE INDEX IF NOT EXISTS idx_memories_decay_score ON memories (decay_score DESC);

-- Archive table for evicted deprecated memories (snapshot, not live FK)
CREATE TABLE IF NOT EXISTS memory_archive (
  id            INTEGER PRIMARY KEY,
  memory_json   TEXT    NOT NULL,
  archived_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  reason        TEXT    NOT NULL CHECK(reason IN ('decay','rollup','manual')),
  decay_score   REAL,
  project_scope TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_project ON memory_archive (project_scope);
CREATE INDEX IF NOT EXISTS idx_archive_reason  ON memory_archive (reason, archived_at DESC);

-- DOWN
DROP INDEX IF EXISTS idx_archive_reason;
DROP INDEX IF EXISTS idx_archive_project;
DROP TABLE IF EXISTS memory_archive;
DROP INDEX IF EXISTS idx_memories_decay_score;
ALTER TABLE memories DROP COLUMN decay_score;
