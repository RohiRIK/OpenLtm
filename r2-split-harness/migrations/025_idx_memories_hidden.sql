-- Migration 025: partial index on memories(hidden) (pure DDL, idempotent)
-- Supports the /api/graph exclude-hidden filter. Split out of 017 so that
-- migration stays pure-DDL and self-heal eligible: on a fresh install
-- schema.sql pre-bakes hidden/color/icon but NOT this index, so the gate
-- would otherwise refuse 017 because the index target doesn't exist yet.
--
-- Own status-gated unit. `CREATE INDEX IF NOT EXISTS` is natively idempotent
-- in SQLite, so it succeeds identically whether the index already exists
-- (legacy install that ran the old 017) or not (fresh install that only just
-- added the column). Pure DDL, indistinguishable to the fail-closed runner.

CREATE INDEX IF NOT EXISTS idx_memories_hidden ON memories(hidden) WHERE hidden = 1;