# How It Works

The one-page tour. The [Architecture](03-architecture.md) doc is the 1000-line deep-dive; this is the 30-second version that gets you oriented before you read it.

---

## The shape of memory

```
+---------------------------------------------------------------+
|                        Claude Code                            |
|                                                               |
|  +-------------------+  +-----------+  +------------------+   |
|  | 7 Commands        |  | 4 Skills  |  | 7 Claude Code    |   |
|  | /openltm:memory   |  | Ltm       |  |    hooks         |   |
|  | /openltm:project  |  | Memory-   |  | SessionStart     |   |
|  | /openltm:health   |  |   Review  |  | UserPromptSubmit |   |
|  | /openltm:server   |  | GitLearn  |  | PostToolUse      |   |
|  | /openltm:admin …  |  | Spec      |  | Stop, SessionEnd |   |
|  |                   |  |           |  | PreCompact       |   |
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
| **Session Start** | `SessionStart` injects project context (goals, decisions, gotchas) + a compact LTM index (id + title) of global and project memories |
| **Each prompt** | `UserPromptSubmit` adds a few memories relevant to the prompt. `PostToolUse` flags memories stale when Claude commits files they reference. |
| **During Work** | Use `/openltm:memory recall` before tasks, `/openltm:memory learn` after discoveries. MCP tools called automatically. |
| **Every turn (Stop)** | `UpdateContext` updates this session's single progress line. |
| **Session End** | `EvaluateSession` writes a session summary and queues memory proposals for review; the janitor runs if due. |
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

## Code-anchored invalidation

Decay keys off *recall behaviour* — it can't see the most dangerous memory: one
that is still actively recalled **and** silently stale (e.g. an assumption about an
auth layer you just refactored). Recency-decay won't sink it because it keeps getting
hit, and nothing tells the agent to `forget` it.

So invalidation can be driven by *code change* instead. When you store a memory you may
anchor it to the files it references (`learn`'s optional `files` param → `memory_files`
table). The git post-commit hook already knows which files a commit touched; when
`gitInvalidateEnabled` is on (default), a commit touching an anchored file **flags those
memories stale** (`importance: 5` is exempt). Nothing is deleted — the flag is auditable.

A stale memory is **downranked in `recall`** (still returned, marked `stale`) and becomes
**decay-eligible regardless of recall frequency**, so the high-traffic-but-stale memory can
finally sink. Clear the flag by re-confirming the memory (`learn` the same content) or with
the `revalidate` tool; use `forget` when it's genuinely wrong.

---

## SQLite extensions

OpenLTM loads optional SQLite extensions to accelerate recall and enable background work:

| Extension | What it does | Availability |
|-----------|-------------|--------------|
| **sqlite-vec** (vec0 / KNN) | Vector similarity search for semantic recall. When available, the recall engine's semantic fallback uses real KNN instead of JS-cosine. | Any platform where a system extension-enabled libsqlite3 is found (Homebrew `/opt/homebrew/opt/sqlite` on macOS, system `libsqlite3.so` on Linux). |
| **Honker** (libhonker_ext) | Durable async embedding queue (claim/embed/ack, retry, dead-letter), leader-elected janitor cron (@every 6h), and pub-sub push liveness for the graph app. | Binaries vendored per-platform; currently darwin-arm64 only. Other platforms degrade to inline embed, file-watch poll, and in-process janitor. |

Both load via `Database.setCustomSQLite()` + `loadExtension()` and degrade gracefully — a missing binary or library leaves the capability `false` with zero fallout. Controlled by env vars `LTM_DISABLE_VEC`, `LTM_DISABLE_HONKER` (force-disable) and `LTM_SQLITE_LIB`, `LTM_HONKER_EXT` (path override).

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

## Capability map

What each feature does and where its code lives (paths relative to the repository root).

| Capability | What it actually does | Where it lives |
|---|---|---|
| Recall | Hybrid: full-text (FTS5) and vector results fused with Reciprocal Rank Fusion, filtered by project, status and privacy — search by meaning, not exact words | `packages/openltm-core/src/db.ts:981` · `packages/openltm-core/src/vec/` |
| Learn | Stores a memory with category, importance, and confidence; secrets are scrubbed on every write | `packages/openltm-core/src/db.ts:691` |
| Inject | At session start, the project's goal/decisions/gotchas/progress and a compact `- [id] title` index of top memories | `hooks/src/SessionStart.ts:72` |
| Prompt recall | Adds up to 5 memories relevant to each prompt you type, never the same one twice in a session | `hooks/lib/promptRecall.ts:146` |
| Stale flags | A commit through Claude flags the memories anchored to the files it touched | `packages/openltm-core/src/db.ts:411` |
| Privacy | Memories tagged `private` never leave the machine or reach the model unasked; egress is secret-scrubbed | `packages/openltm-core/src/secretsScrubber.ts` · `packages/openltm-core/src/privacy.ts` |
| Decay | Ages memories by importance × confidence; `importance: 5` is permanent | `packages/openltm-core/src/janitor/decay.ts` |
| Graph | Traverses relations between memories and builds a reasoning chain | `packages/openltm-core/src/graph.ts:71` |
| Visualize | A browser explorer over the live database, with janitor controls | `src/graph-server.ts` · `graph-app/` |
| Extensions | sqlite-vec and Honker loaded from disk, with a working fallback when absent | `packages/openltm-core/src/extensions.ts:160` |
| Deduplicate | Queues near-duplicate pairs as pending suggestions; nothing merges until you approve | `packages/openltm-core/src/janitor/dedup.ts` |
| Time-aware recall | `occurred_at` on learn, `as_of` point-in-time recall, recency / "list all" intent detection, and an adaptive cutoff that drops weak tail hits | `packages/openltm-core/src/recall/intent.ts` · `packages/openltm-core/src/recall/adaptive.ts` |
| Supersede | A new memory `updates`, `retracts` or `extends` an old one; an agent can't retire something the owner said | `packages/openltm-core/src/db.ts` · `packages/openltm-core/src/janitor/supersedes.ts` |
| Collections | Agent-defined typed records (hosts, releases, endpoints) next to prose memories; `ltm facts extract` fills a `facts` collection from prose | `packages/openltm-core/src/collections/` · `packages/openltm-core/src/facts.ts` |
| PII masking | Emails, phones, card numbers, SSNs and IPs become placeholders before text reaches an LLM or embedding provider (`LTM_MASK_PII`) | `packages/openltm-core/src/pii.ts` |
| Doctor | `ltm doctor [--fix]` checks SQLite, FTS and vector-index integrity and repairs after a backup | `packages/openltm-core/src/integrity.ts` |
| Capsules | `ltm export` / `ltm import` move a project's memory as one checksummed, optionally encrypted file | `packages/openltm-core/src/capsule.ts` |

## Where to go from here

- [Architecture](03-architecture.md) — C4 diagrams, ADRs, schema, migration path, the works
- [DB Spec](internal/DB-SPEC.md) — every table, every column, every index
- [Configuration](04-configuration.md) — knobs that control decay, injection, and embedding
- [Hooks](06-hooks.md) — what fires when
- [PRD](internal/PRD.md) — product vision and roadmap

## Privacy tag

Tag a memory `private` to keep it out of default recall and SessionStart. **private ≠ encrypted** — SQLite still stores plaintext; this is a visibility filter, not encryption.
