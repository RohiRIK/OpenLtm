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

  propose  — review memories proposed at session end
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

Write the query as natural language — each word is matched separately (full-text, plus semantic search when an embedding provider is configured), so FTS operators like quotes or `NOT` are not interpreted. Results are ranked by relevance, importance, decay, and project scope; stale memories are marked and ranked lower.

---

## learn

Store a memory via `mcp__plugin_openltm_memory__learn`. Parse args:

| Arg | Field | Default |
|-----|-------|---------|
| positional text | `content` | required |
| — | `title` | always generate a ≤ 60-char noun phrase |
| `--category X` | `category` | auto-detected |
| `--importance N` | `importance` | 3 |
| `--project X` | `project` | current project |
| `--tags t1,t2` | `tags` | — |
| `--save-context` | also write a project context item | off |

If no args given, review the session for extractable insights. Extract each, classify, then call `learn` for each.

**Dedup:** calling with identical content reinforces — never creates duplicates.

When `--save-context` is present, after `learn` also call `mcp__plugin_openltm_memory__context_add` with `{ type, content }` (plus `project` if `--project` was given; otherwise it defaults to the current project). Map the category to the context type: `architecture` → `decision`, `gotcha` → `gotcha`, anything else → `progress`. To set the project goal instead, use `/openltm:project init` or `context_add` with `type: "goal"` (it replaces the previous goal).

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

Review memories the `SessionEnd` hook proposed from finished sessions. Proposals are never written automatically — they wait here until accepted or rejected. Use the `mcp__plugin_openltm_memory__proposals` tool; never edit the proposal files by hand.

For a fuller curation pass (proposals plus stale, conflicting, and duplicate memories), use the **MemoryReview** skill.

### propose (no args) / propose list / propose review

Call `mcp__plugin_openltm_memory__proposals` with `{ action: "list" }`.

Display each pending proposal as:

```
[session-id:index] [category] ★importance  content
```

End with `Total: N`, or `No pending proposals.` when the list is empty. For `review`, then walk through them one at a time and ask accept / reject / skip for each.

### propose accept \<session-id\> \<index\>

Call `mcp__plugin_openltm_memory__proposals` with `{ action: "accept", session_id: "<session-id>", index: <index> }`.

The proposal is stored through `learn` (dedup applies — an equivalent memory is reinforced, not duplicated). Report `Accepted [session-id:index]` or `Not found.`

### propose reject \<session-id\> \<index\>

Call `mcp__plugin_openltm_memory__proposals` with `{ action: "reject", session_id: "<session-id>", index: <index> }`.

Rejection discards the proposal without writing to the DB. Report `Rejected [session-id:index]` or `Not found.`

Indexes are per session and shift down after an accept or reject in that session. When acting on several proposals from one session, go from the highest index to the lowest, or list again between actions.
