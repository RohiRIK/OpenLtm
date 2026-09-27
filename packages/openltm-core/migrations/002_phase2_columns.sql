-- Migration 002: Phase 2 columns — status, embedding, last_used_at, memory_id
-- These columns were previously added by hand-rolled ALTER TABLE in shared-db.ts.
-- Moving them here makes the migration history authoritative.

-- UP
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','deprecated','superseded'));
ALTER TABLE memories ADD COLUMN embedding BLOB;
ALTER TABLE memories ADD COLUMN last_used_at TEXT NOT NULL DEFAULT (datetime('now'));

ALTER TABLE context_items ADD COLUMN memory_id INTEGER REFERENCES memories(id) ON DELETE SET NULL;
ALTER TABLE context_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending_promotion','promoted'));

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_status    ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_last_used ON memories(last_used_at);

-- DOWN
-- DROP INDEX IF EXISTS idx_memories_last_used;
-- DROP INDEX IF EXISTS idx_memories_status;
-- DROP TABLE IF EXISTS settings;
-- ALTER TABLE context_items DROP COLUMN status;
-- ALTER TABLE context_items DROP COLUMN memory_id;
-- ALTER TABLE memories DROP COLUMN last_used_at;
-- ALTER TABLE memories DROP COLUMN embedding;
-- ALTER TABLE memories DROP COLUMN status;
