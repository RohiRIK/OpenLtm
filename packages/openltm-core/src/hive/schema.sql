-- Hive schema v1: the shared memory file several agents can opt in to.
-- This is NOT the main OpenLTM database and is not covered by migrations/.
-- Twin: hermes/openltm_hermes/_hive.py HIVE_SCHEMA_SQL (a test keeps them identical).
-- Default deny: a fresh hive is disabled, has no agents and no grants.

CREATE TABLE IF NOT EXISTS hive_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hive_agents (
  name          TEXT PRIMARY KEY CHECK(length(name) BETWEEN 1 AND 64),
  token_sha256  TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS hive_grants (
  agent       TEXT NOT NULL REFERENCES hive_agents(name) ON DELETE CASCADE,
  capability  TEXT NOT NULL CHECK(capability IN ('read','write')),
  granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by  TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (agent, capability)
);

CREATE TABLE IF NOT EXISTS hive_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent         TEXT NOT NULL REFERENCES hive_agents(name) ON DELETE CASCADE,
  capabilities  TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT
);

CREATE TABLE IF NOT EXISTS hive_memories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  content        TEXT NOT NULL,
  title          TEXT,
  category       TEXT NOT NULL DEFAULT 'pattern',
  importance     INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  project_scope  TEXT,
  origin         TEXT CHECK(origin IS NULL OR origin IN (
                   'owner-statement','agent-observation','external-source','proposal','historical-approval')),
  author_agent   TEXT NOT NULL,
  source_host    TEXT,
  dedup_key      TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hive_memories_status ON hive_memories(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hive_memories_author ON hive_memories(author_agent);

CREATE VIRTUAL TABLE IF NOT EXISTS hive_memories_fts USING fts5(
  title,
  content,
  content='hive_memories',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS hive_memories_ai AFTER INSERT ON hive_memories BEGIN
  INSERT INTO hive_memories_fts(rowid, title, content) VALUES (new.id, coalesce(new.title, ''), new.content);
END;

CREATE TRIGGER IF NOT EXISTS hive_memories_ad AFTER DELETE ON hive_memories BEGIN
  INSERT INTO hive_memories_fts(hive_memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
END;

CREATE TRIGGER IF NOT EXISTS hive_memories_au AFTER UPDATE OF title, content ON hive_memories BEGIN
  INSERT INTO hive_memories_fts(hive_memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO hive_memories_fts(rowid, title, content) VALUES (new.id, coalesce(new.title, ''), new.content);
END;

CREATE TABLE IF NOT EXISTS hive_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  agent       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  memory_ids  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_hive_audit_ts ON hive_audit(ts DESC);
