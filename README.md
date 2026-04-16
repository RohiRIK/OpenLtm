<div align="center">

# claude-ltm-plugin

**Long-Term Memory for Claude Code**

[![Version](https://img.shields.io/badge/version-1.4.20-blue?style=flat-square)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Runtime](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square&logo=bun)](https://bun.sh)
[![Database](https://img.shields.io/badge/database-SQLite-003B57?style=flat-square&logo=sqlite)](https://sqlite.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-cc785c?style=flat-square)](https://docs.anthropic.com/en/docs/claude-code)
[![MCP](https://img.shields.io/badge/MCP-compatible-8B5CF6?style=flat-square)](https://modelcontextprotocol.io)

Persistent semantic memory that survives every session, every update, every compaction.

</div>

---

## Philosophy

Four ideas drive every design decision in this plugin:

- **Memory should be automatic.** Hooks do the work. You shouldn't have to remember to save — the session end hook extracts patterns, the session start hook injects them back. Manual commands exist for when you want control, not because the system needs them.
- **Decay is a feature, not a bug.** Stale memories should fade. A gotcha from six months ago that you never revisited probably no longer applies. Set `importance: 5` to make something permanent — everything else ages out naturally.
- **Semantic over keyword.** FTS5 full-text search runs first. If it returns nothing, vector embeddings kick in. You search by meaning, not exact words — "how we handle async errors" finds the right memory even if you never wrote those exact words.
- **Zero config.** Install once, works everywhere. Every setting has a sane default. The DB lives outside the plugin directory so it survives every update.

---

## Features

- **Recall** past decisions, patterns, and gotchas before starting work
- **Learn** from every session automatically — no manual note-taking
- **Inject** relevant context at session start so Claude picks up where it left off
- **Decay** stale memories naturally while preserving critical knowledge forever
- **Graph** relationships between memories for reasoning chains
- **Visualize** the entire memory network in a browser-based explorer

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Commands](#commands)
- [MCP Tools](#mcp-tools)
- [Skills](#skills)
- [Hooks](#hooks)
- [Configuration](#configuration)
- [Graph Visualizer](#graph-visualizer)
- [How It Works](#how-it-works)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Install

### Marketplace (recommended)

```bash
claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin
claude plugin install ltm
```

Restart Claude Code. That's it.

<details>
<summary><b>What happens on install</b></summary>

```
claude plugin install ltm
         |
         v
  +----------------------------------+
  |  Plugin system sets:             |
  |  CLAUDE_PLUGIN_ROOT -> code      |
  |  CLAUDE_PLUGIN_DATA -> your data |
  +----------------------------------+
         |
         +---> MCP server auto-wired                   ok
         +---> 6 hooks auto-wired                      ok
         +---> 4 commands loaded (+ 11 aliases)        ok
         +---> 5 skills loaded                         ok
         +---> CLAUDE.md loaded                        ok
         +---> ltm.db migrated/created                 ok
                    |
              restart Claude Code
                    |
                    v
               ready to go
```

</details>

### Dev / git clone

```bash
git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin
cd ~/Projects/claude-ltm-plugin && bash install.sh
```

---

## Quick Start

After install, start a new Claude Code session. You'll see context injected automatically at the top.

Then try:

```
/ltm:memory recall <topic>    — search what Claude remembers about a topic
/ltm:memory learn <insight>   — store something worth keeping
/ltm:health                   — plugin health + memory decay status
/ltm:project init             — set a goal for the current project
```

---

## Usage

### Recall before starting work

```
/ltm:memory recall "auth patterns"
```

Returns memories ranked by relevance → importance → recency. Supports FTS5 operators:
`AND`, `OR`, `NOT`, phrase matching (`"bun sqlite"`).

Sample output:
```
[42] Always use parameterized queries in db.ts — raw interpolation causes injection
     category: gotcha  ★★★★  confirmed 3x  tags: security, sqlite

[91] Auth tokens stored in context_items with type='decision' for cross-session recall
     category: architecture  ★★★★★  confirmed 7x
```

### Learn after a discovery

```
/ltm:memory learn "macOS cp aliases to cp -i — use cat file > dest for cache sync" --category gotcha --importance 4
```

Or run with no args to auto-extract insights from the current session:

```
/ltm:memory learn
```

Claude reviews the session, extracts notable patterns, classifies each, and stores them.

### Store a decision with project context

```
/ltm:memory learn "we chose SQLite over Postgres for zero-dependency deploys" --category architecture --save-context
```

`--save-context` also writes to `context_items` so the decision appears at every future session start for this project.

### Set a project goal

```
/ltm:project init
```

Claude asks for the current goal, stores it in the DB, and injects it at every session start.

### Check plugin health

```
/ltm:health
```

Shows plugin versions, DB status, hook health, and a memory decay summary — all in one command.

---

## Commands

4 commands cover everything. Old flat commands still work as deprecated aliases until v1.6.0.

### `/ltm:memory` — store and search memories

| Subcommand | What it does |
|------------|-------------|
| `recall [query]` | Search memories — FTS5 + semantic fallback |
| `learn [insight]` | Store a memory, or auto-extract from session (no args) |
| `forget <id>` | Delete a memory by ID (cascades to relations) |
| `relate <src> <tgt> <type>` | Link two memories with a typed relationship |

```
/ltm:memory recall "how we handle async errors"
/ltm:memory learn "always use bun, never npm" --category preference --importance 5
/ltm:memory forget 42
/ltm:memory relate 42 91 supports
```

### `/ltm:project` — manage project context

| Subcommand | What it does |
|------------|-------------|
| `init` | Seed a new project goal into the context system |
| `analyze [topic]` | Retrieve goals, decisions, and relevant memories before starting work |
| `register [name]` | Register or rename the current directory in the LTM registry |

```
/ltm:project init
/ltm:project analyze "refactoring the auth layer"
/ltm:project register my-app
```

### `/ltm:health` — diagnostics (no subcommand needed)

Runs the full health suite: plugin versions, bun runtime, DB connectivity, hook registration, stale files, and a live memory decay summary.

```
/ltm:health
```

### `/ltm:admin` — maintenance

| Subcommand | What it does |
|------------|-------------|
| `migrate [status\|up\|down\|reset\|--legacy]` | Schema migration control + legacy DB detection |
| `scan [--project X] [--dry-run]` | Scan memories for leaked secrets, redact in-place |
| `server [start\|stop\|status]` | Start/stop the graph visualization server |

```
/ltm:admin migrate status
/ltm:admin scan --dry-run
/ltm:admin server start
```

<details>
<summary><b>Legacy aliases (deprecated — removing in v1.6.0)</b></summary>

All old flat commands still execute but show a deprecation notice.

| Old command | Use instead |
|-------------|-------------|
| `/ltm:recall` | `/ltm:memory recall` |
| `/ltm:learn` | `/ltm:memory learn` |
| `/ltm:forget` | `/ltm:memory forget` |
| `/ltm:relate` | `/ltm:memory relate` |
| `/ltm:capture` | `/ltm:memory learn --save-context` |
| `/ltm:init-context` | `/ltm:project init` |
| `/ltm:analyze-context` | `/ltm:project analyze` |
| `/ltm:register-project` | `/ltm:project register` |
| `/ltm:doctor` | `/ltm:health` |
| `/ltm:hook-doctor` | `/ltm:health` |
| `/ltm:decay-report` | `/ltm:health` |
| `/ltm:migrate` | `/ltm:admin migrate` |
| `/ltm:migrate-db` | `/ltm:admin migrate --legacy` |
| `/ltm:secrets-scan` | `/ltm:admin scan` |
| `/ltm:ltm-server` | `/ltm:admin server` |

</details>

---

## MCP Tools

Called automatically by Claude and hooks. You don't invoke these directly.

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

## Skills

Skills are Claude Code prompt workflows that activate automatically or on demand.

| Skill | What it does | When it activates |
|-------|-------------|-------------------|
| `ContinuousLearning` | Extracts patterns and insights from session transcripts | After session ends (via `EvaluateSession` hook) |
| `LtmServer` | Manages the graph visualization server lifecycle | `/ltm:admin server start\|stop\|status` |
| `GitLearn` | Extracts learnings from git commit diffs | After each commit (opt-in via `gitLearnEnabled`) |
| `Learned` | Surfaces and organises patterns learned across sessions | Session start, `/ltm:memory recall` |
| `session-context` | Manages per-project context injection and summarisation | Session start, pre-compaction |

---

## Hooks

Auto-wired on install. No manual setup required.

| Hook | Event | What It Does |
|------|-------|-------------|
| `SessionStart` | Session opens | Injects top memories + project context (goals, decisions, gotchas) |
| `UpdateContext` | Session stops | Saves session progress to `context_items` |
| `EvaluateSession` | Session stops | Extracts patterns from transcript into `memories` |
| `PreCompact` | Before compaction | Snapshots context to survive compaction |
| `GitCommit` | After git commit | Extracts learnings from diffs (opt-in) |
| `NotifyLtmServer` | After memory change | Pushes updates to the graph visualizer |

> **How hooks execute:** All hooks run via `hooks/bin/run-hook.sh` — a wrapper that locates `bun` across Homebrew, nvm, and system installs before executing. This prevents `exit 127` errors in Claude Code's stripped-PATH subprocess environment. If a hook fails, run `/ltm:health` to diagnose.

---

## Configuration

`~/.claude/config.json`:

```jsonc
{
  "ltm": {
    "decayEnabled": true,        // Enable memory relevance decay
    "injectTopN": 15,            // Max memories injected at SessionStart
    "semanticFallback": true,    // Embedding search when FTS5 returns nothing
    "autoRelate": true,          // Auto-link related memories
    "graphReasoning": false,     // Graph-based reasoning during recall
    "evaluateSessionLlm": false, // LLM-powered session evaluation (costs tokens)
    "gitLearnEnabled": false,    // Auto-learn from git commits
    "gitLearnMinDiffChars": 200  // Min diff size for git learning
  }
}
```

<details>
<summary><b>All config options</b></summary>

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | auto-resolved | Override db location (prefer `LTM_DB_PATH` env var) |
| `decayEnabled` | `true` | Enable memory relevance decay over time |
| `injectTopN` | `15` | Max memories to inject at SessionStart |
| `autoRelate` | `true` | Automatically link related memories |
| `graphReasoning` | `false` | Enable graph-based reasoning during recall |
| `evaluateSessionLlm` | `false` | Use LLM to evaluate sessions (costs tokens) |
| `semanticFallback` | `true` | Fall back to embedding search when FTS returns no results |
| `gitLearnEnabled` | `false` | Auto-extract learnings from git commits |
| `gitLearnMinDiffChars` | `200` | Minimum diff size to trigger git learning |
| `gitLearnFileFilter` | `[]` | Only learn from these file patterns |
| `gitLearnIgnorePatterns` | `["*.lock", "dist/", ".min.js"]` | Skip these files |

</details>

### DB Path Resolution

```
Priority:
  1. LTM_DB_PATH env var          -> explicit override, always wins
  2. $CLAUDE_PLUGIN_DATA/ltm.db   -> marketplace install
  3. ~/.claude/memory/ltm.db      -> dev / git clone fallback
```

Your memories are stored outside the plugin code directory — they survive `claude plugin update`.

---

## Graph Visualizer

Explore your memory network visually in a browser.

```bash
/ltm:admin server start
```

Opens at `localhost:7332` with:
- Force-directed graph of all memories and relationships
- Health dashboard with per-project scores
- Config explorer
- Search, filter, and inspect individual memories

---

## How It Works

```
+---------------------------------------------------------------+
|                        Claude Code                             |
|                                                                |
|  +-------------------+  +-----------+  +------------------+  |
|  | 4 Commands        |  | 5 Skills  |  | 6 Hooks          |  |
|  | /ltm:memory       |  | Continu-  |  | SessionStart     |  |
|  | /ltm:project      |  | ousLearn  |  | UpdateContext    |  |
|  | /ltm:health       |  | LtmServer |  | EvaluateSession  |  |
|  | /ltm:admin        |  | GitLearn  |  | PreCompact       |  |
|  |                   |  | Learned   |  | GitCommit        |  |
|  +--------+----------+  +-----+-----+  | NotifyLtmServer  |  |
|           +-------------------+---------+--------+          |  |
|                               |                              |  |
|                      +--------v--------+                     |  |
|                      |   ltm MCP       |                     |  |
|                      |   server        |                     |  |
|                      +--------+--------+                     |  |
+-------------------------------|-------------------------------+
                                |
                     +----------v-----------+
                     |       ltm.db         |
                     |  +-----------------+ |
                     |  | memories        | |
                     |  | context_items   | |
                     |  | memory_relations| |
                     |  | tags            | |
                     |  | memories_fts    | |
                     |  +-----------------+ |
                     +----------------------+
```

### Session Lifecycle

| Phase | What Happens |
|-------|-------------|
| **Session Start** | `SessionStart` hook injects top memories (importance ≥ 3) + project context (goals, decisions, gotchas) |
| **During Work** | Use `/ltm:memory recall` before tasks, `/ltm:memory learn` after discoveries. MCP tools called automatically. |
| **Session Stop** | `UpdateContext` saves progress. `EvaluateSession` extracts patterns from the transcript. |
| **Pre-Compact** | `PreCompact` snapshots context to `context-summary.md` so it survives compaction. |

### Memory Decay

Memories have half-lives based on importance:

| Importance | Half-Life | Behavior |
|:----------:|:---------:|----------|
| 5 | Forever | Never decays. Injected every session. |
| 4 | 180 days | Long-lived architectural decisions |
| 3 | 90 days | Standard patterns and workflows |
| 2 | 30 days | Short-lived context |
| 1 | 14 days | Ephemeral — fades fast if not accessed |

Score = `importance × confidence × decay_factor`. Below 0.25 = soft-deprecated.

<details>
<summary><b>Project Structure</b></summary>

```
src/                  MCP server, DB layer, embeddings, graph traversal
hooks/src/            6 lifecycle hooks (SessionStart, Stop x2, PreCompact, GitCommit, Notify)
hooks/lib/            Shared hook utilities (resolveProject, llmExtract)
hooks/bin/            run-hook.sh — bun resolver wrapper for stripped-PATH environments
hooks/hooks.json      Hook registrations (auto-wired on install)
commands/             4 slash commands + 11 deprecated aliases
skills/               5 Claude Code skills
scripts/              install-wiring.ts, update-wiring.ts
graph-app/            Next.js memory graph visualizer (port 7332)
migrations/           SQL schema migrations
.claude-plugin/       Plugin manifest (plugin.json)
CLAUDE.md             Loaded by Claude — tool reference
CHANGELOG.md          Version history
```

</details>

---

## Verify Install

```bash
/ltm:health                    # plugin health + hooks + decay status
/ltm:memory recall test        # returns results (or "no results" on fresh install)
```

Start a new session — you should see context injected at the top.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Technical deep-dive — layers, schema, hook architecture, decay formula |
| [Commands](docs/commands.md) | Full command reference with examples |
| [Configuration](docs/configuration.md) | All config options, DB path resolution, server settings |
| [Migration](docs/migration.md) | Upgrading from old `~/.claude/memory/` setup |
| [Changelog](CHANGELOG.md) | Version history |

### Migrating from legacy setup

If you previously used LTM via the `~/.claude/memory/` git-clone setup, [the migration guide](docs/migration.md) covers everything.

Paste this into any LLM coding session to migrate automatically:

```
Follow these instructions exactly. Run every command. Ask before deleting files.

curl -sL https://raw.githubusercontent.com/RohiRIK/claude-ltm-plugin/main/docs/llm-migration-guide.md
```

---

## Contributing

Open an issue first to discuss the change. PRs welcome.

See [CHANGELOG.md](CHANGELOG.md) for versioning conventions. Every change requires a version bump in both `package.json` and `.claude-plugin/plugin.json`.

[Report a Bug](https://github.com/RohiRIK/claude-ltm-plugin/issues)

---

## License

MIT — [RohiRIK](https://github.com/RohiRIK)

---

<div align="center">

**Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)**

*Powered by caffeine and questionable life choices.*

</div>
