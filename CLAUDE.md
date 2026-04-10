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
