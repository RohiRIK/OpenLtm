# Spec: LTM Command System Overhaul

**Feature slug:** command-system-overhaul
**Date:** 2026-04-15
**Status:** Draft
**Supersedes:** `specs/command-consolidation.md`, `specs/command-consolidation-v2.md`

---

## Problem

The current 16 `/ltm:*` commands have four compounding issues:

| Area | Problem |
|------|---------|
| **Structure** | 16 flat commands — no grouping, maintenance tasks compete with daily-use ops |
| **Broken internals** | At least 1 confirmed bug remains in `secrets-scan.md` (`secretsScrubber.js` → wrong extension). Others were fixed in v1.4.7 but need verification. |
| **Redundancy** | 4 command pairs do overlapping work: `doctor`/`hook-doctor`, `migrate`/`migrate-db`, `learn`/`capture`, `decay-report`/`health` |
| **Automation** | `secrets-scan` is already half-automated (scrubber fires on every `ltm_learn` via `db.ts:263`), but the command doesn't communicate this. `decay-report` requires a manual trigger when data is available from the graph server on demand. |

---

## Codebase Ground Truth

**Schema — `context_items` table:**
```sql
project_name TEXT NOT NULL
type         TEXT CHECK(type IN ('goal','decision','progress','gotcha'))
content      TEXT NOT NULL
created_at   TEXT DEFAULT (datetime('now'))
```

**Schema — `memories` table key columns:**
- `last_used_at` (not `last_accessed`)
- `project_scope` (not `project`)
- `status` (`'active'|'deprecated'`)
- `importance`, `confidence`, `confirm_count`

**Auto-scrubbing:** `src/db.ts:263` calls `scrubSecrets()` on every `ltm_learn`. New memories are already clean. `/ltm:secrets-scan` is a retroactive tool for old memories only.

**Graph server endpoints:**
- `/api/health` — plugin health
- `/api/health/projects` — project scores (health command uses this)
- `/api/health/superseded` — superseded memories
- ❌ No `/api/health/decay` endpoint yet

**Hooks — `hooks/hooks.json`:** Has `SessionStart`, `Stop`, `PreCompact`. No `PostToolUse`.

**Command parsing:** Slash commands are Claude prompt templates — no CLI library. Claude reads the argument string directly. Subcommand routing is handled by a table in the `.md` file.

---

## Target State: 4 Commands

| Command | Subcommands / Args | Replaces |
|---------|--------------------|----------|
| `/ltm:memory` | `recall \| learn \| forget \| relate` | `recall`, `learn`, `capture`, `forget`, `relate` |
| `/ltm:project` | `init \| analyze \| register` | `init-context`, `analyze-context`, `register-project` |
| `/ltm:health` | *(none — full suite)* | `health`, `decay-report`, `doctor`, `hook-doctor` |
| `/ltm:admin` | `migrate \| scan \| server` | `migrate`, `migrate-db`, `secrets-scan`, `ltm-server` |

Old commands become **deprecated aliases** pointing to the new structure. Removed in v1.6.0.

---

## Acceptance Criteria

### AC-1: Fix `secrets-scan.md` bug (broken internal)
- **Bug:** `secrets-scan.md` imports `process.env.CLAUDE_PLUGIN_ROOT + '/src/secretsScrubber.js'` — wrong extension, Bun runs `.ts` directly
- **Fix:** Change to `'/src/secretsScrubber.ts'`
- **Also:** Add a preamble noting that new memories are auto-scrubbed via `db.ts`; this command only patches old memories
- `GIVEN` user runs `/ltm:secrets-scan` or `/ltm:admin scan`
- `THEN` the bun eval resolves `secretsScrubber.ts` without error
- `THEN` output reads: `⚠ Note: new memories are auto-scrubbed on write. This scans existing memories only.`

### AC-2: Merge `doctor` + `hook-doctor`
- `GIVEN` user runs `/ltm:doctor` (or `/ltm:health`)
- `THEN` output includes **both** plugin health checks (versions, DB, MCP, bun runtime) AND hook health (registered hooks, error counts from last 24h)
- `THEN` `/ltm:hook-doctor` executes correctly but prepends: `⚠ Deprecated: use /ltm:doctor. Removing in v1.6.0.`

### AC-3: Merge `migrate` + `migrate-db`
- `GIVEN` user runs `/ltm:migrate` (or `/ltm:admin migrate`) with no args
- `THEN` command runs schema migration status check (existing behaviour)
- `THEN` command also checks: if `~/.claude/memory/ltm.db` exists but `$CLAUDE_PLUGIN_DATA/ltm.db` does not → prompts user to run legacy DB migration
- `THEN` user can pass `--legacy` to explicitly trigger the legacy path migration
- `THEN` `/ltm:migrate-db` executes correctly but prepends deprecation notice

### AC-4: Merge `learn` + `capture` → `/ltm:memory learn`
- `GIVEN` user runs `/ltm:memory learn gotcha "always use X"` (no flag)
- `THEN` stores memory via `mcp__ltm__ltm_learn` only — unchanged behaviour
- `GIVEN` user runs `/ltm:memory learn --save-context decision "we chose Y"`
- `THEN` stores memory via `mcp__ltm__ltm_learn` AND writes context_item row:
  ```sql
  INSERT INTO context_items (project_name, type, content, created_at)
  VALUES (<project>, 'decision', 'we chose Y', datetime('now'))
  ```
  using correct column `project_name` (not `project`)
- `THEN` `/ltm:learn` continues to work (routes to `/ltm:memory learn`)
- `THEN` `/ltm:capture` executes correctly but prepends deprecation notice

### AC-5: Merge `decay-report` + `health` → `/ltm:health`
- `GIVEN` user runs `/ltm:health`
- `WHEN` the graph server is running (port 7331)
- `THEN` output shows project health scores table (from `/api/health/projects`)
- `THEN` output appends a decay section calculated inline from the DB:
  ```
  Memory Decay Summary
  ────────────────────
  Active: N  |  Deprecated: N  |  Last decay run: <date>
  At-risk (score < 0.25): N memories
  ```
- `WHEN` graph server is NOT running
- `THEN` shows decay section only with note: `(graph server offline — start with /ltm:admin server)`
- `THEN` `/ltm:health` (old flat command) → routes to new merged command
- `THEN` `/ltm:decay-report` executes correctly but prepends deprecation notice

### AC-6: `/ltm:memory <subcommand>` routing
- `GIVEN` `/ltm:memory recall <query>` → identical to `/ltm:recall <query>`
- `GIVEN` `/ltm:memory learn <args>` → see AC-4
- `GIVEN` `/ltm:memory forget <id>` → identical to `/ltm:forget <id>`
- `GIVEN` `/ltm:memory relate <args>` → identical to `/ltm:relate <args>`
- `GIVEN` `/ltm:memory` with no subcommand → shows routing table:
  ```
  Usage: /ltm:memory <subcommand>
    recall  — search memories
    learn   — store insight [--save-context to also write context_item]
    forget  — delete by ID
    relate  — link two memories
  ```

### AC-7: `/ltm:project <subcommand>` routing
- `GIVEN` `/ltm:project init` → identical to `/ltm:init-context`
- `GIVEN` `/ltm:project analyze` → identical to `/ltm:analyze-context`
- `GIVEN` `/ltm:project register` → identical to `/ltm:register-project`
- `GIVEN` `/ltm:project` with no subcommand → shows routing table

### AC-8: `/ltm:admin <subcommand>` routing
- `GIVEN` `/ltm:admin migrate [--legacy]` → see AC-3
- `GIVEN` `/ltm:admin scan [--project X] [--dry-run]` → see AC-1
- `GIVEN` `/ltm:admin server [start|stop|status]` → identical to `/ltm:ltm-server`
- `GIVEN` `/ltm:admin` with no subcommand → shows routing table

### AC-9: Deprecation notices on all 12 old commands
All 12 old commands (`recall`, `learn`, `forget`, `relate`, `capture`, `init-context`, `analyze-context`, `register-project`, `health`, `decay-report`, `doctor`, `hook-doctor`, `migrate`, `migrate-db`, `secrets-scan`, `ltm-server`) continue to work but prepend:
```
⚠ Deprecated: use /ltm:<group> <subcommand> instead. Removing in v1.6.0.
```

### AC-10: `/ltm:health` does not require graph server for decay data
- The decay calculation runs inline via `bun --eval` against the local DB
- No new graph server endpoint needed
- Graph server health data is **additive** — included if server is running, skipped if not

---

## Out of Scope

- Adding `/api/health/decay` to graph server (AC-10 avoids this)
- Changing MCP tool signatures (`ltm_recall`, `ltm_learn`, etc.)
- Auto-firing `secrets-scan` as a PostToolUse hook (scrubber already runs in `db.ts` on every write)
- Removing deprecated aliases before v1.6.0

---

## Files to Create / Modify

**Create (4 new commands):**
- `commands/memory.md` — routing table + learn with `--save-context`
- `commands/project.md` — routing table
- `commands/health.md` → **replace** current `health.md` with merged output
- `commands/admin.md` — routing table

**Modify (fix bug + add deprecation notice):**
- `commands/secrets-scan.md` — fix `.js` → `.ts`, add auto-scrub note
- `commands/doctor.md` — add hook-doctor section
- `commands/migrate.md` — add legacy DB detection
- `commands/learn.md` — add `--save-context` flag
- `commands/decay-report.md` — deprecation notice only
- `commands/hook-doctor.md` — deprecation notice only
- `commands/migrate-db.md` — deprecation notice only
- `commands/capture.md` — deprecation notice only

**Keep unchanged:** `recall.md`, `forget.md`, `relate.md`, `init-context.md`, `analyze-context.md`, `register-project.md`, `ltm-server.md`, `analyze-context.md`

**Version bump:** 1.4.16 → 1.4.17

---

## Open Questions

1. Should `/ltm:health` be the primary command (replacing the old flat `/ltm:health`) or a new grouped command? Recommendation: replace in-place — the old `health.md` already shows project scores, just expanding it.
2. Should the 12 deprecated commands show a warning EVERY time, or only once? Recommendation: every time, until v1.6.0 removal.
