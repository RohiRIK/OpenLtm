-- Migration 032: clear stale flags on preferences and owner statements
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.
-- Flags set before flagStaleByPaths skipped preferences/owner statements: a code
-- change never invalidates those, so clear the flag rather than let decay
-- deprecate them. Writers no longer set such flags; this folds the old ones.
-- Idempotent (only rows still flagged are touched).
-- Irreversible: the old flag times are not kept, so there is no DOWN.

UPDATE memories
SET stale_flagged_at = NULL, stale_reason = NULL
WHERE stale_flagged_at IS NOT NULL
  AND (category = 'preference' OR origin = 'owner-statement');
