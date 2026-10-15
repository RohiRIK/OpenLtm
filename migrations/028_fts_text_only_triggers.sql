-- Migration 028: re-index FTS only when the indexed text changes
-- The AFTER UPDATE triggers from 020 fired on every column update, so each
-- recall (recall_count bump), every graph-app edit and the nightly decay
-- refresh deleted and re-inserted the row's tokens. That made the decay job
-- rewrite the whole index and fragmented it, slowing every MATCH. Scoping the
-- triggers to title/content keeps the index in sync with the text it holds.
-- An 'optimize' then merges the segments the old triggers left behind.

DROP TRIGGER IF EXISTS memories_au;

CREATE TRIGGER memories_au AFTER UPDATE OF title, content ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO memories_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

DROP TRIGGER IF EXISTS context_items_au;

CREATE TRIGGER context_items_au AFTER UPDATE OF title, content ON context_items BEGIN
  INSERT INTO context_items_fts(context_items_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO context_items_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

INSERT INTO memories_fts(memories_fts) VALUES ('optimize');

INSERT INTO context_items_fts(context_items_fts) VALUES ('optimize');
