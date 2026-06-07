---
name: Ltm
description: "The LTM memory-tool contract — names, ritual, categories, phase map. USE WHEN recalling, learning, relating, or restoring memory."
---

# LTM — Memory Contract

Single source of truth for talking to long-term memory. Load it whenever you touch memory so tool names and the recall-before / learn-after ritual stay consistent.

## Tools

Plugin `ltm`, server key `memory`. In Claude Code each is called as `mcp__plugin_openltm_memory__<name>`.

| Tool | Call when |
|------|-----------|
| `recall` | Before any non-trivial task — surface prior decisions, gotchas, patterns. |
| `learn` | After a durable pattern, gotcha, or decision. |
| `context` | Session start / project switch — restore goals, decisions, gotchas. |
| `context_items` | List one type (`goal`, `decision`, `progress`, `gotcha`) for a project. |
| `graph` | Trace decision chains — pass seed IDs from `recall` to see the "why". |
| `relate` | Link two memories (`supports`, `contradicts`, `refines`, `depends_on`, `related_to`, `supersedes`). |
| `forget` | Remove a wrong or outdated memory. |
| `admin_audit` | Inspect a memory's provenance / audit trail. |

> `ltm_recall` / `ltm_learn` belong to the OpenCode and Pi adapters — not the Claude server. On Claude, use the short names above.

## Ritual

1. **Recall before** — `recall` with natural language (FTS5 + semantic fallback), not bare keywords. Project restore → `context`.
2. **Trace** — for decisions with history, `graph` from the top recall hits.
3. **Work** — grounded in what recall returned.
4. **Learn after** — `learn` durable insights; `relate` to connect them.

## Categories

`learn` takes one: **preference** (conventions/style) · **architecture** (design decisions) · **gotcha** (pitfalls) · **pattern** (reusable solutions) · **workflow** (process) · **constraint** (must-follow rules).

## Phase Map

| Phase | Before | During | After |
|-------|--------|--------|-------|
| Spec | `recall` · `context` | explore code | `learn` · `relate` |
| Plan | `recall` (main thread) | `graph` chains; optional reasoning API* | `relate` |

\* Planner has no MCP tools — main thread recalls and injects a `### Pre-Plan Context` block. Richer chains when the reasoning server runs: `GET http://localhost:7331/api/reasoning/search?q=<topic>&depth=2`.

## Examples

- Before coding → `recall "how we handle X"`, then `graph` the top hits.
- Hit a non-obvious gotcha → `learn` it (category `gotcha`, importance 4); switching project → `context <project>`.
