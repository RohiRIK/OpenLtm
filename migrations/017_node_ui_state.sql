-- Migration 017: per-node UI state (view-independent)
-- hidden: excluded from /api/graph unless ?includeHidden=1
-- color: manual override; NULL means use category color
-- icon: optional emoji/icon key

ALTER TABLE memories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN color  TEXT;
ALTER TABLE memories ADD COLUMN icon   TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_hidden ON memories(hidden) WHERE hidden = 1;
