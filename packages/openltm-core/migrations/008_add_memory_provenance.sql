-- Migration 008: memory_provenance table — per-memory source traceability (C5, W9)
-- One-to-many: a memory may have multiple provenance entries.
-- memory_id FK cascades on delete so provenance rows clean up with the memory.
-- Backfill: all pre-existing memories get a single 'legacy' provenance row.
-- UP
CREATE TABLE IF NOT EXISTS memory_provenance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  source_type TEXT    NOT NULL CHECK(source_type IN (
                'learn','git-backfill','evaluate-session','import-bundle',
                'user-promotion','janitor-rollup','legacy')),
  source_ref  TEXT,
  actor       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  metadata    TEXT
);

CREATE INDEX IF NOT EXISTS idx_provenance_memory      ON memory_provenance(memory_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source_type ON memory_provenance(source_type, created_at DESC);

-- Backfill all existing memories with a 'legacy' sentinel row.
INSERT INTO memory_provenance (memory_id, source_type, actor)
  SELECT id, 'legacy', 'migration-008' FROM memories;

-- DOWN
-- DROP INDEX IF EXISTS idx_provenance_source_type;
-- DROP INDEX IF EXISTS idx_provenance_memory;
-- DROP TABLE IF EXISTS memory_provenance;
