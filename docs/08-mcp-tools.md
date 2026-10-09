# MCP Tools

OpenLTM exposes its memory layer through the [Model Context Protocol](https://modelcontextprotocol.io). You don't invoke these directly — Claude and the hooks call them under the hood. Think of them as the plugin's private API.

If you ever need to call them yourself (e.g. from a custom hook or script), this is the surface. The server reports the `@rohirik/openltm-core` package version in its `initialize` handshake.

---

## The tools

| Tool | Description |
|------|-------------|
| `recall` | Search memories. Hybrid full-text + semantic search fused with Reciprocal Rank Fusion (see [How recall ranks](#how-recall-ranks)). Optional `workspace_id` / `agent_id` filters. Results carry a `stale` flag and stale memories are downranked. Pass `includePrivate: true` to include memories tagged `private` (default omitted). |
| `get` | Fetch one memory by id after compact recall. Private-tagged memories return `{ ok:false, error:"private" }` unless `includePrivate: true`. |
| `learn` | Store or reinforce a memory. Deduplicates automatically. Optional `files` param anchors the memory to repo-relative paths it references; optional `workspace_id` / `agent_id` scope it. |
| `forget` | Delete a memory by ID. Cascades to relations. |
| `revalidate` | Clear a memory's stale flag after review — the code changed but the memory is still correct. Use `forget` when it's actually wrong. |
| `relate` | Create a typed relationship between two memories. |
| `graph` | Traverse the memory graph from seed nodes. |
| `admin_audit` | Query the audit log (insert, update, forget, redact, …) with before/after snapshots. |
| `context` | Get merged context (globals + project-scoped memories) for a project. `project` is optional. |
| `context_items` | List context items by type (goal/decision/progress/gotcha). `project` is optional. |
| `context_add` | Record a goal, decision, gotcha, or progress note for a project. `project` is optional. |
| `proposals` | List, accept, or reject memories proposed by end-of-session evaluation. |

### Optional `project`

`context`, `context_items` and `context_add` take an optional `project` (the LTM registry name). When it's omitted, the server uses the current project — the plugin resolves it from the server's working directory exactly like the hooks do (registry exact or longest-prefix match, else the git repo root's folder name, else the working directory's). If no project can be resolved (e.g. a host that supplies no default — `bunx @rohirik/openltm-core mcp-serve` now defaults to its working directory), the tool returns an error asking for `project`. `context` echoes the project it used: `{ project, globals, scoped }`.

Hosts embedding the server pick the default with `buildMcpServer({ defaultProject: () => "<name>" })` / `startMcpServer({ defaultProject })`.

### `context_add`

```json
{ "type": "goal" | "decision" | "gotcha" | "progress", "content": "…", "project": "optional" }
```

Writes through the same DAO the hooks use: a `goal` replaces the project's current goal, `decision` and `gotcha` are permanent, `progress` keeps only the most recent entries. Returns `{ "ok": true, "project": "<name>", "type": "<type>" }` once the row is committed.

### `proposals`

```json
{ "action": "list" | "accept" | "reject", "session_id": "for accept/reject", "index": 0 }
```

- `list` → `{ count, proposals: [{ session_id, index, content, category, importance, source, generated_at }] }`, highest importance first.
- `accept` stores the proposal as a memory (via `learn`) and removes it from the queue; `reject` discards it. Both return `{ ok, action, session_id, index }` and require `session_id` + `index` from a `list` call.
- Indexes shift after every accept/reject — list again before acting on the next one. A missing, malformed (path-like) or stale `session_id` / `index` returns an error and changes nothing.

Proposals live in `${CLAUDE_PLUGIN_DATA}/proposals/<session_id>.json`.

---

## Tool annotations

Every tool carries a `title` and MCP [tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations), so clients can tell reads from writes. All tools work on the local memory store only (`openWorldHint: false`).

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|------|:-:|:-:|:-:|
| `recall`, `context`, `context_items`, `graph`, `admin_audit` | ✅ | — | — |
| `learn`, `context_add` | ❌ | ❌ | ❌ |
| `relate`, `revalidate` | ❌ | ❌ | ✅ |
| `forget` | ❌ | ✅ | ✅ |
| `proposals` | ❌ | ✅ (reject discards) | ❌ |

`recall` and `context` do bump usage counters (`recall_count`, `last_used_at`) that feed decay; that bookkeeping is not treated as a user-visible write.

---

## How recall ranks

1. **Query cleanup.** Common English stopwords (`how`, `do`, `we`, `the`, …) and 1-character tokens are dropped, so "how do we handle database migrations" searches for `handle`, `database`, `migrations`. Words of 4+ letters match as prefixes with a light plural fold (`migrations` also finds `migration`). If only stopwords were typed, the original words are searched instead.
2. **Two retrievers.** FTS5 (BM25 order, top 50) and, when an embeddings provider is configured, a semantic search over stored embeddings run **in parallel on every query**. Previously the semantic search only ran when full-text search found fewer results than `limit`.
3. **Fusion.** Both lists merge with Reciprocal Rank Fusion: `score = Σ 1 / (60 + rank)`. A memory found by both retrievers outranks one found by either alone.
4. **Recall v2 scoring on top.** Fused relevance leads; importance, decay, project scope, recall frequency, staleness, and near-duplicate demotion nudge near-ties.

Recall falls back to **full-text only**, with identical results, when any of these is true:

- `ltm.semanticFallback` is `false` in config
- the embeddings provider is `"disabled"` (config or `LTM_EMBED_PROVIDER`)
- the provider is unreachable, errors, or takes longer than 2 s
- the caller passes `semantic: false` to core `recall()` (for hot paths)

`explainer.ftsRank` in verbose results is BM25 relative to the best full-text hit (1 = best match). `explainer.semanticScore` is the cosine similarity.

### Workspace and agent filters

`recall({ workspace_id })` returns memories learned with that `workspace_id` plus memories with no workspace; `agent_id` works the same way. `learn` persists both fields.

---

## When each tool runs

- **`recall`** — called before non-trivial work (the `Ltm` skill's ritual), and by `/openltm:memory recall`; the `UserPromptSubmit` hook does its own lightweight full-text recall per prompt
- **`learn`** — called after a durable discovery (the `Ltm` skill's ritual), on `proposals` accept, and by `/openltm:memory learn`
- **`forget`** — fired by `/openltm:memory forget <id>`
- **`revalidate`** — clears a stale flag set by code-anchored invalidation; also cleared automatically when the memory is re-confirmed via `learn`
- **`relate`** — fired by `/openltm:memory relate <src> <tgt> <type>`, and by `autoRelate: true` in config
- **`graph`** — fired by graph-server HTTP API; available to custom tools
- **`context`** — fired by the `SessionStart` hook to inject project context
- **`context_items`** — fired by `/openltm:project analyze` to render the context panel
- **`context_add`** — called by the model when a goal, decision, gotcha, or milestone should outlive the session
- **`proposals`** — reviewing what end-of-session evaluation wants to remember before it's stored

---

## Relationship types

`relate` accepts these types: `supports`, `contradicts`, `refines`, `depends_on`, `related_to`, `supersedes`.

The graph view in `localhost:7332` colors edges by type — `contradicts` shows red, `supports` shows green, the rest are blue.

---

---

## Private tag (`private`)

Memories tagged `private` are **omitted by default** from auto-recall, SessionStart inject, MCP `recall`/`get`/`context`, markdown/graph export, and janitor embed/dedup/archive candidate scans.

Pass `includePrivate: true` on `recall` / `get` to opt in.

**private ≠ encrypted** — content remains plaintext in SQLite. The tag is a visibility filter only, not encryption or access control against a DB reader.


## See also

- [README](../README.md) — back to the top
- [Architecture](03-architecture.md) — how the MCP server fits in the container diagram
- [Commands](05-commands.md) — the slash-command surface that wraps these tools
