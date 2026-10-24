# OpenLTM Memory Provider for Hermes Agent

Long-term memory with FTS5 full-text search, vector embeddings, graph relationships, and importance-weighted decay. Local SQLite — zero dependencies, zero Docker, zero API keys.

## What is this?

A Hermes memory provider plugin that wraps [OpenLTM](https://github.com/RohiRIK/OpenLtm) (Rohi's own long-term memory system for Claude Code) and exposes it as a native Hermes memory provider.

## Features

- **FTS5 full-text search** — fast text recall, built into SQLite
- **Vector embeddings** — semantic search via a local llama.cpp server (optional; Ollama also supported)
- **Memory categories** — preference, architecture, gotcha, pattern, workflow, constraint
- **Importance-weighted decay** — importance 5 = permanent; 1-4 fade over time
- **Deduplication** — same insight reinforced, not duplicated
- **Project scoping** — memories can be scoped to specific projects
- **Graph relationships** — memories can link to each other (supports, contradicts, refines, etc.)
- **Context items** — per-project goals, decisions, progress, gotchas

## Tools

| Tool | Purpose |
|------|---------|
| `openltm_recall` | Search memories by text query |
| `openltm_learn` | Store insights, patterns, decisions |
| `openltm_forget` | Delete a memory by ID |
| `openltm_context` | Get project context (goals, decisions, gotchas) |
| `openltm_relate` | Link two memories with a typed relationship |
| `openltm_graph` | Traverse the memory graph from a memory |
| `openltm_brain_stats` | Totals, categories, importance distribution, relations, stale count |
| `openltm_stale` | List memories flagged as stale, or flag/revalidate one |
| `openltm_collection` | Define, list, evolve or archive a structured type (collection) |
| `openltm_record` | Store, get, query (by field or text) or archive records in a collection |

## Setup

0. Install from the [Hermes Plugin Catalog](https://hermes-agent.nousresearch.com/docs/plugins/openltm)
   and restart the gateway (plugins load only at startup):
   ```bash
   hermes plugins install openltm
   hermes gateway restart
   ```

1. Enable the provider:
   ```bash
   hermes config set memory.provider openltm
   ```

2. Start a new session (`/reset`)

3. The provider auto-creates `~/.hermes/openltm.db` on first use

4. For semantic (vector) search, run a local llama.cpp embedding server (below).
   Without one, recall uses FTS5 full-text search and nothing leaves your machine.

### Local llama.cpp embeddings (recommended)

Run a dedicated embedding model with llama-server, not a chat model:

```bash
llama-server --model /path/to/bge-m3-Q8_0.gguf --embedding --pooling cls --alias bge-m3 --host 127.0.0.1 --port 8080
```

Pick `llamacpp` in `hermes memory setup openltm`, or merge these fields into your
profile's `openltm.json`, preserving other settings:

```json
{
  "embedder": "llamacpp",
  "llamacpp_url": "http://127.0.0.1:8080",
  "embedding_model": "bge-m3"
}
```

Restart Hermes after changing the provider. The plugin probes `GET /health` and
requests `POST /v1/embeddings` with `{model, input}`. No cloud key is needed and
failure never selects a cloud provider. Unavailable servers and invalid vectors
fall back to full-text recall; failed embeddings are not cached.

JSON URL/model options take precedence over `LTM_LLAMA_CPP_URL` and
`LTM_EMBED_MODEL`. Defaults are `http://127.0.0.1:8080` and `bge-m3` (1024
dimensions); valid server vectors determine the actual stored dimension.

When Claude Code shares the database, use `LTM_EMBED_PROVIDER=llamacpp`, the same
`LTM_LLAMA_CPP_URL`, and the same `LTM_EMBED_MODEL`. Use a model key identifying
the actual model served. Do not label BGE-M3 vectors `nomic-embed-text`: vectors
from different models are not interchangeable. Existing vectors are not
automatically re-embedded by this plugin change. Keep the server loopback-bound
unless you have an authenticated, trusted network deployment.

If `openltm.json` sets no `embedder`, the plugin probes a local Ollama server
(`nomic-embed-text`) instead. `"embedder": "none"` turns vector search off.

## How it works

- **On session start**: injects memory count and instructions into system prompt
- **Before each turn**: prefetches relevant memories via FTS5
- **After each turn**: extracts and stores learnable patterns
- **On session end**: full conversation extraction (corrections, gotchas)
- **On built-in memory writes**: mirrors to OpenLTM

## Database

Single SQLite file at `~/.hermes/openltm.db`. WAL mode for concurrent access. Claude Code and the other OpenLTM hosts can share it by pointing `LTM_DB_PATH` at it (OpenLTM 2.17.1+); vectors are read and written in whichever layout the DB has. See [Sharing one memory with Claude Code](../../docs/10-hermes-plugin.md#sharing-one-memory-with-claude-code-2171).

## Architecture

```
__init__.py   — MemoryProvider implementation (Hermes ABC)
_db.py        — SQLite operations (schema, CRUD, FTS5 search)
plugin.yaml   — Plugin manifest
```

Direct SQLite access — no Bun, no MCP server, no subprocess. Python's `sqlite3` reads/writes the same database format as OpenLTM.
