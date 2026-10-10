---
name: Ltm
description: "OpenLTM long-term memory: tool names, the recall-before / learn-after ritual, categories, project context, and what the hooks already inject. Use when the user says 'remember this', 'save this gotcha', 'what do we know about X', 'did we decide on Y before', 'forget that memory', 'link these memories', 'restore project context', 'set the project goal' — or before non-trivial work that may touch past decisions."
---

# Ltm — Memory Contract

The one memory skill. Tool names, ritual, and categories live here so every caller stays consistent. Curation (pending proposals, stale flags, duplicates) is the **MemoryReview** skill; mining git history is **GitLearn**.

## Tools

Plugin `openltm`, MCP server key `memory`: in Claude Code each tool is `mcp__plugin_openltm_memory__<name>`.

| Tool | Call when |
|------|-----------|
| `recall` | Before non-trivial work — natural-language query; surfaces decisions, gotchas, patterns. |
| `learn` | After a durable insight. Always pass a short `title`; add `files` to anchor it to code, or `project` for knowledge that only holds in this repo. With neither it is global (`project_scope: null` in the reply). |
| `context` | Session start / project switch — the goal, decisions, gotchas and recent progress, plus high-importance global (≥ 4) and project memories. |
| `context_items` | List the project's `goal` / `decision` / `progress` / `gotcha` rows. |
| `context_add` | `{type: goal\|decision\|gotcha\|progress, content, project?}` — record project state (a new `goal` replaces the old one). |
| `graph` | Trace decision chains — pass `memory_ids` from `recall`. |
| `relate` | Link two memories (`supports`, `contradicts`, `refines`, `depends_on`, `related_to`, `supersedes`). |
| `revalidate` | Clear a stale flag — code changed but the memory is still true. |
| `forget` | Delete a wrong or obsolete memory. Irreversible — confirm with the user first. |
| `proposals` | `{action: list\|accept\|reject, session_id?, index?}` — memories proposed at session end. |
| `admin_audit` | A memory's provenance / write history. |

`project` is optional on `context`, `context_items`, and `context_add` — it defaults to the current project. `ltm_*` / `openltm_*` tool names belong to the OpenCode, Pi, OpenClaw, and Hermes adapters; on Claude Code use the names above.

## Ritual

1. **Recall before** — `recall` with a natural-language question ("how do we handle auth tokens"), not bare keywords. Skip it for trivial one-liners.
2. **Trace** — for decisions with history, `graph` from the top recall hits.
3. **Work** — grounded in what recall returned; cite memory IDs when they drive a choice.
4. **Learn after** — `learn` genuinely new, durable insights; `relate` them to what they build on. Skip facts derivable from the code or `git log`.

## Where it goes

| It is… | Store with |
|--------|-----------|
| A reusable rule, gotcha, pattern, or decision worth keeping across sessions | `learn` |
| A must-never-forget rule (injected every session, never decays) | `learn` with `importance: 5` |
| This project's current goal, or a project-local decision / gotcha | `context_add` |
| A session work log | nothing — the Stop hook records `progress` |

## Categories

`learn` takes one: **preference** (conventions/style) · **architecture** (design decisions) · **gotcha** (pitfalls) · **pattern** (reusable solutions) · **workflow** (process) · **constraint** (must-follow rules). Importance 1–5, default 3; gotchas usually 4.

## What the hooks already do

You do not need to repeat these by hand:

- **SessionStart** injects project context and an index of top memories — this project's (importance ≥ 3) plus globals with importance ≥ 4; other globals surface through `recall` and prompt recall. If that block is present, skip a redundant `context` call.
- **UserPromptSubmit** injects a few memories relevant to the current prompt.
- **Stop** records a per-session `progress` row. **SessionEnd** *proposes* memories (never auto-writes) — review them with `proposals`.
- **PostToolUse** on `git commit` flags memories anchored to the touched files as stale; `recall` downranks them until revalidated.

## Phase Map

| Phase | Before | During | After |
|-------|--------|--------|-------|
| Spec | `recall` · `context` | explore code | `learn` · `relate` |
| Plan | `recall` · `graph` · `context` (the `ltm-planner` agent runs these read-only itself) | design steps | `learn` the decision · `relate` to the spec |

If the main thread already ran recall, it may pass the results to `ltm-planner` as a `### Pre-Plan Context` block; the agent uses that first.

## Reference

- Read [reference/memory-commands.md](reference/memory-commands.md) when you need tool parameters, dedup rules, recall query syntax, or the `/openltm:*` slash commands.
- Read [reference/context-items.md](reference/context-items.md) when choosing between goal / decision / progress / gotcha, seeding a project, or deciding short-term vs long-term storage.
- Read [reference/hooks.md](reference/hooks.md) when diagnosing what was injected, why context did not appear, or where proposals and stale flags come from.
