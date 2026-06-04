# MCP Tools

OpenLTM exposes its memory layer through the [Model Context Protocol](https://modelcontextprotocol.io). You don't invoke these directly — Claude and the hooks call them under the hood. Think of them as the plugin's private API.

If you ever need to call them yourself (e.g. from a custom hook or script), this is the surface.

---

## The seven tools

| Tool | Description |
|------|-------------|
| `ltm_recall` | Search memories. FTS5 first, semantic fallback if needed. |
| `ltm_learn` | Store or reinforce a memory. Deduplicates automatically. |
| `ltm_forget` | Delete a memory by ID. Cascades to relations. |
| `ltm_relate` | Create a typed relationship between two memories. |
| `ltm_graph` | Traverse the memory graph from seed nodes. |
| `ltm_context` | Get merged context (globals + project-scoped) for a project. |
| `ltm_context_items` | List context items by type (goal/decision/progress/gotcha). |

---

## When each tool runs

- **`ltm_recall`** — fired by the `Learned` skill at session start, and by `/ltm:memory recall`
- **`ltm_learn`** — fired by the `ContinuousLearning` skill on session end, and by `/ltm:memory learn`
- **`ltm_forget`** — fired by `/ltm:memory forget <id>`
- **`ltm_relate`** — fired by `/ltm:memory relate <src> <tgt> <type>`, and by `autoRelate: true` in config
- **`ltm_graph`** — fired by graph-server HTTP API; available to custom tools
- **`ltm_context`** — fired by the `SessionStart` hook to inject project context
- **`ltm_context_items`** — fired by `/ltm:project analyze` to render the context panel

---

## Relationship types

`ltm_relate` accepts these types: `supports`, `contradicts`, `refines`, `depends_on`, `related_to`, `supersedes`.

The graph view in `localhost:7332` colors edges by type — `contradicts` shows red, `supports` shows green, the rest are blue.

---

## See also

- [README](../README.md) — back to the top
- [Architecture](architecture.md) — how the MCP server fits in the container diagram
- [Commands](commands.md) — the slash-command surface that wraps these tools
