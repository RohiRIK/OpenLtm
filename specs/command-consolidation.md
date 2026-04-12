# Spec: Command Consolidation & Full Plugin Command Audit

**Feature slug:** command-consolidation  
**Date:** 2026-04-12  
**Status:** Draft

---

## Problem

The LTM command surface has two issues:

1. **Split location** — `register-project` and `update-context` live in `~/.claude/commands/` instead of the plugin
2. **Broken plugin commands** — 4 of 14 plugin commands have broken `bun --eval` scripts, wrong DB column names, wrong env var usage, and stale schema references

---

## Full Audit: All 14 Plugin Commands

| Command | Status | Issues |
|---------|--------|--------|
| `analyze-context` | ✅ clean | — |
| `capture` | 🔴 broken | `require()` in ESM, wrong schema columns, broken ON CONFLICT |
| `decay-report` | 🔴 broken | `require()` in ESM, wrong column `last_accessed` (should be `last_used_at`) |
| `forget` | ✅ clean | — |
| `health` | ✅ clean | — |
| `hook-doctor` | ✅ clean | — |
| `init-context` | 🔴 broken | `require()` in ESM, wrong column `project` (should be `project_name`), refs bare `/register-project` |
| `learn` | ✅ clean | — |
| `ltm-server` | ✅ clean | — |
| `migrate-db` | 🟡 docs bug | Table shows same path src→dst (copy-paste error) |
| `migrate` | ✅ clean | — |
| `recall` | ✅ clean | — |
| `relate` | ✅ clean | — |
| `secrets-scan` | 🔴 broken | `require()` in ESM, `process.env.DB` is undefined (shell var not exported), `await import()` in sync context |

---

## Issue Detail

### Issue A — `require()` in bun --eval (affects: capture, decay-report, init-context, secrets-scan)

`bun --eval` runs in ESM mode. `require()` is not available. All four commands use:
```bash
bun --eval "const { Database } = require('bun:sqlite'); ..."
```
Fix — use `import`:
```bash
bun --eval "import { Database } from 'bun:sqlite'; ..."
```

### Issue B — Wrong `context_items` column name (affects: capture, init-context)

The DB schema has `project_name TEXT NOT NULL` but the commands write to column `project`:
```sql
INSERT INTO context_items (project, type, content, updated_at) ...  -- ❌ wrong
INSERT INTO context_items (project_name, type, content) ...         -- ✅ correct
```
Also: `context_items` has no `updated_at` column and no `UNIQUE(project_name, type)` constraint, so the `ON CONFLICT` clause is invalid.

### Issue C — Wrong column `last_accessed` in decay-report

`memories` table has `last_used_at`, not `last_accessed`. The decay scoring uses:
```js
new Date(m.last_accessed ?? m.created_at)  // ❌ last_accessed doesn't exist
new Date(m.last_used_at ?? m.created_at)   // ✅ correct
```

### Issue D — `process.env.DB` undefined in secrets-scan

The script sets `DB` as a shell variable and then tries to read it as `process.env.DB` inside the bun subprocess. Shell variables are not automatically exported to child processes. Fix: use `process.env.LTM_DB_PATH` directly (set by the plugin's MCP server env config).

### Issue E — `await import()` in sync bun --eval (secrets-scan)

```js
const { scrubSecrets } = await import('...')  // ❌ top-level await needs async context
```
Fix: wrap in `async` IIFE or use static import.

### Issue F — migrate-db docs typo

"What it checks" table shows: `Copies ~/.claude/memory/ltm.db → $CLAUDE_PLUGIN_DATA/ltm.db` but is rendered as same-path due to copy-paste. Fix the table to show `~/.claude/memory/ltm.db` (legacy) → correct target.

### Issue G — init-context refs bare `/register-project`

Step 1 says: _"run `/register-project` first"_ — should be `/ltm:register-project` now that the command moves into the plugin.

---

## Local Commands (Split Location)

| Local command | Action | Reason |
|---------------|--------|--------|
| `~/.claude/commands/register-project.md` | **Move to plugin** | Core LTM registry op; belongs with other LTM commands |
| `~/.claude/commands/update-context.md` | **Delete** | Superseded by `ltm:capture` (capture does context + LTM in one shot) |
| All other local commands (`plan`, `spec`, `build`, `verify`, `tdd`, etc.) | **Leave untouched** | Not LTM-specific |

---

## Acceptance Criteria

### AC1 — `register-project` in plugin

- [ ] `commands/register-project.md` exists in plugin repo
- [ ] Accessible as `/ltm:register-project` after reload
- [ ] Same 8-step logic: path/name resolution, validation, registry write, context folder creation, migration offer
- [ ] `~/.claude/commands/register-project.md` deleted

### AC2 — `update-context` removed

- [ ] `~/.claude/commands/update-context.md` deleted
- [ ] No local LTM commands remain in `~/.claude/commands/`

### AC3 — `capture.md` fixed

- [ ] Uses `import { Database } from 'bun:sqlite'`
- [ ] Writes to `project_name` column (not `project`)
- [ ] No `ON CONFLICT` on `context_items` (no unique constraint exists) — use plain `INSERT`
- [ ] DB path: `process.env.LTM_DB_PATH` only (no fallback needed in commands)
- [ ] Smoke test: `/ltm:capture decision "test"` writes context item + LTM memory

### AC4 — `decay-report.md` fixed

- [ ] Uses `import { Database } from 'bun:sqlite'`
- [ ] Uses `m.last_used_at` (not `m.last_accessed`)
- [ ] DB path: `process.env.LTM_DB_PATH`
- [ ] Smoke test: `/ltm:decay-report` outputs score distribution without error

### AC5 — `init-context.md` fixed

- [ ] Uses `import { Database } from 'bun:sqlite'`
- [ ] Writes to `project_name` column
- [ ] Step 1 references `/ltm:register-project`
- [ ] DB path: `process.env.LTM_DB_PATH`
- [ ] Smoke test: `/ltm:init-context` on registered project writes goal row

### AC6 — `secrets-scan.md` fixed

- [ ] Uses `import { Database } from 'bun:sqlite'`
- [ ] Uses `process.env.LTM_DB_PATH` (not shell-var `$DB` → `process.env.DB`)
- [ ] `scrubSecrets` imported with static import or inside async IIFE
- [ ] Smoke test: `/ltm:secrets-scan --dry-run` runs without error

### AC7 — `migrate-db.md` docs fixed

- [ ] "What it checks" table correctly shows `~/.claude/memory/ltm.db` as legacy source path

---

## Target State

```
~/.claude/commands/
  [workflow commands only — plan, spec, build, verify, tdd, test, etc.]
  # No LTM commands remain here

plugin/commands/            issues → fixes
  register-project.md       NEW (moved from local)
  capture.md                require→import, project→project_name, remove ON CONFLICT
  decay-report.md           require→import, last_accessed→last_used_at
  init-context.md           require→import, project→project_name, /register-project→/ltm:register-project
  secrets-scan.md           require→import, process.env.DB→LTM_DB_PATH, async import fix
  migrate-db.md             fix docs table (legacy path)
  [9 other commands]        no changes
```

---

## Implementation Order

1. Fix `capture.md` (Issue A + B)
2. Fix `decay-report.md` (Issue A + C)
3. Fix `init-context.md` (Issue A + B + G)
4. Fix `secrets-scan.md` (Issue A + D + E)
5. Fix `migrate-db.md` (Issue F)
6. Add `commands/register-project.md` (move from local)
7. Delete `~/.claude/commands/register-project.md` and `update-context.md`
8. Bump version → `1.4.7`, commit, push, `/reload-plugins`
9. Smoke-test all 5 touched commands
