-- Migration 010: split memories.embedding blob into memory_embeddings table
-- SQLite 3.35+ required for ALTER TABLE … DROP COLUMN (Bun ships 3.35+).
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id  INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding  BLOB    NOT NULL,
  model      TEXT    NOT NULL DEFAULT 'unknown',
  dim        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_memory ON memory_embeddings(memory_id);

-- Copy existing non-null blobs before dropping the column
INSERT OR IGNORE INTO memory_embeddings (memory_id, embedding, model, dim)
  SELECT id, embedding, 'unknown', 0
  FROM memories
  WHERE embedding IS NOT NULL;

-- Drop the partial index from migration 003 (references embedding column — must drop before DROP COLUMN)
DROP INDEX IF EXISTS idx_memories_embedding;

-- Drop the inline blob column now that data is in the side table
ALTER TABLE memories DROP COLUMN embedding;

-- DOWN
DROP INDEX IF EXISTS idx_embeddings_memory;
DROP TABLE IF EXISTS memory_embeddings;
ALTER TABLE memories ADD COLUMN embedding BLOB;
