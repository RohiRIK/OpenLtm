# ContextItems — Per-Project Context in ltm.db

Context items live in the `context_items` table, scoped to a project name from `registry.json`.

## The 4 Types

| Type | Purpose | Behavior |
|------|---------|---------|
| `goal` | Current objective (1-3 lines) | **Replace** — only one row per project. New goal deletes old. |
| `decision` | Architectural / key choices | **Permanent** — append only, never deleted by hooks. |
| `progress` | Completed tasks, session log | **Trimmed** — Cleanup hook keeps last 20. Deduped by `session_id`. |
| `gotcha` | Warnings, pitfalls, blockers | **Permanent** — append only, never deleted by hooks. |

## Silo Bridge — Promoting Items to Global LTM

`decision` and `gotcha` items can be promoted into the global `memories` table using `promote(itemId)` from `context.ts`.

```ts
import { promote } from "$CLAUDE_PLUGIN_ROOT/src/context.js";
const memId = promote(itemId); // returns memory id, or null if not promotable
```

After promotion, `context_items.memory_id` is set to the new `memories.id`, creating a bidirectional link.

### [decision] / [gotcha] Prefix Syntax in UpdateContext

When the `UpdateContext` hook writes a session line, you can prefix the content with `[decision]` or `[gotcha]` (case-insensitive) to have it automatically stored as the correct type AND promoted to LTM:

```
[decision] Use SQLite WAL mode for all LTM writes — avoids dual-connection issues
[gotcha] bun:sqlite prepare() caches statements; always use .run() not .get() for mutations
```

Without a prefix, the line is stored as `progress` (default behavior).

## Hooks Manage Context Automatically

**Claude does NOT manually write context items.** The hooks handle everything:

- **Progress** is written by `UpdateContext` at session end (reads transcript, detects modified files)
- **[decision]/[gotcha]** prefix in the session line → stored as that type + promoted to `memories` via `promote()`
- **Goal/Decision/Gotcha** must be added via `/ltm:memory learn` (stored in `memories`) or explicitly via `addItem()` in hooks
- **Cleanup** trims progress to last 20 rows
- **PreCompact** reads all types → writes `context-summary.md`
- **SessionStart** regenerates summary from DB and injects it

## When to Use /ltm:project init

Run `/ltm:project init` for a **new project** to seed the initial goal into the DB.

Prerequisites:
1. Project must be registered — run `/ltm:project register` first if needed
2. `/ltm:project init` calls `addItem(project, 'goal', content)` — it does NOT create `.md` files

## context-summary.md

This file at `~/.claude/projects/<name>/context-summary.md` is **auto-generated** by `PreCompact` and `SessionStart` hooks. It is:
- A human-readable snapshot of DB state
- Used as fallback if DB is unavailable next session
- Never manually edited — hooks overwrite it on each compaction/session start

## Checking DB State

```bash
bun -e "
  const { getItems } = await import(\`\${CLAUDE_PLUGIN_ROOT}/src/context.js\`);
  console.log(getItems('myproject'));
"
```

Or run `/ltm:health` which queries the DB and displays counts + recent items.
