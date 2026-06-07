-- Migration 009: memory_audit table — append-only write audit log (W11, C5, C9)
-- memory_id is intentionally NOT a foreign key: audit rows must survive memory deletion.
-- No backfill — audit is forward-only from this migration onward.
-- Powers Phase 7 time-travel (C9) and /openltm:admin audit queries.
-- UP
CREATE TABLE IF NOT EXISTS memory_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   INTEGER NOT NULL,
  op          TEXT    NOT NULL CHECK(op IN (
                'insert','update','forget','deprecate','supersede','redact','restore')),
  actor       TEXT    NOT NULL,
  session_id  TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_memory  ON memory_audit(memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_op      ON memory_audit(op, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_session ON memory_audit(session_id, created_at DESC);

-- DOWN
-- DROP INDEX IF EXISTS idx_audit_session;
-- DROP INDEX IF EXISTS idx_audit_op;
-- DROP INDEX IF EXISTS idx_audit_memory;
-- DROP TABLE IF EXISTS memory_audit;
