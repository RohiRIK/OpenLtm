# OpenLTM Plugin — Long-Term Memory for AI coding agents

This plugin provides persistent semantic memory across sessions via a local SQLite database.

## Rules

The goal is automatic knowledge retrieval and capture — not a call before every sentence. Use judgment.

1. Call `recall` before a non-trivial task, or when the work touches past decisions or an unfamiliar area. Skip it for trivial one-liners.
2. Call `learn` after discovering a non-obvious pattern, architectural decision, or gotcha worth keeping across sessions.
3. Call `context` at session start or when switching projects, to restore goals, decisions, and gotchas.

## Development Workflow

Every task follows this workflow:

1. **Plan** — Define requirements, check existing patterns with `recall`
2. **Implement** — Write the code
3. **Learn** — After any non-obvious decision, call `learn` to preserve it
4. **Simplify** — Run `/simplify` to clean up the code
5. **Verify** — Run `/verify` (tsc + lint + test + build)

## Version Bump — MANDATORY

**After EVERY fix, feature, or change that touches any file in this repo:**

1. Bump the patch version in **BOTH** files:
   - `package.json` → `"version": "X.Y.Z"`
   - `.claude-plugin/plugin.json` → `"version": "X.Y.Z"`
2. Both files MUST always have the same version number.
3. Commit with `release: bump version to X.Y.Z`
4. Push to GitHub.

**Why:** The Claude Code plugin marketplace detects new versions via the version field in `.claude-plugin/plugin.json`. If the version is not bumped, users never see the update and "Update now" does nothing.

**Do not skip this step even for tiny one-line fixes.**

## Cache Sync — MANDATORY

After every fix, also patch the running cache at:
`~/.claude/plugins/cache/ltm/ltm/<version>/`

The plugin system reads from the cache, not the source repo. Changes only take effect if:
- The cache file is patched directly (immediate), OR
- The user clicks "Update now" in the plugin UI (requires version bump)

## Memory Contract

Tool names, the recall-before / learn-after ritual, memory categories, and the Spec/Plan phase map all live in the **Ltm** skill (`skills/Ltm/SKILL.md`) — the single source of truth. It auto-loads on memory work; load it explicitly with `SkillSearch('ltm memory contract')` if you need the names mid-task.
