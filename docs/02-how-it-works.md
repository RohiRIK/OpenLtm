# How It Works

The one-page tour. The [Architecture](03-architecture.md) doc is the 1000-line deep-dive; this is the 30-second version that gets you oriented before you read it.

---

## The shape of memory

```
+---------------------------------------------------------------+
|                        Claude Code                            |
|                                                               |
|  +-------------------+  +-----------+  +------------------+   |
|  | 4 Commands        |  | 5 Skills  |  | 4 Claude Code    |   |
|  | /openltm:memory       |  | Continu-  |  |    hooks         |   |
|  | /openltm:project      |  | ousLearn  |  | SessionStart     |   |
|  | /openltm:health       |  | LtmServer |  | UpdateContext    |   |
|  | /openltm:admin        |  | GitLearn  |  | EvaluateSession  |   |
|  |                   |  | Learned   |  | PreCompact       |   |
|  +--------+----------+  +-----+-----+  +------------------+   |
|           +-------------------+---------+                     |   |
|                               |                            |   |
|                      +--------v--------+                   |   |
|                      |   ltm MCP       |                   |   |
|                      |   server        |                   |   |
|                      +--------+--------+                   |   |
+-------------------------------|------------------------------+
                                |
                     +----------v-----------+
                     |       openltm.db         |
                     |  +-----------------+ |
                     |  | memories        | |
                     |  | context_items   | |
                     |  | memory_relations| |
                     |  | tags            | |
                     |  | memories_fts    | |
                     |  +-----------------+ |
                     +----------------------+
```

Three surfaces — **commands** (you talk), **skills** (Claude's prompt workflows), **hooks** (the lifecycle events) — all funnel through the **MCP server** into a single SQLite database.

---

## Session lifecycle

| Phase | What Happens |
|-------|-------------|
| **Session Start** | `SessionStart` hook injects top memories (importance ≥ 3) + project context (goals, decisions, gotchas) |
| **During Work** | Use `/openltm:memory recall` before tasks, `/openltm:memory learn` after discoveries. MCP tools called automatically. |
| **Session Stop** | `UpdateContext` saves progress. `EvaluateSession` extracts patterns from the transcript. |
| **Pre-Compact** | `PreCompact` snapshots context to `context-summary.md` so it survives compaction. |

You never have to remember any of this. The hooks are wired on install. If you want the playbook, see [Hooks](06-hooks.md).

---

## Memory decay

Memories have half-lives based on importance. Stale knowledge fades; critical knowledge never does.

| Importance | Half-Life | Behavior |
|:----------:|:---------:|----------|
| 5 | Forever | Never decays. Injected every session. |
| 4 | 180 days | Long-lived architectural decisions |
| 3 | 90 days | Standard patterns and workflows |
| 2 | 30 days | Short-lived context |
| 1 | 14 days | Ephemeral — fades fast if not accessed |

The score formula:

```
score = importance × confidence × decay_factor
```

A memory's `decay_factor` shrinks toward 0 as it ages past its half-life. Below 0.25, it's **soft-deprecated** — still returned by `recall` if you ask explicitly, but no longer auto-injected at session start.

This is intentional. A gotcha you never revisited for six months probably no longer applies. If you want it permanent, set `importance: 5`. If you're not sure, set `importance: 3` and let it ride.

---

## Project structure

```
src/                  MCP server, DB layer, embeddings, graph traversal
hooks/src/            4 Claude Code hooks (SessionStart, UpdateContext, EvaluateSession, PreCompact) + 1 git hook (GitCommit)
hooks/lib/            Shared hook utilities (resolveProject, llmExtract)
hooks/bin/            run-hook.sh — bun resolver wrapper for stripped-PATH environments
hooks/hooks.json      Claude Code hook registrations (auto-wired on install)
commands/             4 slash commands
skills/               5 Claude Code skills
scripts/              install-wiring.ts, update-wiring.ts
graph-app/            Next.js memory graph visualizer (port 7332)
migrations/           SQL schema migrations
.claude-plugin/       Plugin manifest (plugin.json)
docs/                 This documentation
CLAUDE.md             Loaded by Claude — tool reference
CHANGELOG.md          Version history
```

---

## Where to go from here

- [Architecture](03-architecture.md) — C4 diagrams, ADRs, schema, migration path, the works
- [DB Spec](internal/DB-SPEC.md) — every table, every column, every index
- [Configuration](04-configuration.md) — knobs that control decay, injection, and embedding
- [Hooks](06-hooks.md) — what fires when
- [PRD](internal/PRD.md) — product vision and roadmap
