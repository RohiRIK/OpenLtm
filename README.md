<div align="center">

# OpenLTM

### You explained your auth layer once. Why does Claude ask again tomorrow?

**Long-Term Memory for AI coding agents** — Claude Code, OpenCode, and Pi

[![Version](https://img.shields.io/badge/version-2.5.0-blue?style=flat-square)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Runtime](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square&logo=bun)](https://bun.sh)
[![Database](https://img.shields.io/badge/database-SQLite-003B57?style=flat-square&logo=sqlite)](https://sqlite.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-cc785c?style=flat-square)](https://docs.anthropic.com/en/docs/claude-code)
[![MCP](https://img.shields.io/badge/MCP-compatible-8B5CF6?style=flat-square)](https://modelcontextprotocol.io)

Persistent semantic memory that survives every session, every update, every compaction.

</div>

---

## The philosophy

Four ideas. No exceptions.

- **Memory should be automatic.** Hooks do the work. The session end hook extracts patterns, the session start hook injects them back. You shouldn't have to remember to remember.
- **Decay is a feature, not a bug.** A gotcha from six months ago that you never revisited probably no longer applies. Set `importance: 5` to make something permanent — everything else ages out naturally.
- **Semantic over keyword.** FTS5 full-text search runs first; if it returns nothing, vector embeddings kick in. You search by meaning, not exact words — *"how we handle async errors"* finds the right memory even if you never wrote those exact words.
- **Zero config, zero lock-in.** Install once, works everywhere. Every setting has a sane default. The DB lives outside the plugin directory so it survives every update. No cloud, no telemetry, no account.

---

## What you get

| | |
|---|---|
| 🔍 **Recall** | Past decisions, patterns, and gotchas — before you start work |
| 🧠 **Learn** | Every session, automatically — no manual note-taking |
| 💉 **Inject** | Top context at session start so Claude picks up where it left off |
| ⏳ **Decay** | Stale memories fade while critical knowledge lives forever |
| 🕸 **Graph** | Traverse relationships between memories for reasoning chains |
| 🗺 **Visualize** | See your entire memory network in a browser-based explorer |

---

## Install

### Marketplace (recommended)

```bash
claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin
claude plugin install ltm
```

Restart Claude Code. That's it. Four Claude Code hooks + one git post-commit hook auto-wire, four commands load, five skills activate, and your `ltm.db` migrates or creates itself.

### bunx (no clone)

```bash
bunx @rohirik/ltm-core          # auto-detect Claude Code, OpenCode
bunx @rohirik/ltm-core --pi     # experimental Pi adapter
bunx @rohirik/ltm-core --dry-run --claude  # preview without writing
```

### Dev / git clone

```bash
git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin
cd ~/Projects/claude-ltm-plugin && bash install.sh
```

---

## Quick Start

Start a new session. Context is injected at the top automatically.

Then try:

```
/ltm:memory recall auth       — what do we know about auth in this project?
/ltm:memory learn <insight>   — save something worth keeping
/ltm:health                   — memory health + decay summary
/ltm:project init             — set a goal for the current project
```

That's it. The rest is hooks doing the work.

---

## The shape of memory

```
Claude Code
   │
   ├── 4 Commands  ──┐
   ├── 5 Skills    ──┼──▶  ltm MCP server  ──▶  ltm.db
   └── 5 Hooks     ──┘                        (memories, tags,
                                                context_items,
                                                memory_relations,
                                                memories_fts)
```

Full deep-dive — schema, hook architecture, decay formula, ADRs — in [How It Works](docs/how-it-works.md) and [Architecture](docs/architecture.md).

---

## Verify

```bash
/ltm:health                    # plugin health + hooks + decay
/ltm:memory recall test        # returns results (or "no results" on fresh install)
```

Start a new session — you should see context injected at the top. If not, run `/ltm:health` to diagnose.

---

## Go deeper

| I want to… | Read |
|---|---|
| Use every command and its flags | [Commands](docs/commands.md) |
| Tune decay, injection, embedding behavior | [Configuration](docs/configuration.md) |
| See how it works under the hood | [How It Works](docs/how-it-works.md) · [Architecture](docs/architecture.md) |
| Understand the schema and data model | [DB Spec](docs/DB-SPEC.md) |
| See all hooks, skills, and MCP tools | [Hooks](docs/hooks.md) · [Skills](docs/skills.md) · [MCP Tools](docs/mcp-tools.md) |
| Migrate from the old git-clone setup | [Migration](docs/migration.md) |
| See the product vision and where it's going | [PRD](docs/PRD.md) · [Roadmap](docs/ROADMAP.md) |
| Check what changed | [Changelog](CHANGELOG.md) |

---

## Contributing

Open an issue first to discuss the change. PRs welcome.

Every change requires a version bump in both `package.json` and `.claude-plugin/plugin.json`. See [Changelog](CHANGELOG.md) for conventions.

[Report a Bug](https://github.com/RohiRIK/claude-ltm-plugin/issues)

---

## License

MIT — [RohiRIK](https://github.com/RohiRIK)

---

<div align="center">

**Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)**

*Powered by caffeine, SQLite, and the persistent belief that context shouldn't die at the end of a session.*

</div>
