---
description: "DEPRECATED — use /ltm:project init instead. Seed a new project goal into the LTM context system."
disable-model-invocation: true
---

> ⚠ **Deprecated:** use `/ltm:project init` instead. This alias will be removed in v1.6.0.

**1 — Verify project is registered:**
```bash
cat ~/.claude/projects/registry.json
```
Match `cwd`. If missing, run `/ltm:register-project` first.

**2 — Check for existing goal:**
```bash
bun --eval "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LTM_DB_PATH);
const row = db.query(\"SELECT content FROM context_items WHERE project_name=? AND type='goal' LIMIT 1\").get('<project>');
console.log(row ? row.content : '');
"
```
If a goal exists, show it and ask: "Replace it?"

**3 — Ask for the goal:**
> "What is the current goal for **\<project\>**? (1–3 bullets, max 100 chars each)"

**4 — Write:**
```bash
bun --eval "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LTM_DB_PATH);
db.run(\"DELETE FROM context_items WHERE project_name=? AND type='goal'\", ['<project>']);
db.run('INSERT INTO context_items (project_name, type, content, created_at) VALUES (?, ?, ?, datetime(\"now\"))', ['<project>', 'goal', '<goal>']);
console.log('done');
"
```

**5 — Confirm:**
```
Project **<project>** seeded.
Goal: <goal>

Decisions, progress, and gotchas accumulate automatically via hooks.
```

Do NOT create context-goals.md or similar files. DB is the source of truth.
