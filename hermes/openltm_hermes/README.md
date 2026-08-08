# OpenLTM Memory Provider for Hermes Agent

Long-term memory with FTS5 full-text search, vector embeddings, graph relationships, and importance-weighted decay. Local SQLite — zero dependencies, zero Docker, zero API keys.

## What is this?

A Hermes memory provider plugin that wraps [OpenLTM](https://github.com/RohiRIK/OpenLtm) (Rohi's own long-term memory system for Claude Code) and exposes it as a native Hermes memory provider.

## Features

- **FTS5 full-text search** — fast text recall, built into SQLite
- **Vector embeddings** — semantic search via OpenAI/Ollama/Gemini (optional)
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

## Setup

1. Enable the provider:
   ```bash
   hermes config set memory.provider openltm
   ```

2. Start a new session (`/reset`)

3. The provider auto-creates `~/.hermes/openltm.db` on first use

## How it works

- **On session start**: injects memory count and instructions into system prompt
- **Before each turn**: prefetches relevant memories via FTS5
- **After each turn**: extracts and stores learnable patterns
- **On session end**: full conversation extraction (corrections, gotchas)
- **On built-in memory writes**: mirrors to OpenLTM

## Database

Single SQLite file at `~/.hermes/openltm.db`. WAL mode for concurrent access. Schema matches OpenLTM's standard format — compatible with the Claude Code plugin if you use both.

## Architecture

```
__init__.py   — MemoryProvider implementation (Hermes ABC)
_db.py        — SQLite operations (schema, CRUD, FTS5 search)
plugin.yaml   — Plugin manifest
```

Direct SQLite access — no Bun, no MCP server, no subprocess. Python's `sqlite3` reads/writes the same database format as OpenLTM.
