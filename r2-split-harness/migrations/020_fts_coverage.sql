-- Migration 020: extend FTS coverage to include titles and context_items
-- Drops and recreates memories_fts to add the title column.
-- Adds context_items_fts for in-graph search coverage.

-- ── memories_fts rebuild ──────────────────────────────────────────────────────

DROP TABLE IF EXISTS memories_fts;

CREATE VIRTUAL TABLE memories_fts USING fts5(
  title,
  content,
  content='memories',
  content_rowid='id'
);

-- Repopulate from base table (title may be NULL for very old rows — coalesce to '').
INSERT INTO memories_fts(rowid, title, content)
  SELECT id, coalesce(title, ''), content FROM memories;

DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO memories_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

-- ── context_items_fts ─────────────────────────────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS context_items_fts USING fts5(
  title,
  content,
  content='context_items',
  content_rowid='id'
);

INSERT OR IGNORE INTO context_items_fts(rowid, title, content)
  SELECT id, coalesce(title, ''), content FROM context_items;

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
