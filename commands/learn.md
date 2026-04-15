---
description: "USE WHEN discovering a new insight or pattern worth preserving."
argument-hint: "[insight] --category [preference|architecture|gotcha|pattern|workflow|constraint] --importance [1-5]"
---

Store a memory via `mcp__ltm__ltm_learn`. Parse args:

| Arg | Field | Default |
|-----|-------|---------|
| positional text | `content` | required |
| `--category X` | `category` | `pattern` |
| `--importance N` | `importance` | 3 |
| `--project X` | `project_scope` | current project |
| `--tags t1,t2` | `tags` | — |
| `--save-context` | also write to `context_items` | off |

If no args given, review the session for extractable insights (error patterns, debugging techniques, workarounds, architecture decisions, confirmed preferences). Extract each, classify, then call `ltm_learn` for each.

Report: `Memory [action]: [id] "[content]" (confirmed Nx)`

**Dedup:** calling with identical content reinforces (`action: reinforced`) — never creates duplicates.
**Importance guide:** 5 = inject every session · 4–3 = project sessions · 1–2 = recall only

## --save-context flag

When `--save-context` is present, after calling `ltm_learn`, also write a context item to the DB:

**1 — Resolve project:**
```bash
cat ~/.claude/projects/registry.json
```
Match `cwd` → `<project>`. If not registered, skip context write and warn.

**2 — Map category → context type:**

| Category | Context type |
|----------|-------------|
| `architecture` / `decision` | `decision` |
| `gotcha` | `gotcha` |
| `goal` | `goal` (replaces existing) |
| anything else | `progress` |

**3 — Write context item:**
```bash
bun --eval "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LTM_DB_PATH);
const type = '<context_type>';
const project = '<project>';
const content = '<content>';
if (type === 'goal') {
  db.run(\"DELETE FROM context_items WHERE project_name=? AND type='goal'\", [project]);
}
db.run('INSERT INTO context_items (project_name, type, content, created_at) VALUES (?, ?, ?, datetime(\"now\"))', [project, type, content]);
console.log('ok');
"
```

**4 — Report:**
```
Memory stored: [id] "<content>"
Context → <type> for <project>
```
