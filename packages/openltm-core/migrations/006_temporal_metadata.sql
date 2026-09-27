-- Migration 006: temporal metadata for memories
-- UP
ALTER TABLE memories ADD COLUMN first_recalled_at TEXT;
ALTER TABLE memories ADD COLUMN last_recalled_at TEXT;
ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL;
ALTER TABLE memories ADD COLUMN superseded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by);
CREATE INDEX IF NOT EXISTS idx_memories_recall_count ON memories(recall_count DESC);

-- DOWN
-- DROP INDEX IF EXISTS idx_memories_superseded;
-- DROP INDEX IF EXISTS idx_memories_recall_count;
-- ALTER TABLE memories DROP COLUMN superseded_at;
-- ALTER TABLE memories DROP COLUMN superseded_by;
-- ALTER TABLE memories DROP COLUMN recall_count;
-- ALTER TABLE memories DROP COLUMN last_recalled_at;
-- ALTER TABLE memories DROP COLUMN first_recalled_at;
