-- Migration 014: rebuild memory_audit with updated CHECK constraint to include 'archive' op.
-- SQLite cannot ALTER a CHECK constraint — must recreate the table.
-- UP
PRAGMA foreign_keys=OFF;

CREATE TABLE memory_audit_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   INTEGER NOT NULL,
  op          TEXT    NOT NULL CHECK(op IN (
                'insert','update','forget','deprecate','supersede','redact','restore','archive')),
  actor       TEXT    NOT NULL,
  session_id  TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO memory_audit_new SELECT * FROM memory_audit;
DROP TABLE memory_audit;
ALTER TABLE memory_audit_new RENAME TO memory_audit;

CREATE INDEX IF NOT EXISTS idx_audit_memory  ON memory_audit(memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_op      ON memory_audit(op, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_session ON memory_audit(session_id, created_at DESC);

PRAGMA foreign_keys=ON;

-- DOWN
-- (reversing would require removing 'archive' from CHECK — not worth automating)
