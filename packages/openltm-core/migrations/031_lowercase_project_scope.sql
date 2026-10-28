-- Migration 031: project scopes are case-insensitive — lowercase every stored one
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.
-- "SummonOS" and "summonos" were two scopes for one project (a registry name
-- typed by hand vs. a resolver-derived one). Writers now lowercase on the way
-- in (project.ts scopeName); this folds the rows already stored.
--
-- No collisions possible: no UNIQUE key includes a project column
-- (memories.dedup_key is content-only, memory_files is keyed (memory_id, path)),
-- so rows from two casings simply merge into one scope. Nothing is deleted;
-- duplicate context items that may now share a scope stay (readers take the
-- newest goal; the next context write trims progress as usual).
-- shortcut: SQLite lower() folds ASCII only — a non-ASCII uppercase scope
-- keeps those letters; fold in JS if such names ever show up.
-- memory_archive is left as is: it is write-only cold storage (nothing reads
-- its scope back) and not every database has it (Hermes-created ones do not).
-- Idempotent (only rows whose scope differs from lower(scope) are touched).
-- Irreversible: the original casing is not kept, so there is no DOWN.

UPDATE memories       SET project_scope = lower(project_scope) WHERE project_scope <> lower(project_scope);
UPDATE memory_files   SET project_scope = lower(project_scope) WHERE project_scope <> lower(project_scope);
UPDATE context_items  SET project_name  = lower(project_name)  WHERE project_name  <> lower(project_name);
