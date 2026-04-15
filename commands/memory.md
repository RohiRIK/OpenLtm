---
description: "USE WHEN recalling past decisions, storing new insights, forgetting stale memories, or linking memories. Groups recall | learn (with optional --save-context) | forget | relate."
argument-hint: "<recall|learn|forget|relate> [args]"
---

Parse the first word of the arguments as `<subcommand>`. Pass remaining words as `<args>`.

If no subcommand given, show:

```
Usage: /ltm:memory <subcommand>

  recall  — search memories
             /ltm:memory recall [query] [--category X] [--project X] [--limit N]

  learn   — store insight
             /ltm:memory learn [insight] [--category X] [--importance N] [--save-context]

  forget  — delete memory by ID
             /ltm:memory forget <id> [reason]

  relate  — link two memories
             /ltm:memory relate <src-id> <tgt-id> <type>
```

---

## recall

Search LTM memories. Call `mcp__ltm__ltm_recall` with parsed args:

| Arg | Field |
|-----|-------|
| positional text | `query` |
| `--category X` | `category` |
| `--project X` | `project` |
| `--limit N` | `limit` (default 10) |

Display each result: ID · content · category · importance ★ · confirmed count · tags · relations.

FTS5 supports `AND`, `OR`, `NOT`, phrase matching (`"bun sqlite"`). Results ranked: relevance → importance → confidence.

---

## learn

Store a memory via `mcp__ltm__ltm_learn`. Parse args:

| Arg | Field | Default |
|-----|-------|---------|
| positional text | `content` | required |
| `--category X` | `category` | `pattern` |
| `--importance N` | `importance` | 3 |
| `--project X` | `project_scope` | current project |
| `--tags t1,t2` | `tags` | — |
| `--save-context` | also write to `context_items` | off |

If no args given, review the session for extractable insights. Extract each, classify, then call `ltm_learn` for each.

**Dedup:** calling with identical content reinforces — never creates duplicates.

When `--save-context` is present, after `ltm_learn`, also resolve project from `~/.claude/projects/registry.json`, map category to context type (architecture/decision → `decision`, gotcha → `gotcha`, goal → `goal` replacing existing, else → `progress`), then:

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

---

## forget

1. Recall the memory to show what will be deleted: `mcp__ltm__ltm_recall` with the ID or a targeted query.
2. Show the user: content, tags, relations.
3. Confirm before deleting.
4. Call `mcp__ltm__ltm_forget` with `{ id }`.
5. Report: `Deleted [id]. N relations removed.`

Requires explicit ID — use `recall` first if needed. Irreversible.

---

## relate

Call `mcp__ltm__ltm_relate` with `{ source_id, target_id, relationship_type }`.

| Type | Meaning |
|------|---------|
| `supports` | Source provides evidence for target |
| `contradicts` | Source conflicts with target |
| `refines` | Source is more specific than target |
| `depends_on` | Source requires target |
| `related_to` | General association |
| `supersedes` | Source replaces target (target outdated) |

Report: `Linked [src] → [tgt] (type)`. Duplicates are silently ignored.
