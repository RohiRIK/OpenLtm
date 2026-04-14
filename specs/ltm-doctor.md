# Spec: `/ltm:doctor` — Unified Plugin Health Check

## Problem

The LTM plugin has no single command to diagnose its full state. Existing coverage is fragmented and incomplete:

- `commands/hook-doctor.md` and `commands/health.md` are **identical** (both run `hookDoctor.ts`) — duplicate commands with no differentiation
- `hookDoctor.ts` only finds hooks registered in `settings.json` via `bun /path/to/Hook.ts` pattern — it **cannot detect** plugin-managed hooks from `hooks/hooks.json` which use `/opt/homebrew/bin/bun run ${CLAUDE_PLUGIN_ROOT}/...`
- No check exists for: stale executables in `~/.claude/hooks/`, DB integrity, MCP server registration, plugin.json consistency, bun path validity
- The exit 127 regression (3+ fix attempts) could have been caught by a doctor that checks for stale `rwxr-xr-x` files with `#!/usr/bin/env bun` shebangs in `~/.claude/hooks/`

## Goal

A single `/ltm:doctor` slash command that checks **every aspect** of the plugin and outputs a pass/fail report with actionable remediation for any failure.

---

## Acceptance Criteria

### AC-1: Plugin version consistency
- ✅ `package.json` version == `.claude-plugin/plugin.json` version
- ❌ if mismatched → "Update now will show stale version. Bump both files."

### AC-2: Bun runtime
- ✅ `/opt/homebrew/bin/bun` exists and is executable
- ❌ if missing → "hooks/hooks.json commands will fail. Install bun via Homebrew."

### AC-3: Database
- ✅ `$CLAUDE_PLUGIN_DATA/ltm.db` exists and is readable
- ✅ `SELECT count(*) FROM memories` succeeds (schema valid)
- ✅ All migrations applied (compare `migrations/` files vs `schema_migrations` table)
- ❌ for each failure → specific remediation (e.g., "Run /ltm:migrate")

### AC-4: MCP server registration
- ✅ `ltm` MCP entry exists in `plugin.json` mcpServers
- ✅ No duplicate `ltm` entry in `~/.claude.json` mcpServers (legacy conflict)
- ❌ if duplicate → "Run install-wiring.ts to remove legacy entry"

### AC-5: Plugin-managed hooks (hooks.json)
- For each hook in `hooks/hooks.json` (SessionStart, Stop×2, PreCompact):
  - ✅ Source file exists at `$CLAUDE_PLUGIN_ROOT/hooks/src/<Name>.ts`
  - ✅ Bun binary path in command exists (e.g., `/opt/homebrew/bin/bun`)
  - ✅ No errors for this hook in `~/.claude/logs/hooks.log` in last 24h
  - 🟡 1–2 errors in last 24h
  - 🔴 3+ errors in last 24h

### AC-6: Settings.json hooks (direct registrations)
- Reuse existing `hookDoctor.ts` output verbatim for hooks registered in `~/.claude/settings.json`
- ✅ / ❌ / 🟢 / 🟡 / 🔴 per hook (existing semantics)

### AC-7: Stale hook files in `~/.claude/hooks/`
- For each LTM handler dir (`SessionStart`, `UpdateContext`, `EvaluateSession`, `PreCompact`):
  - ❌ if any `*.ts` or `*.bundle.mjs` file exists that is rwxr-xr-x with `#!/usr/bin/env bun` shebang → "Stale executable will cause exit 127. Run install-wiring.ts or delete manually."
  - ✅ if directory is clean (no such files)

### AC-8: Marketplace source
- ✅ `known_marketplaces.json` ltm entry has `"source": "github"` (enables API-based update checks)
- 🟡 if `"source": "git"` → "Update checks require manual git pull. postinstall patches this automatically."

### AC-9: plugin.json field guard
- ❌ if `plugin.json` contains `"hooks"` field → "Remove it — plugin system auto-discovers hooks.json; this field causes duplicate validation error on /reload-plugins"
- ❌ if `plugin.json` contains `"agents"` field pointing to a missing directory → same pattern

### AC-10: Output format
- Section header per category (## Hooks, ## Database, ## MCP, ## Plugin Manifest, ## Stale Files, ## Marketplace)
- Each check on its own line: `✅ / ❌ / 🟡 / 🔴  <check description>`
- Failures show a one-line remediation inline: `→ <action>`
- Final summary: `N checks passed, M failed` with overall 🟢 / 🔴

---

## Out of Scope

- Fixing issues automatically (doctor is read-only)
- Graph server health (covered by `ltm:health`)
- Memory decay/scoring (covered by `ltm:decay-report`)
- Secrets scanning (covered by `ltm:secrets-scan`)

---

## Implementation Notes

### Reuse
- `hooks/lib/hookDoctor.ts` — reuse for AC-6 (settings.json hooks). Run it and include output verbatim.
- `hooks/lib/hookLogger.ts` `LogEntry` type — reuse for log parsing in AC-5 and AC-7
- `hooks/lib/resolveProject.ts` `getDbPath()` — reuse for DB path in AC-3
- `src/migrations.ts` `runPendingMigrations()` — reuse for AC-3 migration check (dry-run / count only)

### New file
`hooks/lib/pluginDoctor.ts` — orchestrates AC-1 through AC-9, outputs formatted report to stdout.

### Command
`commands/doctor.md` — replace the current duplicate `hook-doctor.md` and `health.md` with a single command that runs `pluginDoctor.ts`.

The existing `hook-doctor.md` and `health.md` become redundant once this is implemented.

### Skill update
Update `skills/ltm:hook-doctor/SKILL.md` to invoke the new unified doctor instead of just hookDoctor.ts.

---

## File Paths

| File | Action |
|------|--------|
| `hooks/lib/pluginDoctor.ts` | **Create** — all checks AC-1 through AC-9 |
| `commands/doctor.md` | **Create** — runs pluginDoctor.ts |
| `commands/hook-doctor.md` | **Delete** — subsumed by doctor |
| `commands/health.md` | **Delete** — was identical to hook-doctor, subsumed |
| `skills/ltm:hook-doctor/SKILL.md` | **Update** — point to new doctor command |
