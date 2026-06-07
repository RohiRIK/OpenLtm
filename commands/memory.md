---
description: "USE WHEN recalling past decisions, storing new insights, forgetting stale memories, linking memories, or reviewing pending memory proposals. Groups recall | learn (with optional --save-context) | forget | relate | propose."
argument-hint: "<recall|learn|forget|relate|propose> [args]"
---

Parse the first word of the arguments as `<subcommand>`. Pass remaining words as `<args>`.

If no subcommand given, show:

```
Usage: /openltm:memory <subcommand>

  recall   — search memories
              /openltm:memory recall [query] [--category X] [--project X] [--limit N]

  learn    — store insight
              /openltm:memory learn [insight] [--category X] [--importance N] [--save-context]

  forget   — delete memory by ID
              /openltm:memory forget <id> [reason]

  relate   — link two memories
              /openltm:memory relate <src-id> <tgt-id> <type>

  propose  — review pending memory proposals from EvaluateSession
              /openltm:memory propose            — list all pending proposals
              /openltm:memory propose review     — show proposals interactively
              /openltm:memory propose accept <session-id> <index>
              /openltm:memory propose reject <session-id> <index>
```

---

## recall

Search LTM memories. Call `mcp__plugin_openltm_memory__recall` with parsed args:

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

Store a memory via `mcp__plugin_openltm_memory__learn`. Parse args:

| Arg | Field | Default |
|-----|-------|---------|
| positional text | `content` | required |
| `--category X` | `category` | `pattern` |
| `--importance N` | `importance` | 3 |
| `--project X` | `project_scope` | current project |
| `--tags t1,t2` | `tags` | — |
| `--save-context` | also write to `context_items` | off |

If no args given, review the session for extractable insights. Extract each, classify, then call `learn` for each.

**Dedup:** calling with identical content reinforces — never creates duplicates.

When `--save-context` is present, after `learn`, also resolve project from `~/.claude/projects/registry.json`, map category to context type (architecture/decision → `decision`, gotcha → `gotcha`, goal → `goal` replacing existing, else → `progress`), then:

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

1. Recall the memory to show what will be deleted: `mcp__plugin_openltm_memory__recall` with the ID or a targeted query.
2. Show the user: content, tags, relations.
3. Confirm before deleting.
4. Call `mcp__plugin_openltm_memory__forget` with `{ id }`.
5. Report: `Deleted [id]. N relations removed.`

Requires explicit ID — use `recall` first if needed. Irreversible.

---

## relate

Call `mcp__plugin_openltm_memory__relate` with `{ source_id, target_id, relationship_type }`.

| Type | Meaning |
|------|---------|
| `supports` | Source provides evidence for target |
| `contradicts` | Source conflicts with target |
| `refines` | Source is more specific than target |
| `depends_on` | Source requires target |
| `related_to` | General association |
| `supersedes` | Source replaces target (target outdated) |

Report: `Linked [src] → [tgt] (type)`. Duplicates are silently ignored.

---

## propose

Review pending memory proposals written by the `EvaluateSession` hook after sessions end.

Proposals are stored as JSON files in `${CLAUDE_PLUGIN_DATA}/proposals/<session-id>.json`.

### propose (no args) / propose review

List all pending proposals using:

```bash
bun --eval "
import { listPendingProposals } from './src/proposals.js';
const ps = listPendingProposals();
if (ps.length === 0) { console.log('No pending proposals.'); process.exit(0); }
for (const p of ps) {
  console.log(\`[\${p.sessionId}:\${p.index}] [\${p.category}] ★\${p.importance} \${p.content}\`);
}
console.log(\`\nTotal: \${ps.length}\`);
"
```

Display each as: `[session-id:index] [category] ★importance content`. Offer to accept or reject each.

### propose accept \<session-id\> \<index\>

```bash
bun --eval "
import { acceptProposal } from './src/proposals.js';
const ok = acceptProposal('<session-id>', <index>);
console.log(ok ? 'Accepted and stored.' : 'Not found.');
"
```

### propose reject \<session-id\> \<index\>

```bash
bun --eval "
import { rejectProposal } from './src/proposals.js';
const ok = rejectProposal('<session-id>', <index>);
console.log(ok ? 'Rejected and removed.' : 'Not found.');
"
```

Rejection removes the proposal without writing to the DB.
