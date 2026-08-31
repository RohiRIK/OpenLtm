-- Migration 001: baseline — initial schema captured in schema.sql
-- All core tables (memories, context_items, tags, memory_tags, memory_relations,
-- memories_fts, settings) are created by schema.sql on fresh installs.
-- This file records the baseline in the migration log so subsequent migrations
-- can assume the schema.sql shape exists.

-- UP
-- (no DDL — schema.sql CREATE IF NOT EXISTS handles fresh installs)

-- DOWN
-- (no rollback — dropping core tables would destroy all data)
