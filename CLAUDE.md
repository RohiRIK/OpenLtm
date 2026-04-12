# LTM Plugin — Long-Term Memory for Claude Code

This plugin provides persistent semantic memory across sessions via a local SQLite database.

## Rules

1. **ALWAYS** call `ltm_recall` before starting any non-trivial task
2. **ALWAYS** call `ltm_learn` after making architectural decisions or discovering gotchas
3. **ALWAYS** call `ltm_context` when starting a session or switching projects
4. **NEVER** skip memory recall for tasks involving past decisions

## Development Workflow

Every task follows this workflow:

1. **Plan** — Define requirements, check existing patterns with `ltm_recall`
2. **Implement** — Write the code
3. **Learn** — After any non-obvious decision, call `ltm_learn` to preserve it
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

## Available MCP Tools

| Tool | When to use |
|------|-------------|
| `ltm_recall` | **MUST** call before any non-trivial task — search past decisions, patterns, gotchas. Also call when starting work on unfamiliar areas. |
| `ltm_learn` | **MUST** call after discovering a non-obvious pattern, architectural decision, or gotcha. Call whenever you learn something worth preserving. |
| `ltm_forget` | Call when a memory is wrong, outdated, or user requests removal. |
| `ltm_relate` | Call when two memories are linked — e.g., a decision that caused a gotcha, a pattern that applies to architecture. |
| `ltm_context` | **MUST** call at session start or when switching projects to restore goals, decisions, and gotchas. |
| `ltm_context_items` | Call to list specific context types (goals, decisions, progress, gotchas) for a project. |
| `ltm_graph` | Call when exploring connections between memories or tracing decision chains. |

## Usage Pattern

1. Call `ltm_recall` with the task topic before starting work
2. Call `ltm_learn` after discovering non-obvious patterns or making key decisions
3. Use `ltm_context` at session start to restore project state

## Memory Categories

- **preference** — Project conventions, style preferences, tool choices
- **architecture** — System design decisions, structural patterns
- **gotcha** — Pitfalls to avoid, common mistakes, edge cases
- **pattern** — Reusable solutions, proven approaches
- **workflow** — Process steps, how things get done
- **constraint** — Requirements, limitations, must-follow rules
