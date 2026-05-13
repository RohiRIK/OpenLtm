-- Migration 013: add created_by column to memories
-- Backfills from the earliest memory_provenance.actor for each memory.
ALTER TABLE memories ADD COLUMN created_by TEXT;

UPDATE memories
SET created_by = (
  SELECT actor
  FROM memory_provenance
  WHERE memory_provenance.memory_id = memories.id
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE created_by IS NULL;
