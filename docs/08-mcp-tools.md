# MCP Tools

OpenLTM exposes its memory layer through the [Model Context Protocol](https://modelcontextprotocol.io). You don't invoke these directly — Claude and the hooks call them under the hood. Think of them as the plugin's private API.

If you ever need to call them yourself (e.g. from a custom hook or script), this is the surface.

---

## The tools

| Tool | Description |
|------|-------------|
| `recall` | Search memories. FTS5 first, semantic fallback if needed. Results carry a `stale` flag and stale memories are downranked. |
| `learn` | Store or reinforce a memory. Deduplicates automatically. Optional `files` param anchors the memory to repo-relative paths it references. |
| `forget` | Delete a memory by ID. Cascades to relations. |
| `revalidate` | Clear a memory's stale flag after review — the code changed but the memory is still correct. Use `forget` when it's actually wrong. |
| `relate` | Create a typed relationship between two memories. |
| `graph` | Traverse the memory graph from seed nodes. |
| `context` | Get merged context (globals + project-scoped) for a project. |
| `context_items` | List context items by type (goal/decision/progress/gotcha). |

---

## When each tool runs

- **`recall`** — fired by the `Learned` skill at session start, and by `/openltm:memory recall`
- **`learn`** — fired by the `ContinuousLearning` skill on session end, and by `/openltm:memory learn`
- **`forget`** — fired by `/openltm:memory forget <id>`
- **`revalidate`** — clears a stale flag set by code-anchored invalidation (see below); also cleared automatically when the memory is re-confirmed via `learn`
- **`relate`** — fired by `/openltm:memory relate <src> <tgt> <type>`, and by `autoRelate: true` in config
- **`graph`** — fired by graph-server HTTP API; available to custom tools
- **`context`** — fired by the `SessionStart` hook to inject project context
- **`context_items`** — fired by `/openltm:project analyze` to render the context panel

---

## Relationship types

`relate` accepts these types: `supports`, `contradicts`, `refines`, `depends_on`, `related_to`, `supersedes`.

The graph view in `localhost:7332` colors edges by type — `contradicts` shows red, `supports` shows green, the rest are blue.

---

## See also

- [README](../README.md) — back to the top
- [Architecture](03-architecture.md) — how the MCP server fits in the container diagram
- [Commands](05-commands.md) — the slash-command surface that wraps these tools
