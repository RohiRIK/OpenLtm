-- Migration 017: per-node UI state columns (DDL only)
-- hidden: excluded from /api/graph unless ?includeHidden=1
-- color: manual override; NULL means use category color
-- icon: optional emoji/icon key
--
-- Pure DDL, isolated from the supporting index: the four ALTER statements
-- self-heal cleanly on a fresh install (schema.sql pre-bakes the columns).
-- The partial index that backs `hidden=1` lookups lives in
-- 025_idx_memories_hidden.sql with its own status gate, so on fresh installs
-- the column step never fails just because the index target is still missing.

ALTER TABLE memories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN color  TEXT;
ALTER TABLE memories ADD COLUMN icon   TEXT;
