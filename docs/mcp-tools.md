# MCP Tools

OpenLTM exposes its memory layer through the [Model Context Protocol](https://modelcontextprotocol.io). You don't invoke these directly — Claude and the hooks call them under the hood. Think of them as the plugin's private API.

If you ever need to call them yourself (e.g. from a custom hook or script), this is the surface.

---

## The seven tools

| Tool | Description |
|------|-------------|
| `recall` | Search memories. FTS5 first, semantic fallback if needed. |
| `learn` | Store or reinforce a memory. Deduplicates automatically. |
| `forget` | Delete a memory by ID. Cascades to relations. |
| `relate` | Create a typed relationship between two memories. |
| `graph` | Traverse the memory graph from seed nodes. |
| `context` | Get merged context (globals + project-scoped) for a project. |
| `context_items` | List context items by type (goal/decision/progress/gotcha). |

---

## When each tool runs

- **`recall`** — fired by the `Learned` skill at session start, and by `/openltm:memory recall`
- **`learn`** — fired by the `ContinuousLearning` skill on session end, and by `/openltm:memory learn`
- **`forget`** — fired by `/openltm:memory forget <id>`
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
- [Architecture](architecture.md) — how the MCP server fits in the container diagram
- [Commands](commands.md) — the slash-command surface that wraps these tools
