-- Migration 015: add title columns to memories and context_items
-- Title is a short human-readable label (≤60 chars).
-- Backfills existing rows with a first-sentence heuristic (no network call).

ALTER TABLE memories ADD COLUMN title TEXT;
ALTER TABLE context_items ADD COLUMN title TEXT;

-- Backfill memories: first sentence (up to '.', '!', '?', or newline), else first 60 chars.
UPDATE memories SET title =
  CASE
    WHEN instr(content, '.') > 1 AND instr(content, '.') <= 61
      THEN trim(substr(content, 1, instr(content, '.') - 1))
    WHEN instr(content, char(10)) > 1 AND instr(content, char(10)) <= 61
      THEN trim(substr(content, 1, instr(content, char(10)) - 1))
    WHEN length(trim(content)) <= 60
      THEN trim(content)
    ELSE substr(trim(content), 1, 57) || '…'
  END
WHERE title IS NULL;

-- Backfill context_items with same heuristic.
UPDATE context_items SET title =
  CASE
    WHEN instr(content, '.') > 1 AND instr(content, '.') <= 61
      THEN trim(substr(content, 1, instr(content, '.') - 1))
    WHEN instr(content, char(10)) > 1 AND instr(content, char(10)) <= 61
      THEN trim(substr(content, 1, instr(content, char(10)) - 1))
    WHEN length(trim(content)) <= 60
      THEN trim(content)
    ELSE substr(trim(content), 1, 57) || '…'
  END
WHERE title IS NULL;
