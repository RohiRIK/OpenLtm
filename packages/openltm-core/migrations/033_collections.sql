-- Migration 033: collections + records — structured types the agent defines
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.
-- A new type is a row in `collections`, never a new table or migration: the
-- agent sends JSON field definitions, the server validates records against
-- them and stores the data as JSON. No agent-supplied SQL or DDL ever runs.
-- origin uses the memories.origin vocabulary (030); NULL = unknown.
-- IF NOT EXISTS throughout: schema.sql creates the same objects on a fresh DB.

CREATE TABLE IF NOT EXISTS collections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  project_scope TEXT,
  fields        TEXT    NOT NULL CHECK(json_valid(fields)),
  key_field     TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  origin        TEXT    CHECK(origin IS NULL OR origin IN ('owner-statement','agent-observation')),
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- NULL project_scope (global) must collide with itself, so not a UNIQUE column pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_scope
  ON collections(name, coalesce(project_scope, ''));

CREATE TABLE IF NOT EXISTS records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  record_key     TEXT,
  data           TEXT    NOT NULL CHECK(json_valid(data)),
  schema_version INTEGER NOT NULL,
  search_text    TEXT    NOT NULL DEFAULT '',
  memory_id      INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  origin         TEXT    CHECK(origin IS NULL OR origin IN (
                   'owner-statement','agent-observation','external-source','proposal','historical-approval')),
  created_by     TEXT,
  embedding      BLOB,
  embedding_model TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_records_key ON records(collection_id, record_key);
CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection_id, status, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
  search_text,
  content='records',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, search_text) VALUES (new.id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, search_text) VALUES ('delete', old.id, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE OF search_text ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, search_text) VALUES ('delete', old.id, old.search_text);
  INSERT INTO records_fts(rowid, search_text) VALUES (new.id, new.search_text);
END;

-- DOWN
DROP TRIGGER IF EXISTS records_au;
DROP TRIGGER IF EXISTS records_ad;
DROP TRIGGER IF EXISTS records_ai;
DROP TABLE IF EXISTS records_fts;
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS collections;
