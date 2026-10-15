-- Migration 029: porter stemming for full-text search
-- Rebuilds memories_fts and context_items_fts with the porter tokenizer, so a
-- query word matches the other forms of the same word ("migrating" finds
-- "migrations", "decaying" finds "decay"). On a golden set mixed into 3,000
-- noise memories, FTS paraphrase MRR rose from 0.55 to 0.78. The stemmed
-- index is slightly smaller. The update triggers (028) reference the tables by
-- name, so they keep working once the tables are recreated.

DROP TABLE IF EXISTS memories_fts;

CREATE VIRTUAL TABLE memories_fts USING fts5(
  title,
  content,
  content='memories',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);

INSERT INTO memories_fts(memories_fts) VALUES ('rebuild');

DROP TABLE IF EXISTS context_items_fts;

CREATE VIRTUAL TABLE context_items_fts USING fts5(
  title,
  content,
  content='context_items',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);

INSERT INTO context_items_fts(context_items_fts) VALUES ('rebuild');
