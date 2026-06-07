# MemoryReference — LTM Command Reference

Full reference for `/openltm:memory learn`, `/openltm:memory recall`, `/openltm:memory forget`, and `/openltm:memory relate`, backed by `$CLAUDE_PLUGIN_ROOT/src/db.ts`.

## /openltm:memory learn — Store an Insight

**When to use:** After discovering a non-obvious pattern, gotcha, preference, or architecture decision that should survive across projects and sessions.

**Fields:**
- `content` (required) — The insight, max ~200 chars
- `category` — `pattern | preference | gotcha | architecture | workflow | constraint`
- `importance` — 1–5 (default 3). Use 5 for system-critical facts.
- `project` — Scope to a project name (omit for global)
- `tags` — Array of strings for filtering

**Dedup behavior:** `normalizeKey(content)` strips punctuation/case. Calling learn with equivalent content increments `confirm_count` rather than inserting a duplicate.

**Code pattern:**
```ts
import { learn } from "$CLAUDE_PLUGIN_ROOT/src/db.js";
learn({ content, category, importance, project, tags });
```

**`skipExport` flag:** Pass `skipExport: true` during bulk imports to avoid N+1 `exportMarkdown()` calls. Call `exportMarkdown()` once at the end.

---

## promote() — Promote a context_item to LTM

**When to use:** When a `decision` or `gotcha` context item should be elevated to global long-term memory so it persists across all projects and sessions.

```ts
import { promote } from "$CLAUDE_PLUGIN_ROOT/src/context.js";
const memId = promote(itemId); // returns new memory id, or null if not promotable
```

- Only `decision` and `gotcha` types are promotable (returns `null` for `goal`/`progress`)
- Sets `context_items.memory_id` to the new `memories.id` to track the link
- `decision` → category `architecture`, importance 3
- `gotcha` → category `gotcha`, importance 4
- Dedup-safe: calling `promote()` on the same item twice reinforces the memory rather than duplicating it

**Bulk backfill:** Run `bun $CLAUDE_PLUGIN_ROOT/scripts/backfill-promote.ts` to promote all existing unpromoted decision/gotcha items.

---

## /openltm:memory recall — Search Memories

**When to use:** Before starting work on a topic to surface relevant past decisions. Skip for trivial one-liners.

**Syntax:**
```
/openltm:memory recall [query]
/openltm:memory recall [query] --tags tag1,tag2
/openltm:memory recall [query] --category pattern
/openltm:memory recall [query] --project myapp
/openltm:memory recall [query] --limit 10
```

**FTS5 query syntax:**
- `bun sqlite` — both words anywhere
- `"bun sqlite"` — exact phrase
- `bun* ` — prefix match
- `bun OR sqlite` — either word

**Output:** Shows memory ID, content, importance stars, tags, and graph neighbors (related memory IDs + relationship type).

---

## /openltm:memory forget — Delete a Memory

**When to use:** When a memory is wrong, stale, or superseded.

**Steps:**
1. Run `/openltm:memory recall <topic>` first to find the memory ID
2. Run `/openltm:memory forget <id> [reason]`
3. Confirm with user before deletion (irreversible)
4. CASCADE removes all `memory_tags` and `memory_relations` rows

**Code pattern:**
```ts
import { forget } from "$CLAUDE_PLUGIN_ROOT/src/db.js";
forget({ id, reason });
```

---

## /openltm:memory relate — Link Two Memories

**When to use:** When you recognize a conceptual connection between two existing memories.

**Syntax:** `/openltm:memory relate <src_id> <tgt_id> <type>`

**Relationship types:**
| Type | Meaning |
|------|---------|
| `supports` | src provides evidence for tgt |
| `contradicts` | src conflicts with tgt |
| `refines` | src is a more precise version of tgt |
| `depends_on` | src requires tgt to be valid |
| `related_to` | general association |
| `supersedes` | src replaces tgt (tgt is obsolete) |

**Note:** Relations are directional. `A supersedes B` ≠ `B supersedes A`.
