# LTM Plugin — Long-Term Memory for Claude Code

This plugin provides persistent semantic memory across sessions via a local SQLite database.

## Rules

The goal is automatic knowledge retrieval and capture — not a call before every sentence. Use judgment.

1. Call `ltm_recall` before a non-trivial task, or when the work touches past decisions or an unfamiliar area. Skip it for trivial one-liners.
2. Call `ltm_learn` after discovering a non-obvious pattern, architectural decision, or gotcha worth keeping across sessions.
3. Call `ltm_context` at session start or when switching projects, to restore goals, decisions, and gotchas.

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

| Tool | When to use | When to skip |
|------|-------------|--------------|
| `ltm_recall` | Before a non-trivial task, or when entering an unfamiliar area — surfaces past decisions, patterns, gotchas. | Trivial one-liners. |
| `ltm_learn` | After discovering a non-obvious pattern, architectural decision, or gotcha worth keeping across sessions. | Facts derivable from the code or git history. |
| `ltm_forget` | When a memory is wrong, outdated, or the user asks to remove it. | — |
| `ltm_relate` | When two memories connect — e.g. a decision caused a gotcha, a pattern applies to an architecture. | — |
| `ltm_context` | At session start or when switching projects — restores goals, decisions, gotchas. | Mid-task within the same project. |
| `ltm_context_items` | To list one context type (goals, decisions, progress, gotchas) for a project. | — |
| `ltm_graph` | When exploring connections between memories or tracing a decision chain. | — |

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
