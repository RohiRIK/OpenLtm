-- Long-Term Memory Schema
-- Two-table design: context_items (per-project context) + memories (global learned insights)

-- ============================================================
-- schema_migrations: versioned migration tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    TEXT    NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  checksum   TEXT
);

-- ============================================================
-- context_items: replaces the 4 per-project Markdown context files
-- ============================================================
CREATE TABLE IF NOT EXISTS context_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK(type IN ('goal','decision','progress','gotcha')),
  content      TEXT    NOT NULL,
  title        TEXT,
  session_id   TEXT,                          -- for progress dedup
  permanent    INTEGER NOT NULL DEFAULT 0,    -- 1 = never auto-delete (decisions, gotchas)
  memory_id    INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending_promotion','promoted')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ctx_project ON context_items(project_name);
CREATE INDEX IF NOT EXISTS idx_ctx_type    ON context_items(project_name, type);

-- ============================================================
-- memories: global + project-scoped learned insights
-- ============================================================
CREATE TABLE IF NOT EXISTS memories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  content           TEXT    NOT NULL,
  title             TEXT,
  category          TEXT    NOT NULL CHECK(category IN (
                      'preference','architecture','gotcha','pattern','workflow','constraint')),
  importance        INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  confidence        REAL    NOT NULL DEFAULT 1.0 CHECK(confidence BETWEEN 0.0 AND 1.0),
  source            TEXT,
  project_scope     TEXT,                     -- NULL = global, else project name
  dedup_key         TEXT    UNIQUE,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_confirmed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  confirm_count     INTEGER NOT NULL DEFAULT 1,
  -- Phase 2: janitor fields
  status            TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','deprecated','superseded')),
  embedding         BLOB,                     -- float32 vector for semantic search
  last_used_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Phase 3: temporal metadata
  first_recalled_at  TEXT,
  last_recalled_at  TEXT,
  recall_count     INTEGER NOT NULL DEFAULT 0,
  superseded_by    INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  superseded_at    TEXT,
  -- Phase 7: graph humanization
  hidden     INTEGER NOT NULL DEFAULT 0,
  color      TEXT,
  icon       TEXT,
  user_note  TEXT,
  -- Personal relevance signal: 'works' | 'doesnt' | NULL (unrated)
  relevance_signal     TEXT,
  relevance_signal_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_category   ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_project    ON memories(project_scope);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_status     ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_last_used  ON memories(last_used_at);
CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by);
CREATE INDEX IF NOT EXISTS idx_memories_recall_count ON memories(recall_count DESC);

-- ============================================================
-- tags + memory_tags: many-to-many tagging for memories
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (memory_id, tag_id)
);

-- ============================================================
-- memory_relations: knowledge graph edges
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_relations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN (
                      'supports','contradicts','refines','depends_on','related_to','supersedes')),
  note             TEXT,
  weight           REAL NOT NULL DEFAULT 1.0 CHECK(weight BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_memory_id, target_memory_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON memory_relations(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_memory_id);

-- ============================================================
-- memory_layout: per-view position persistence (Phase 7)
-- Only saved on explicit drag/pin — simulation-placed nodes have no row.
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_layout (
  memory_id  INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  view       TEXT    NOT NULL,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memory_id, view)
);

CREATE INDEX IF NOT EXISTS idx_layout_view ON memory_layout(view);

-- ============================================================
-- FTS5 virtual table for full-text search on memories (includes title)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  content,
  content='memories',
  content_rowid='id'
);

-- Triggers to keep FTS in sync with memories table
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO memories_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

-- ============================================================
-- FTS5 for context_items
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS context_items_fts USING fts5(
  title,
  content,
  content='context_items',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS context_items_ai AFTER INSERT ON context_items BEGIN
  INSERT INTO context_items_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

CREATE TRIGGER IF NOT EXISTS context_items_ad AFTER DELETE ON context_items BEGIN
  INSERT INTO context_items_fts(context_items_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
END;

CREATE TRIGGER IF NOT EXISTS context_items_au AFTER UPDATE ON context_items BEGIN
  INSERT INTO context_items_fts(context_items_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO context_items_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

-- ============================================================
-- settings: key-value store for janitor/provider configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- workspace_id + agent_id indexes are created by migration 007_workspaces.sql
-- after the columns are added via ALTER TABLE. Do not add them here.
