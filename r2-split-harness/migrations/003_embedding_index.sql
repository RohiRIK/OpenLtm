-- Migration 003: index for embedding presence check
-- UP
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories(id) WHERE embedding IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS idx_memories_embedding;
