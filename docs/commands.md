# Commands Reference

All commands are available as `/ltm:<command>` after installing the plugin. Four commands cover everything — memory, project context, health, and admin.

If no subcommand is given, the command prints its own usage.

---

## `/ltm:memory` — store and search memories

| Subcommand | What it does |
|------------|-------------|
| `recall [query]` | Search memories — FTS5 + semantic fallback. FTS5 supports `AND`, `OR`, `NOT`, phrase matching (`"bun sqlite"`). |
| `learn [insight]` | Store a memory. With no args, Claude reviews the session and extracts patterns automatically. |
| `forget <id>` | Delete a memory by ID. Cascades to relations. |
| `relate <src> <tgt> <type>` | Link two memories. Types: `supports | contradicts | refines | depends_on | related_to | supersedes` |
| `propose` | Review pending memory proposals from `EvaluateSession`. Subcommands: `list`, `review`, `accept`, `reject` |

### Flags for `learn`

- `--category <cat>` — one of `preference | architecture | gotcha | pattern | workflow | constraint`
- `--importance <1-5>` — `5` = inject every session, `1` = recall only
- `--save-context` — also write to `context_items` so it appears at every future session start for this project

### Examples

```
/ltm:memory recall "how we handle async errors"
/ltm:memory learn "always use bun, never npm" --category preference --importance 5
/ltm:memory learn "we chose SQLite over Postgres for zero-dependency deploys" --category architecture --save-context
/ltm:memory forget 42
/ltm:memory relate 42 91 supports
/ltm:memory propose list
```

`recall` returns memories ranked by relevance → importance → recency. `learn` is safe to call twice — the second call reinforces (`confirm_count++`), no duplicates.

---

## `/ltm:project` — manage project context

| Subcommand | What it does |
|------------|-------------|
| `init` | Seed a new project goal into the LTM context system. Run once per project. |
| `analyze [topic]` | Retrieve goals, decisions, and relevant memories before starting work. |
| `register [name]` | Register or rename the current directory in the LTM registry. |

### Examples

```
/ltm:project init
/ltm:project analyze "refactoring the auth layer"
/ltm:project register my-app
```

`init` asks for the current goal, stores it in the DB, and injects it at every session start. `analyze` is what you run before a non-trivial task to load context.

---

## `/ltm:health` — diagnostics

No subcommand. Runs the full health suite:

- Plugin versions (compared across `package.json` and `.claude-plugin/plugin.json`)
- Bun runtime detection
- DB connectivity
- Hook registration health
- Stale file detection
- Live memory decay summary (active vs at-risk memories)

```
/ltm:health
```

Score breakdown when the graph server is running:

| Metric | Weight |
|--------|--------|
| Memory freshness (accessed ≤30 days) | 35% |
| Avg confidence | 25% |
| Context coverage (goal/decision/gotcha/progress) | 20% |
| Session activity (any access ≤14 days) | 20% |

---

## `/ltm:admin` — maintenance

| Subcommand | What it does |
|------------|-------------|
| `migrate [status\|up\|down\|reset\|--legacy]` | Schema migration control + legacy DB detection. `reset` requires confirmation. |
| `scan [--project X] [--dry-run]` | Scan memories for leaked secrets, redact in-place. `--dry-run` is safe. |
| `server [start\|stop\|status]` | Start/stop the graph visualization server (port 7332). |
| `audit [--memory-id N] [--op <op>] [--session <id>] [--since <iso>] [--limit N]` | Query the memory write audit log. |

### Examples

```
/ltm:admin migrate status
/ltm:admin scan --dry-run
/ltm:admin server start
/ltm:admin audit --since 2026-06-01T00:00:00Z
```

`scan` redacts API keys, tokens, and passwords. Always run `--dry-run` first to preview. `migrate reset` drops and recreates the schema — destructive, requires explicit confirmation.

---

## See also

- [README](../README.md) — back to the top
- [Hooks](hooks.md) — the events that fire when commands are used
- [MCP Tools](mcp-tools.md) — the underlying tool surface that the commands wrap
- [Configuration](configuration.md) — `injectTopN`, `semanticFallback`, `autoRelate`
