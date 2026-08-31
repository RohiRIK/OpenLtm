-- Migration 024: backfill title values from content (data-changing, own gate)
-- Populates title for rows that predate the title column (legacy pre-015
-- installs). Kept in its own migration so the DDL step (015) stays pure-DDL
-- and self-heal eligible; this step is its own status-gated unit like any
-- migration, and the runner's checksum is recorded as usual.
--
-- Idempotent by construction: only rows WHERE title IS NULL are touched, so
-- re-running this migration (or the runner) is a no-op on already-backfilled
-- rows. No destructiveness, no rename — fail-closed runner accepts it as a
-- data-changing step that never needs self-heal because the columns it reads
-- (content, title) exist for both fresh (pre-baked or added by 015) and legacy
-- installs by the time this version runs (015 < 016 < ... < 024).

-- Backfill memories: first sentence (up to '.', '!', '?', or newline), else first 57 chars + ellipsis.
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