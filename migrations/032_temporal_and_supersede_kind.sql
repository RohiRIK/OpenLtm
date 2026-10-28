-- Migration 032: event time and the kind of supersede
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.
-- occurred_at: when the fact became true or the event happened, as opposed to
--   created_at (when it was recorded). NULL = unknown; readers fall back to
--   created_at. Lets recall answer "what was true on <date>" (as_of).
-- supersede_kind: on a superseded row, why it was replaced. 'updates' = a new
--   value replaced it, 'retracts' = it is no longer true and nothing replaced
--   the claim. NULL on rows superseded before 032 (treated as 'updates').
-- Hermes adds the same columns to its own databases (_db.py init_schema).

ALTER TABLE memories ADD COLUMN occurred_at TEXT;
ALTER TABLE memories ADD COLUMN supersede_kind TEXT CHECK(supersede_kind IS NULL OR supersede_kind IN ('updates','retracts'));

CREATE INDEX IF NOT EXISTS idx_memories_occurred_at ON memories(occurred_at);

-- DOWN
DROP INDEX IF EXISTS idx_memories_occurred_at;
ALTER TABLE memories DROP COLUMN supersede_kind;
ALTER TABLE memories DROP COLUMN occurred_at;
