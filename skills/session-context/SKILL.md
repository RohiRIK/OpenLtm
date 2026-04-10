---
name: session-context
description: "Session context persistence for project goals, decisions, progress, and gotchas; use when restoring project state, managing session notes, or checking whether context was injected at startup."
user-invocable: false
version: 1.0.0
---

# Session Context Persistence

## Overview

Per-project context lives in `$CLAUDE_PLUGIN_DATA/ltm.db` (SQLite). Hooks manage it automatically.
Project names come from `~/.claude/projects/registry.json` — run `/register-project` to see yours.

**Claude does NOT manually write context files.** Hooks handle all reads and writes.

## The 4 Context Types

| Type | Purpose | Managed by |
|------|---------|-----------|
| `goal` | Current objective (1-3 lines) | `/init-context` to seed; auto-replaced on change |
| `decision` | Architectural / key choices | Permanent — never trimmed |
| `progress` | Session log — what was done | `UpdateContext` hook at session end; trimmed to last 20 |
| `gotcha` | Warnings, pitfalls, blockers | Permanent — never trimmed |

## What Happens at Session Start

The `SessionStart` hook:
1. Resolves project from `registry.json`
2. Regenerates `context-summary.md` from DB
3. Injects up to 60 lines of context into your session
4. If DB has LTM memories: also injects importance-5 globals + top-15 project memories

You'll see `## Restored Project Context` at session start when this fires. Acknowledge it briefly and confirm you're ready to continue.

## LTM Commands (store and search learned insights)

| Command | When to use |
|---------|------------|
| `/learn` | After discovering a non-trivial pattern, gotcha, or decision |
| `/recall [query]` | Before starting work on a topic — surface past decisions |
| `/forget <id>` | When a memory is wrong or stale |
| `/relate <src> <tgt> <type>` | Link two related memories |

Use `/recall` before tackling any non-trivial problem to check if there's prior knowledge.

## What PreCompact Does

When compaction fires, `PreCompact` hook:
1. Reads DB for all 4 context types for this project
2. Writes `context-summary.md` (max ~60 lines) as a human-readable fallback
3. This file is injected at the next `SessionStart`

You do not manage `context-summary.md` — the hook overwrites it each compaction.

## Short-Term vs Long-Term Memory

| Question | Answer | Store as |
|----------|--------|----------|
| Specific to the current project? | Yes | context_item (hooks auto-manage) |
| Useful in ALL future projects? | Yes | `/learn` (global memories table) |
| Temporary note / work log? | Yes | context_item `progress` |
| Permanent rule, gotcha, or decision? | Yes | `/learn --importance 5` |

**Short-term** = `context_items`. Auto-managed by hooks. Expires after 14 days inactivity.
**Long-term** = `memories`. Persist forever. Inject into every session via SessionStart.

**When to promote:** If a project-level gotcha has burned you twice, promote it to global LTM with `/learn --importance 5`.

## Promoting Patterns to Durable LTM

Gotchas and decisions in `context_items` survive until the project is stale (14 days inactive).
For lessons that must persist across all projects permanently, use `/learn` with `importance=5`:

```
/learn "⚠ Supabase RLS must be enabled before production" --category gotcha --importance 5
```

These appear in the `memories` table and inject into every session regardless of project.

## Rules

- Never manually write to `context-goals.md`, `context-decisions.md`, `context-progress.md`, or `context-gotchas.md`
- Never manually edit `context-summary.md` — it is auto-generated
- Use `/learn` to persist important insights to global LTM
- Use `/recall` before starting non-trivial tasks
- Use `/init-context` to seed a new project goal (not to create .md files)
- If context wasn't injected at session start, run `/check-context` to diagnose
