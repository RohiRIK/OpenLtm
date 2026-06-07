# LTM Migration: Legacy to Plugin

You are migrating a user's LTM (Long-Term Memory) system from the legacy `~/.claude/memory/` git-clone setup to the marketplace plugin. Follow every step in order. Ask the user for confirmation before deleting files.

## Step 1 — Detect Current State

Run these three checks. Record the results as YES/NO.

```bash
# Check A: Plugin DB exists?
# Note: CLAUDE_PLUGIN_DATA is only set inside plugin hooks/MCP, not in user shells.
# Scan the conventional plugin data directory instead.
ls ~/.claude/plugins/data/ltm-*/openltm.db 2>/dev/null && echo "PLUGIN_DB=YES" || echo "PLUGIN_DB=NO"

# Check B: Legacy DB exists?
ls ~/.claude/memory/openltm.db 2>/dev/null && echo "LEGACY_DB=YES" || echo "LEGACY_DB=NO"

# Check C: Legacy JS modules present?
ls ~/.claude/memory/db.js 2>/dev/null && echo "LEGACY_JS=YES" || echo "LEGACY_JS=NO"
```

### Interpret results

| PLUGIN_DB | LEGACY_DB | Meaning | Action |
|-----------|-----------|---------|--------|
| YES | YES | Plugin installed, legacy leftover | Skip to Step 4 (cleanup) |
| YES | NO | Plugin installed, clean | Done. No migration needed. |
| NO | YES | Legacy install, needs migration | Continue to Step 2 |
| NO | NO | Fresh install, no data | Continue to Step 2 (no data to migrate) |

## Step 2 — Install the Plugin

Run these two commands:

```bash
claude plugin marketplace add https://github.com/RohiRIK/OpenLtm
claude plugin install ltm
```

The installer tries to auto-copy `~/.claude/memory/openltm.db` to the plugin data directory. If `CLAUDE_PLUGIN_DATA` is not set during install (common on first install), it scans `~/.claude/plugins/data/ltm-*` as a fallback.

If the auto-copy did not run (check Step 1's PLUGIN_DB after install), copy manually:

```bash
# Find the plugin data directory
PLUGIN_DATA=$(ls -d ~/.claude/plugins/data/ltm-* 2>/dev/null | head -1)

# Copy legacy DB if plugin data dir exists but has no openltm.db
if [ -n "$PLUGIN_DATA" ] && [ ! -f "$PLUGIN_DATA/openltm.db" ] && [ -f ~/.claude/memory/openltm.db ]; then
  cp ~/.claude/memory/openltm.db "$PLUGIN_DATA/openltm.db"
  echo "Copied openltm.db to $PLUGIN_DATA/"
fi
```

## Step 3 — Verify

Run this check:

```bash
claude plugin info ltm
```

Confirm:
1. Plugin is listed and version is shown
2. Restart the session
3. Run `/openltm:recall test` — it should return results (or "no results" on fresh install, which is expected)
4. Run `/openltm:hook-doctor` — all hooks should show green

If recall returns empty but `~/.claude/memory/openltm.db` has data, the DB copy failed. Run:

```bash
/openltm:migrate-db
```

This diagnoses the path and copies the DB if needed.

## Step 4 — Clean Up Legacy Artifacts

**Ask the user before deleting anything.**

### 4a. Remove legacy JS modules

These are replaced by the plugin's bundled MCP server:

```bash
rm -f ~/.claude/memory/db.js
rm -f ~/.claude/memory/context.js
rm -f ~/.claude/memory/shared-db.js
rm -f ~/.claude/memory/secretsScrubber.js
rm -f ~/.claude/memory/migrate.ts
rm -f ~/.claude/memory/mcp-server.ts
```

### 4b. Remove legacy slash commands

These are replaced by `/openltm:` prefixed versions:

```bash
rm -f ~/.claude/commands/recall.md
rm -f ~/.claude/commands/learn.md
rm -f ~/.claude/commands/forget.md
rm -f ~/.claude/commands/relate.md
rm -f ~/.claude/commands/capture.md
rm -f ~/.claude/commands/decay-report.md
rm -f ~/.claude/commands/migrate.md
```

### 4c. Remove stale MCP entry from ~/.claude.json

Check for a manual `ltm` entry:

```bash
cat ~/.claude.json | grep -A3 '"ltm"'
```

If it contains `"command": "bun"` pointing to `~/.claude/memory/mcp-server.ts`, remove the entire `ltm` key from `mcpServers`. The plugin system manages MCP registration now. The installer does this automatically, but verify.

### 4d. Remove stale hooks from settings.json

The `install-wiring.ts` script now automatically detects marketplace installs and removes any stale LTM hook entries from `~/.claude/settings.json`. This handles the common case where a user migrated from a dev/git-clone install (which wired hooks into settings.json) to a marketplace install (which uses `hooks/hooks.json` managed by the plugin system).

After installing the plugin, verify no duplicates remain:

```bash
grep -E 'SessionStart\.ts|UpdateContext\.ts|EvaluateSession\.ts|PreCompact\.ts' ~/.claude/settings.json
```

If any LTM hook entries still appear in settings.json, they are stale — the plugin system manages hooks via `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}` variable substitution. Remove them manually or re-run:

```bash
bun run <plugin-root>/scripts/install-wiring.ts <plugin-root>
```

Also check for hooks referencing the legacy `~/.claude/memory/` path:

```bash
grep '~/.claude/memory/' ~/.claude/settings.json
```

Any hook referencing `~/.claude/memory/` is stale and should be removed.

### 4e. Keep legacy DB as backup (recommend)

```
~/.claude/memory/openltm.db  — keep until user confirms plugin is working across multiple sessions
```

Suggest deletion only after the user has used the plugin for at least one full session.

## Step 5 — Confirm Migration Complete

Run this final checklist:

```bash
# Plugin DB exists and has data
ls -la ~/.claude/plugins/data/ltm-*/openltm.db

# No legacy JS modules remain
ls ~/.claude/memory/*.js 2>/dev/null && echo "WARN: legacy JS files remain" || echo "OK: clean"

# No stale hooks
grep -E 'SessionStart|UpdateContext|EvaluateSession|PreCompact' ~/.claude/settings.json 2>/dev/null | grep -v hooks.json && echo "WARN: stale hooks in settings.json" || echo "OK: clean"

# No stale MCP entry
grep '"ltm"' ~/.claude.json 2>/dev/null | grep 'memory' && echo "WARN: stale MCP" || echo "OK: clean"
```

Report results to the user. All four should show OK/clean.

## Quick Reference

| Aspect | Legacy | Plugin |
|--------|--------|--------|
| DB path | `~/.claude/memory/openltm.db` | `$CLAUDE_PLUGIN_DATA/openltm.db` |
| Commands | `/recall`, `/learn` | `/openltm:recall`, `/openltm:learn` |
| MCP | Manual in `~/.claude.json` | Automatic via `plugin.json` |
| Hooks | Hardcoded `~/.claude/memory/` | `CLAUDE_PLUGIN_ROOT` variable |
| Updates | `git pull` in `~/.claude/memory/` | `claude plugin update ltm` |
| Migrations | `bun run migrate.ts` | `/openltm:migrate` |
