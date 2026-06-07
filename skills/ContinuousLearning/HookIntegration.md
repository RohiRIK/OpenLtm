# HookIntegration — How Hooks Connect to openltm.db

The four hooks that interact with `$CLAUDE_PLUGIN_DATA/openltm.db`:

## Hook → DB Action Table

| Hook | Trigger | LTM Action | Fallback |
|------|---------|------------|----------|
| `SessionStart` | Session begin | `exportContextMarkdown(project)` → regenerate summary; inject importance-5 globals + top-15 project memories | Reads `context-summary.md` if DB absent |
| `UpdateContext` | Stop (session end) | `addItem(project, type, content, sessionId)` — type auto-detected from `[decision]`/`[gotcha]` prefix; promotes to LTM via `promote()` if prefix matched; default is `progress` | Appends to `context-progress.md` |
| `PreCompact` | Before compaction | `getItems(project, type)` for each type → writes `context-summary.md` | Reads 4 `.md` files if DB absent |
| `Cleanup` | Stop (last) | `trimProgress(project, 20)` — deletes oldest progress rows | Trims `context-progress.md` line count |

## Fallback Behavior

All hooks check `existsSync(DB_PATH)` before importing DB modules.

If `openltm.db` does not exist:
- Hooks fall back to reading/writing the 4 `.md` context files directly
- `context-summary.md` is still written (from `.md` files)
- Session context injection still works

This ensures the system degrades gracefully when the DB has not been initialized.

## SessionStart LTM Injection

When `openltm.db` exists, `SessionStart` calls `getContextMerge(project)` from `db.ts`:
- **Globals:** All memories with `importance = 5` (no project scope)
- **Scoped:** Top 15 memories for the current project, ranked by importance DESC

Injected format (max 30 lines total):
```
## Long-Term Memory

**Global (importance ★★★★★):**
- [1] bun is always preferred over npm
- [2] uv is preferred over pip for python

**Project: myapp**
- [7] JWT refresh tokens stored in httpOnly cookie ★★★★☆
- [9] Supabase RLS must be enabled before production ★★★★★
```

## ESM Import Pattern

All hooks use dynamic ESM import (not `require`):
```ts
const { addItem } = await import(`${CLAUDE_PLUGIN_ROOT}/src/context.js`);
```

The `.js` extension is required even though source is `.ts` — Bun resolves it correctly.

## After Editing Hook Source

Hooks run directly from `.ts` source via `#!/usr/bin/env bun` shebang — no build step needed.
Only `context-mode/server.bundle.mjs` requires a rebuild after edits (see `rules/workflow.md`).
