# Spec: LTM Command Surface Consolidation (v2)

**Feature slug:** command-consolidation-v2
**Date:** 2026-04-15
**Status:** Draft
**Proposed by:** User interface review

---

## Problem

The current 16 top-level `/ltm:*` commands create cognitive overhead. Highly specific maintenance tasks (`hook-doctor`, `migrate-db`) compete for the same top-level namespace as everyday core operations (`recall`, `learn`). Users must memorise the full list to discover what's available.

## Codebase Context

**Important:** LTM slash commands are **Claude prompt templates** (`.md` files), not executables. There is no CLI parsing library. Claude receives the full argument string and parses subcommands/flags from it directly. This means:
- Subcommand routing (`/ltm:memory recall <query>`) is handled by Claude reading `recall <query>` from the args
- No code changes are required for routing logic — only new command files and updated prompts
- The MCP server (`ltm_recall`, `ltm_learn`, etc.) is called by Claude as before

**Existing spec:** `specs/command-consolidation.md` (2026-04-12) addressed a different problem — moving broken commands into the plugin. This spec supersedes it for the interface design question.

---

## Proposed Changes

### 1. Merge Redundant Commands (8 → 4)

| Before | After | Merge strategy |
|--------|-------|----------------|
| `/ltm:doctor` + `/ltm:hook-doctor` | `/ltm:doctor` | doctor always includes hooks section |
| `/ltm:migrate` + `/ltm:migrate-db` | `/ltm:migrate` | auto-detect legacy DB; `--legacy` flag for explicit override |
| `/ltm:learn` + `/ltm:capture` | `/ltm:learn` | `--save-context` flag writes to `context_items` as well |
| `/ltm:decay-report` + `/ltm:health` | `/ltm:health` | append decay section at bottom of health output |

### 2. Restructure to Noun-Verb (16 → 4 top-level)

| Command | Subcommands | Route |
|---------|-------------|-------|
| `/ltm:memory` | `recall \| learn \| forget \| relate` | Core CRUD on memories |
| `/ltm:project` | `init \| analyze \| register` | Project-scoped context |
| `/ltm:health` | *(no subcommand)* | Full diagnostic: graph + decay + plugin + hooks |
| `/ltm:admin` | `migrate \| scan \| server` | Maintenance and tooling |

**Backwards compatibility:** Keep old commands as aliases that route to the new structure with a deprecation notice. Remove in v1.6.0.

### 3. Automate Two Commands

| Command | Automation approach |
|---------|---------------------|
| `/ltm:secrets-scan` | PostToolUse hook on `ltm_learn` / `ltm_context_items` — scrub before the memory is confirmed |
| `/ltm:decay-report` | Graph server exposes `/api/health/decay` endpoint; `/ltm:health` fetches it inline |

---

## Acceptance Criteria

### AC-1: `/ltm:doctor` includes hook check
- `GIVEN` user runs `/ltm:doctor`
- `WHEN` the output renders
- `THEN` it includes both plugin health (versions, DB, MCP) AND hook health (registered hooks, error counts)
- `THEN` `/ltm:hook-doctor` shows a deprecation notice and delegates to `/ltm:doctor`

### AC-2: `/ltm:migrate` auto-detects legacy DB
- `GIVEN` user runs `/ltm:migrate`
- `WHEN` the script runs
- `THEN` it checks for both schema migrations and legacy DB path migration (previously in `migrate-db`)
- `THEN` if legacy `~/.claude/memory/ltm.db` exists but target doesn't, it prompts to migrate
- `THEN` `/ltm:migrate-db` shows a deprecation notice and delegates to `/ltm:migrate`

### AC-3: `/ltm:learn --save-context` replaces `/ltm:capture`
- `GIVEN` user runs `/ltm:learn gotcha "always use X"` (no flag)
- `WHEN` executed
- `THEN` stores memory via `mcp__ltm__ltm_learn` only (unchanged behaviour)
- `GIVEN` user runs `/ltm:learn --save-context decision "we chose Y"`
- `WHEN` executed
- `THEN` stores memory AND writes context_item to DB (same as current `/ltm:capture` behaviour)
- `THEN` `/ltm:capture` shows deprecation notice and delegates to `/ltm:learn --save-context`

### AC-4: `/ltm:health` includes decay section
- `GIVEN` user runs `/ltm:health`
- `WHEN` the graph server is running
- `THEN` output shows: project health scores table (from graph server) + memory decay summary (from DB)
- `WHEN` the graph server is NOT running
- `THEN` shows decay section only, with note that graph server is offline

### AC-5: `/ltm:memory <subcommand>` routes correctly
- `GIVEN` user runs `/ltm:memory recall "async errors"`
- `THEN` behaves identically to `/ltm:recall "async errors"`
- `GIVEN` user runs `/ltm:memory learn "insight"`
- `THEN` behaves identically to `/ltm:learn "insight"`
- `GIVEN` user runs `/ltm:memory` with no subcommand
- `THEN` shows available subcommands: `recall | learn | forget | relate`

### AC-6: `/ltm:project <subcommand>` routes correctly
- `GIVEN` user runs `/ltm:project init`
- `THEN` behaves identically to `/ltm:init-context`
- `GIVEN` user runs `/ltm:project analyze`
- `THEN` behaves identically to `/ltm:analyze-context`
- `GIVEN` user runs `/ltm:project register`
- `THEN` behaves identically to `/ltm:register-project`

### AC-7: `/ltm:admin <subcommand>` routes correctly
- `GIVEN` user runs `/ltm:admin migrate`
- `THEN` behaves identically to `/ltm:migrate` (with legacy-DB detection)
- `GIVEN` user runs `/ltm:admin scan`
- `THEN` behaves identically to `/ltm:secrets-scan`
- `GIVEN` user runs `/ltm:admin server [start|stop|status]`
- `THEN` behaves identically to `/ltm:ltm-server`

### AC-8: Secrets scanning automated via hook
- `GIVEN` a PostToolUse hook fires after `ltm_learn` or `ltm_context_items` writes
- `WHEN` the new memory content matches a secret pattern (key, token, password)
- `THEN` the content is scrubbed in-place before the MCP response is returned
- `THEN` no user action is required

### AC-9: Backwards compatibility during deprecation window
- `GIVEN` user runs any deprecated command (`/ltm:hook-doctor`, `/ltm:migrate-db`, `/ltm:capture`, `/ltm:decay-report`)
- `THEN` the command executes correctly (no breakage)
- `THEN` output prepends: `⚠ Deprecated: use /ltm:<new-command> instead. This alias will be removed in v1.6.0.`

---

## Out of Scope

- Changing the MCP tool interface (`ltm_recall`, `ltm_learn`, etc.) — these are consumed by other projects
- Graph server API changes beyond adding `/api/health/decay`
- The `ltm:analyze-context` rename (already useful as-is, covered by AC-6)

---

## Implementation Notes

**Subcommand parsing (all commands):** Claude reads the first word of `$ARGUMENTS` as the subcommand. No library needed. Each new command file has a routing table at the top.

**AC-8 hook approach:** Add a `PostToolUse` hook matching `ltm_learn|mcp__ltm__ltm_learn`. The hook script calls `scrubSecrets()` from `src/secretsScrubber.ts` and patches the DB row. This is simpler than a DB trigger and keeps the scrubbing logic in one place.

**File count after consolidation:**
- New top-level commands: 4 (`memory.md`, `project.md`, `health.md`, `admin.md`)
- Deprecated aliases: 8 (kept until v1.6.0)
- Deleted: 4 (`doctor.md` merges into itself, `hook-doctor.md` → alias, `migrate-db.md` → alias, `capture.md` → alias, `decay-report.md` → alias)
- Net: 16 → 4 primary + 8 aliases (removable in v1.6.0)

---

## Open Questions

1. **`/ltm:memory` vs keeping flat:** The flat structure (`/ltm:recall`) is more discoverable for power users. Should we keep BOTH? (Recommended: yes — new grouped commands as additions, old ones as aliases)
2. **Deprecation timeline:** v1.6.0 for removal. Confirm this is acceptable.
3. **AC-8 hook timing:** PostToolUse fires after the tool completes. If the MCP write already committed, the hook patches the row. Acceptable?

---

## Next Step

`/plan` — each AC maps to one plan task.
