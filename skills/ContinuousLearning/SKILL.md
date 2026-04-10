---
name: ContinuousLearning
description: "Reference for LTM memory commands, context hooks, and DB schema; use when the user mentions learning, recalling, forgetting, relating, or capturing memory, or when a session starts or the project changes."
user-invocable: false
version: 2.1.0
---

# ContinuousLearning

SQLite-backed memory system at `$CLAUDE_PLUGIN_DATA/ltm.db`. Two tables: `memories` (global learned insights) and `context_items` (per-project goals/decisions/progress/gotchas).

## Workflow Routing

| Trigger | Action |
|---------|--------|
| "Learn this", "Remember this", "Save this pattern" | Run `/learn` |
| "What do I know about X?", "Any past decisions on Y?" | Run `/recall` |
| "Forget about X", "That memory is wrong" | Run `/forget` |
| "X supports Y", "X contradicts Y" | Run `/relate` |

## Examples

**Example 1 — User asks about past architecture:**
> User: "What's our caching strategy?"
> LLM: Calls `ltm_recall(query="caching strategy architecture")` → uses results in response.

**Example 2 — User discovers a gotcha:**
> User: "Don't use npm in this project, it's broken with our setup."
> LLM: Calls `ltm_learn(content="Don't use npm - broken with our setup", category="gotcha", importance=4)` → confirms stored.

**Example 3 — User starts new feature:**
> User: "Add auth to the API."
> LLM: Calls `ltm_recall(query="auth")` + `ltm_context(project="api")` → incorporates prior decisions.

## Quick Reference

- **`/learn`** — Store an insight in `memories` table. Dedup-safe (reinforces on repeat).
- **`/recall [query]`** — FTS5 search with tag/category/project filters.
- **`/forget <id>`** — Delete by ID. CASCADE removes relations. Irreversible.
- **`/relate <src> <tgt> <type>`** — Link memories. Types: `supports|contradicts|refines|depends_on|related_to|supersedes`.
- **Hooks manage context automatically** — no manual writes to `context-*.md` files needed.

## Full Documentation

- Memory commands: `SkillSearch('continuouslearning memory reference')` → `MemoryReference.md`
- Hook integration: `SkillSearch('continuouslearning hook integration')` → `HookIntegration.md`
- Context item types: `SkillSearch('continuouslearning context items')` → `ContextItems.md`
