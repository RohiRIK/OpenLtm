# Commands Reference

All commands are available as `/openltm:<command>` after installing the plugin. Five commands cover day-to-day use — memory, project context, health, admin, and the graph server — plus `/openltm:onboard` (first-time setup wizard) and `/openltm:analyze-context` (an alias for `/openltm:project analyze`).

If no subcommand is given, the command prints its own usage.

---

## `/openltm:memory` — store and search memories

| Subcommand | What it does |
|------------|-------------|
| `recall [query]` | Search memories — full-text plus semantic search when an embedding provider is configured. Write the query as natural language; each word is matched separately. |
| `learn [insight]` | Store a memory. With no args, Claude reviews the session and extracts patterns automatically. |
| `forget <id>` | Delete a memory by ID. Cascades to relations. |
| `relate <src> <tgt> <type>` | Link two memories. Types: `supports | contradicts | refines | depends_on | related_to | supersedes` |
| `propose` | Review memories the SessionEnd hook proposed (never auto-written). Subcommands: `list`, `review`, `accept <session-id> <index>`, `reject <session-id> <index>` — backed by the `proposals` MCP tool. For a full curation pass (proposals + stale + duplicates) ask for a memory review — the `MemoryReview` skill. |

### Flags for `learn`

- `--category <cat>` — one of `preference | architecture | gotcha | pattern | workflow | constraint`
- `--importance <1-5>` — `5` = inject every session, `1` = recall only
- `--save-context` — also record it as a project context item (`context_add`) so it appears at every future session start for this project

### Examples

```
/openltm:memory recall "how we handle async errors"
/openltm:memory learn "always use bun, never npm" --category preference --importance 5
/openltm:memory learn "we chose SQLite over Postgres for zero-dependency deploys" --category architecture --save-context
/openltm:memory forget 42
/openltm:memory relate 42 91 supports
/openltm:memory propose list
```

`recall` returns memories ranked by relevance → importance → recency. `learn` is safe to call twice — the second call reinforces (`confirm_count++`), no duplicates.

---

## `/openltm:project` — manage project context

| Subcommand | What it does |
|------------|-------------|
| `init` | Seed a new project goal into the LTM context system. Run once per project. |
| `analyze [topic]` | Retrieve goals, decisions, and relevant memories before starting work. |
| `register [name]` | Register or rename the current directory in the LTM registry. |

### Examples

```
/openltm:project init
/openltm:project analyze "refactoring the auth layer"
/openltm:project register my-app
```

`init` asks for the current goal, stores it with `context_add` (replacing any previous goal), and injects it at every session start. `analyze` is what you run before a non-trivial task to load context.

---

## `/openltm:health` — diagnostics

No subcommand. It reads the plugin's own data dir and database; Claude Code substitutes the path into the command, so no environment variable is needed:

- **Project health scores** — ranked per project while the graph server runs (`/openltm:server start`); weights below.
- **Activity (last 24 h)** — from `<plugin data>/logs/ltm.jsonl`: sessions started and evaluated, context updates, compactions, memories learned, recall hits, prompt recalls, stale flags from commits, and the last errors.
- **Log health** — size and age of `ltm.jsonl` and the legacy `~/.claude/logs/hooks.log`.
- **Janitor status** — last run, next run, and active / deprecated / archived / at-risk counts, read-only from the plugin's database.
- **Duplicate hooks** — OpenLTM hooks still in `~/.claude/settings.json` from an older install; they fire next to the plugin's. It offers `scripts/unwire-legacy-hooks.ts`, which backs the file up and removes only those entries.

If the MCP tools are missing altogether, see [Troubleshooting](09-troubleshooting.md#mcp-tools-are-unavailable) (`scripts/mcp-probe.ts`).

```
/openltm:health
```

Score breakdown when the graph server is running:

| Metric | Weight |
|--------|--------|
| Memory freshness (accessed ≤30 days) | 35% |
| Avg confidence | 25% |
| Context coverage (goal/decision/gotcha/progress) | 20% |
| Session activity (any access ≤14 days) | 20% |

---

## `/openltm:admin` — maintenance

| Subcommand | What it does |
|------------|-------------|
| `migrate [status\|up\|down\|reset\|--legacy]` | Schema migration control + legacy DB detection. `reset` requires confirmation. |
| `scan [--project X] [--dry-run]` | Scan memories for leaked secrets, redact in-place. `--dry-run` only reports (before 2.17 the flag was ignored and the scan wrote). |
| `audit [--memory-id N] [--op <op>] [--session <id>] [--since <iso>] [--limit N]` | Query the memory write audit log. |

### Examples

```
/openltm:admin migrate status
/openltm:admin scan --dry-run
/openltm:admin audit --since 2026-06-01T00:00:00Z
```

The graph server moved out of `admin` — use [`/openltm:server`](#openltmserver--graph-visualizer).

`scan` redacts API keys, tokens, and passwords. Always run `--dry-run` first to preview. `migrate reset` drops and recreates the schema — destructive, requires explicit confirmation.

---

## `/openltm:server` — graph visualizer

| Subcommand | What it does |
|------------|-------------|
| `start` | Starts the API + WebSocket server on `:7331` and the Next.js UI on `:7332`, then opens http://localhost:7332. Both bind to `127.0.0.1` only. |
| `stop` | Stops both processes and frees the ports. |
| `status` (default) | Reports whether the API and UI are up. |

### Examples

```
/openltm:server start
/openltm:server status
/openltm:server stop
```

Logs go to `~/.claude/tmp/ltm-server.log` and `~/.claude/tmp/nextjs.log`. Without a production build of `graph-app/`, the UI starts in dev mode and compiles on first load.

---

## Terminal CLI: integrity, capsules, facts (2.23.0)

These run from a shell through the `ltm` binary (`bunx @rohirik/openltm-core <command>` without a global install).

| Command | What it does |
|---------|-------------|
| `ltm doctor [--deep] [--fix] [--json]` | Checks the database: SQLite `quick_check` (`integrity_check` with `--deep`), foreign keys, the three FTS indexes, vectors whose memory is gone, vectors from another embedding model, the vector index row count, and superseded memories whose replacement is gone. `--fix` backs the database up first, then deletes orphans, rebuilds FTS, drops other-model vectors and rebuilds the vector index. Exit code 1 when a problem remains. `/openltm:doctor` shows the same checks under *Database integrity*. |
| `ltm export --project <p> [--out file] [--include-global] [--include-private] [--mask-pii] [--encrypt]` | Writes a portable *capsule*: one JSON file with the project's memories (tags, files, origin, event time), relations, goal / decisions / gotchas, and collections with their records, plus a SHA-256 checksum. Private memories are left out unless asked. `--encrypt` uses AES-256-GCM with a key derived (scrypt) from `LTM_CAPSULE_PASSPHRASE` (or `--passphrase-env VAR`). The file is written with mode 0600 and an existing file is never overwritten. |
| `ltm import <file> [--project p] [--keep-origin] [--dry-run]` | Verifies the checksum (and decrypts), then writes through normal `learn` dedup. Imported memories get origin `external-source` unless `--keep-origin`, and keep their original event time. The target project's goal is never replaced; duplicate context items are skipped. |
| `ltm facts extract [--project p] [--limit n] [--apply] [--json]` | Finds entity / slot / value facts in active memories with fixed English rules (`X listens on port N`, `X is pinned to vN`, `X uses Y`, `prefer X over Y`, `X lives in <path>`, `X depends on Y`, `the default X is Y`). Without `--apply` it only lists them. With `--apply` it writes one record per `entity.slot` to a global `facts` collection, newest memory wins, each linked to its memory. Then `record query facts` with `slot = port` answers what prose recall only hints at. |

Benchmark (repo checkout only): `bun run bench:locomo [-- --k 5 --convs 2 --semantic --json]` scores retrieval on the LoCoMo dataset (downloaded once, SHA-256 pinned, no LLM calls). Full-text only at k=10 it finds at least one evidence turn for 69% of 1,536 questions.

---

## See also

- [README](../README.md) — back to the top
- [Hooks](06-hooks.md) — the events that fire when commands are used
- [MCP Tools](08-mcp-tools.md) — the underlying tool surface that the commands wrap
- [Configuration](04-configuration.md) — `injectTopN`, `semanticFallback`, `autoRelate`
