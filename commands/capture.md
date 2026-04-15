---
description: "DEPRECATED — use /ltm:learn --save-context or /ltm:memory learn --save-context instead. Save context + learn in one shot."
argument-hint: "<decision|gotcha|progress|pattern|goal> \"<content>\""
allowed-tools: ["Bash"]
---

> ⚠ **Deprecated:** use `/ltm:memory learn --save-context <type> "<content>"` or `/ltm:learn --save-context` instead. This alias will be removed in v1.6.0.

| Type | Context type | LTM category | Importance | Permanent? |
|------|-------------|--------------|------------|------------|
| `decision` | `decision` | `architecture` | 3 | ✅ |
| `gotcha` / `warning` | `gotcha` | `gotcha` | 4 | ✅ |
| `progress` / `done` | `progress` | `workflow` | 2 | trimmed to 20 |
| `pattern` / `learn` | `decision` | `pattern` | 3 | ✅ |
| `goal` | `goal` | `workflow` | 3 | replaces existing |

If no type given, default to `progress` / `workflow`.

## Steps

**1 — Parse:** extract `<type>` and `<content>`. Map via table above.

**2 — Resolve project:**
```bash
cat ~/.claude/projects/registry.json
```
Match `cwd` → `<project>`. If not registered, say so and stop.

**3 — Write both stores in parallel:**

LTM memory (call `mcp__ltm__ltm_learn`):
```json
{ "content": "<content>", "category": "<ltm_category>", "importance": <N>, "project_scope": "<project>" }
```

Context item (bun:sqlite direct):
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

**4 — Confirm:**
```
Captured for **<project>**:
  Context → <type>: "<content>"
  LTM     → <category> (★★★): "<content>"
```

Never ask clarifying questions. Write as-is.
