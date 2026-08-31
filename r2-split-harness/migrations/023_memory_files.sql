-- Migration 023: code-anchored invalidation — memory_files join + staleness columns
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.
-- Anchors memories to the repo files they reference, so a commit touching those
-- files can flag the anchored memories stale (see flagStaleByPaths / GitCommit hook).

-- Many-to-many: a memory ↔ the repo-relative paths it references.
CREATE TABLE IF NOT EXISTS memory_files (
  memory_id     INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  path          TEXT    NOT NULL,            -- normalised repo-relative path
  project_scope TEXT,                        -- NULL = global; else project name (cross-repo safety)
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memory_id, path)
);
CREATE INDEX IF NOT EXISTS idx_memory_files_path ON memory_files(path);

-- Staleness flag (set by code-change invalidation; cleared on re-confirm/revalidate).
-- NULL = not flagged. Distinct from decay/supersession — driven by code change, not recall.
ALTER TABLE memories ADD COLUMN stale_flagged_at TEXT;
ALTER TABLE memories ADD COLUMN stale_reason     TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_stale ON memories(stale_flagged_at);

-- DOWN
DROP INDEX IF EXISTS idx_memories_stale;
ALTER TABLE memories DROP COLUMN stale_reason;
ALTER TABLE memories DROP COLUMN stale_flagged_at;
DROP INDEX IF EXISTS idx_memory_files_path;
DROP TABLE IF EXISTS memory_files;
