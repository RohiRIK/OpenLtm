-- Migration 015: add title columns to memories and context_items (DDL only)
-- Title is a short human-readable label (≤60 chars).
--
-- Pure-DDL, isolated from the value backfill so this step is self-heal eligible
-- on a fresh install: schema.sql already pre-bakes `title`, so the ALTERs
-- collide and the four-form DDL self-heal gate records the version once it
-- proves both columns exist. On a legacy pre-015 install the columns are
-- genuinely missing, so the ALTERs succeed and add them here.
--
-- The data-changing backfill (UPDATE ... SET title FROM content) lives in
-- 024_title_backfill.sql with its own status gate and idempotency check.

ALTER TABLE memories ADD COLUMN title TEXT;
ALTER TABLE context_items ADD COLUMN title TEXT;