# PRD — OpenLTM Plugin (Long-Term Memory for AI coding agents)

**Version:** 1.0 (PRD baseline against plugin v1.9.0)
**Owner:** product-manager (dev-team)
**Status:** Draft for system-architect + ui-ux-designer hand-off
**Last updated:** 2026-04-28

---

## 1. Vision & Goals

### 1.1 Vision
Claude Code is excellent inside a single session and **amnesiac across sessions**. Every new
session re-discovers conventions, re-debates resolved decisions, and steps on the same
gotchas. The LTM plugin gives Claude — and the developer driving it — a **durable,
searchable, self-curating memory** that survives compaction, restarts, machine moves,
and project switches.

A **magnificent** LTM is one where:

- The developer **never types a fact twice**. The first time they explain "we use bun, not
  npm", or "RLS must be on before prod", it sticks for every future session in every
  project where it applies.
- Claude **opens a session already knowing** the project's goal, recent decisions, and
  active gotchas — without the user pasting a primer.
- Recall feels like talking to a teammate who has been on the project from day one:
  natural-language queries return the right past decision, with provenance.
- Stale knowledge **decays gracefully**. A decision from two years ago about a deleted
  module does not pollute today's session.
- Memory is **portable, inspectable, and exportable**. The developer owns their memory
  graph — no vendor lock-in, no cloud dependency for core function.
- Memory is **safe**: secrets are scrubbed before storage, and there is a clear path to
  redact, forget, and audit.

### 1.2 Goals (12-month horizon)

| # | Goal | How we know |
|---|------|-------------|
| G1 | Eliminate cross-session amnesia for active projects | 95%+ of sessions on an active project start with relevant context auto-injected |
| G2 | Make recall faster than re-derivation | Median `recall` round-trip < 200 ms; user reports "saved me from re-debating X" |
| G3 | Keep the developer in flow | Zero mandatory prompts; all LTM ops are background or 1-keystroke |
| G4 | Survive plugin updates and machine moves | DB at known path, JSON export, schema migrations versioned and idempotent |
| G5 | Be safe by default | No secret ever lands in the DB; redaction on write; scan command for retroactive cleanup |
| G6 | Be debuggable in 60 seconds | `/openltm:doctor` and `/openltm:health` give a complete plain-English status |

### 1.3 Non-vision (explicit)
- This is **not** a team-shared knowledge base (yet). Memory is per-developer-per-machine.
- This is **not** a replacement for git, code comments, or design docs. It captures the
  **reasoning behind** the code, not the code itself.
- This is **not** a model — it is a retrieval and curation layer over a local SQLite store.

---

## 2. User Personas

### P1 — Solo Developer ("Sam")
Builds side projects and contract work alone across 3-10 active repos. Switches projects
multiple times a day. Pain: re-explains tooling, conventions, and "why we built it this
way" every time they cd into a different directory. Wins by: project-aware context
injection at session start, low-friction `/openltm:memory learn` after a decision.

### P2 — Power User / Tooling Hacker ("Pat")
Curates their own Claude Code config (hooks, skills, plugins). Wants memory to
**compose** with other plugins, not fight them. Cares about: schema stability, MCP
contract, hook surface, the ability to query the DB directly. Wins by: documented
schema, exportable JSON, FTS5 + semantic search they can trust.

### P3 — Team Lead / Tech Lead ("Tara")
Drives a small product team (3-8 devs) where AI-assisted coding is the norm. Wants
team-wide consistency on conventions and security gotchas. Today she gets only
per-developer benefit; she wants **shared memory** for "we agreed to X" architectural
decisions. Wins by (future): export/import flows, signed memory bundles, project-scoped
shareable decision sets.

### P4 — Enterprise / Regulated Dev ("Ezra")
Works in an environment with secret-scanning, audit logs, and SOC2 controls. Will not
adopt anything that might silently store secrets, PII, or proprietary code in a sidecar
DB. Wins by: provable redaction, local-only storage, audit trail of writes, ability to
purge per-project or per-time-window.

### P5 — Onboarder / New Joiner ("Noor")
Just inherited a 5-year-old codebase. Wants to absorb tribal knowledge without reading
every PR. Wins by (future): `git learn` retroactive backfill — turn commit history into
seeded memories with importance and category.

---

## 3. Jobs to be Done

The cross-session JTBDs the LTM plugin solves:

| ID | When... | I want to... | So I can... |
|----|---------|--------------|-------------|
| J1 | I open a new Claude Code session in a project | Have my goal, recent decisions, and active gotchas already in context | Resume work without a 10-minute primer |
| J2 | I make an architectural choice | Capture it once, in 1 keystroke | Stop re-debating it next session |
| J3 | I am about to start a non-trivial task | Be told if we already solved this | Avoid re-doing or contradicting prior work |
| J4 | I get burned by a non-obvious gotcha | Save it as a permanent warning | Never get burned by it again, in any project |
| J5 | I switch from project A to project B | Have B's context auto-restored, A's context not bleed in | Work on the right thing with the right rules |
| J6 | A memory becomes wrong (refactor, pivot) | Forget or supersede it cleanly | Avoid acting on stale advice |
| J7 | I want to know what Claude "knows" about this project | See goals, decisions, progress, gotchas at a glance | Trust the system; spot drift |
| J8 | I onboard a new repo | Backfill memory from git history | Get instant institutional knowledge |
| J9 | I worry secrets crept in | Scan the DB and redact in place | Pass an audit; sleep at night |
| J10 | The plugin breaks (hook silent-fail, MCP missing) | Run one diagnostic and get a fix list | Not lose a day debugging meta-tooling |

---

## 4. Full Feature Inventory (v1.4.20)

### 4.1 MCP Tools (server: `src/mcp-server.ts`)

| Tool | Purpose |
|------|---------|
| `recall` | Search memories by natural-language query. FTS5 + semantic fallback. Filters: project, category, importance. Primary read path. |
| `learn` | Store a new memory. Required: text, category. Optional: importance, project, tags. Auto-redacts secrets on write. |
| `forget` | Soft-delete a memory by id. Used for stale or wrong memories. |
| `relate` | Create a typed edge between two memories (e.g., decision → gotcha). Powers the graph view. |
| `context` | Restore project state at session start: goal + decisions + recent progress + gotchas. |
| `context_items` | List specific context types (goal / decision / progress / gotcha) for a project. |
| `graph` | Traverse memory edges. Used by the visualization server and by Claude when tracing decision chains. |

### 4.2 Slash Commands (current grouped surface, v1.4.17+)

**Active grouped commands:**
| Command | Purpose |
|---------|---------|
| `/openltm:memory recall` | Search past decisions and memories. |
| `/openltm:memory learn [--save-context]` | Store insight; optional one-shot save-context. |
| `/openltm:memory forget <id>` | Remove a wrong/stale memory. |
| `/openltm:memory relate <src> <tgt> <type>` | Link two memories. |
| `/openltm:project init` | Seed a project goal. |
| `/openltm:project analyze` | Analyze project context before starting work. |
| `/openltm:project register` | Register a project in the LTM registry. |
| `/openltm:admin migrate [--legacy]` | Run schema migrations. |
| `/openltm:admin scan` | Scan all memories for secrets, redact in place. |
| `/openltm:admin server` | Start/stop/check the LTM Graph visualization server. |
| `/openltm:health` | Health scores + decay summary (single source of truth for status). |
| `/openltm:doctor` | Full diagnostic: hooks, MCP, DB, registry, schema. |

**Deprecated aliases (still functional, route to grouped equivalents):**
`/openltm:analyze-context`, `/openltm:learn`, `/openltm:decay-report`, `/openltm:capture`, `/openltm:doctor`
(legacy form), `/openltm:migrate`, `/openltm:hook-doctor`, `/openltm:migrate-db`, `/openltm:secrets-scan`,
`/openltm:recall`, `/openltm:ltm-server`.

### 4.3 Hooks

| Hook | Trigger | Job |
|------|---------|-----|
| `SessionStart` | Claude Code session opens | Resolve project from registry, regenerate `context-summary.md`, inject up to ~60 lines of context, inject importance-5 globals + top-15 project memories. |
| `PreCompact` | Before context compaction | Read DB for all 4 context types, write `context-summary.md` (~60 lines max) so post-compact session restores cleanly. |
| `EvaluateSession` | Session end / interval | Score the session; promote candidate insights for learning. |
| `UpdateContext` | Session end | Append progress entries (trimmed to last 20), update last-touched timestamps. |

### 4.4 Skills (`./skills/`)

| Skill | When |
|-------|------|
| `ContinuousLearning` | Reference for LTM memory commands, context hooks, DB schema. Loaded when user mentions learn/recall/forget/relate or session boundaries. |
| `Learned` | Reference for retrieved patterns and lessons from past sessions. |
| `session-context` | Session context persistence playbook (goals, decisions, progress, gotchas). |
| `GitLearn` | Retroactive Git commit learning — backfill memories from history. Trigger: "git learn", "review past commits", "backfill learnings". |

### 4.5 Storage & Registry

- **Database:** SQLite at `${CLAUDE_PLUGIN_DATA}/openltm.db` (resolved by Claude Code).
- **Schema:** `src/schema.sql`. Two main tables: `memories` (long-term, permanent) and
  `context_items` (short-term, project-scoped, auto-trimmed).
- **Registry:** `~/.claude/projects/registry.json` — maps cwd → project name. Auto-populated by `SessionStart`.
- **Cache mirror:** `~/.claude/plugins/cache/ltm/ltm/<version>/` — the plugin loader reads
  from cache, so hot-patch flow requires patching cache or bumping version.

### 4.6 Auxiliary Servers

- **MCP server** (`src/mcp-server.ts`) — primary tool surface, started by Claude Code per `mcpServers` in `plugin.json`.
- **Graph visualization server** (`src/graph-server.ts`) — opt-in localhost web UI for
  exploring memory graphs. Managed via `/openltm:admin server`.
- **Graph app** (`graph-app/`) — front-end for the visualization, has its own Playwright
  E2E test harness (`bun run test:e2e`).

### 4.7 Memory Categories
`preference` · `architecture` · `gotcha` · `pattern` · `workflow` · `constraint`
plus the **importance** scalar (1-5) used to gate global injection.

### 4.8 Context Item Types (project-scoped, short-term)
`goal` (1-3 lines, current objective) · `decision` (permanent) · `progress` (rolling, last 20) · `gotcha` (permanent).

---

## 5. User Stories with Acceptance Criteria

All ACs use Given/When/Then form. They are tight enough for **qa-tester** to automate
and for **system-architect** to design against.

### US-1 — Auto-restore project context at session start
**As** Sam, **I want** my project's goal, recent decisions, and gotchas restored when I open a session, **so that** I don't have to re-explain.

**Acceptance criteria:**
- **Given** a registered project with at least one `goal` and one `decision` in the DB,
  **when** Claude Code session starts in that project's cwd,
  **then** a `## Restored Project Context` block appears in the session, containing the goal, up to N decisions, up to N gotchas, and last 5 progress entries.
- **Given** the same project, **when** session starts, **then** importance-5 global memories are also injected.
- **Given** total restored context exceeds 60 lines, **when** injected, **then** it is truncated to ~60 lines with a "+N more — run /openltm:memory recall" footer.

### US-2 — Recall before deciding
**As** Pat, **I want** `recall` to surface prior decisions on a topic, **so that** I don't contradict past work.

**Acceptance criteria:**
- **Given** a memory exists with text "we use Bun, not npm", **when** I call `recall("javascript package manager")`, **then** that memory ranks in the top 3 results.
- **Given** the same DB, **when** the FTS5 query returns < 3 results, **then** semantic fallback runs and merges results, deduplicated by id.
- **Given** I pass `category: "gotcha"`, **when** I recall, **then** only gotchas are returned.
- **Given** a project filter, **when** I recall, **then** only memories tagged with that project (or no project) are returned.

### US-3 — Learn a decision in 1 keystroke
**As** Sam, **I want** to capture a decision without leaving flow, **so that** I actually do it.

**Acceptance criteria:**
- **Given** I have just made a decision, **when** I run `/openltm:memory learn "X because Y" --category architecture`, **then** the memory is persisted and an id is returned in under 200 ms.
- **Given** the text contains a string matching a known secret pattern (API key, JWT, AWS key), **when** stored, **then** the secret is redacted to `[REDACTED:type]` before write.
- **Given** I omit `--project`, **when** stored, **then** the current project (from registry) is auto-attached.

### US-4 — Save context and learn in one shot
**As** Sam at end of a productive segment, **I want** to capture both progress and a learning together.

**Acceptance criteria:**
- **Given** I run `/openltm:memory learn "<insight>" --save-context`, **when** it executes, **then** (a) the global memory is written, (b) a `progress` context item is appended for the current project, (c) `context-summary.md` is regenerated.

### US-5 — Decay stale memories gracefully
**As** Tara, **I want** old, never-recalled memories to fade, **so that** my recall results stay fresh.

**Acceptance criteria:**
- **Given** a memory has not been recalled in 90 days and has importance < 3, **when** decay scoring runs, **then** its rank score is multiplied by a decay factor < 1.
- **Given** importance == 5, **when** decay scoring runs, **then** the score is **not** decayed.
- **Given** I run `/openltm:health`, **when** it executes, **then** it reports: total memories, count by category, count by decay bucket (fresh / aging / stale), and top-5 staleness candidates with ids.

### US-6 — Forget a wrong memory
**As** Pat after a refactor, **I want** to delete a memory that's now wrong.

**Acceptance criteria:**
- **Given** memory id `m_123` exists, **when** I run `/openltm:memory forget m_123`, **then** it is soft-deleted (not returned by recall) and audit row is recorded.
- **Given** a soft-deleted memory, **when** I run `/openltm:memory recall` for its text, **then** it does not appear in results.

### US-7 — Relate two memories
**As** Pat tracing a chain of cause-and-effect, **I want** to link a decision to a gotcha that resulted from it.

**Acceptance criteria:**
- **Given** memories `m_dec` and `m_got` exist, **when** I run `/openltm:memory relate m_dec m_got "caused"`, **then** an edge `(m_dec, m_got, "caused")` is stored.
- **Given** that edge exists, **when** I view the graph UI, **then** the two nodes appear connected with the edge label.

### US-8 — Health check at a glance
**As** Tara at start of week, **I want** one command that tells me memory health.

**Acceptance criteria:**
- **Given** any state, **when** I run `/openltm:health`, **then** I see: per-project health score (0-100), DB size, total memories, decay summary, last-write timestamp, MCP reachability.
- **Given** any of these signals is unhealthy, **when** displayed, **then** the line is marked with a clear status indicator and a one-line remedy.

### US-9 — Diagnose the plugin in 60s
**As** Pat after a Claude Code update, **I want** to confirm hooks and MCP still work.

**Acceptance criteria:**
- **Given** I run `/openltm:doctor`, **when** it executes, **then** it checks: MCP server reachable, all 4 hooks registered in `settings.json`, DB exists and is writable, schema version current, registry parseable.
- **Given** any check fails, **when** displayed, **then** the failure includes an exact suggested fix command.

### US-10 — Migrate the schema safely
**As** Pat after pulling a new plugin version, **I want** a safe schema upgrade path.

**Acceptance criteria:**
- **Given** the DB schema is at version N and the plugin expects N+1, **when** I run `/openltm:admin migrate`, **then** all pending migrations apply in a single transaction and the schema_version row updates.
- **Given** a migration fails, **when** detected, **then** the transaction rolls back and a backup file is written next to `openltm.db`.
- **Given** `--legacy` flag, **when** run, **then** the migrator detects and moves a legacy openltm.db from the pre-1.4 path into `${CLAUDE_PLUGIN_DATA}/`.

### US-11 — Scan and redact secrets
**As** Ezra before an audit, **I want** to scan all memories for secrets.

**Acceptance criteria:**
- **Given** memories exist with embedded secrets, **when** I run `/openltm:admin scan`, **then** each match is reported with memory id, secret type, and offset.
- **Given** I confirm redaction, **when** applied, **then** the secret substring is replaced with `[REDACTED:type]` in place and an audit row recorded.
- **Given** dry-run mode (default), **when** run, **then** no writes occur.

### US-12 — Multi-project isolation
**As** Sam jumping between projects, **I want** project A's memories to not bleed into project B.

**Acceptance criteria:**
- **Given** project A and B are both registered, **when** I open a session in B's cwd, **then** the injected context contains only B's `context_items` plus globals.
- **Given** an `recall` call without a `project` filter from inside B, **when** ranking, **then** B's memories are boosted vs. A's.
- **Given** I move a project to a new path, **when** I run `/openltm:project register`, **then** registry updates and existing memories remain associated.

### US-13 — Initialize a project goal
**As** Sam starting a new repo, **I want** to seed the goal Claude sees on every session start.

**Acceptance criteria:**
- **Given** I run `/openltm:project init`, **when** it executes, **then** it prompts (or accepts arg) for a 1-3 line goal and stores it as the current `goal` context item.
- **Given** a `goal` already exists, **when** init runs, **then** the prior goal is preserved as a decision (audit trail) and replaced.

### US-14 — Backfill memories from git history
**As** Noor onboarding an old repo, **I want** Claude to learn from past commits.

**Acceptance criteria:**
- **Given** a repo with N commits, **when** I run the GitLearn skill flow ("git learn"), **then** it analyzes commit messages and diffs, proposes candidate memories with category + importance + text.
- **Given** the proposals, **when** I confirm a subset, **then** only the confirmed ones are written, each tagged `source: git-backfill` and linked to the commit SHA.
- **Given** I re-run on the same repo, **when** it processes already-backfilled SHAs, **then** they are skipped (idempotent).

### US-15 — Promote a project gotcha to global LTM
**As** Pat after the same gotcha bites in two projects, **I want** to promote it to global with importance 5.

**Acceptance criteria:**
- **Given** a project-scoped `gotcha` context item, **when** I run `/openltm:memory learn "<text>" --category gotcha --importance 5`, **then** it lands in the global `memories` table.
- **Given** importance 5, **when** any future SessionStart fires, **then** this memory is in the global injection regardless of project.

### US-16 — Visualize the memory graph
**As** Pat exploring decision chains, **I want** a browser-based graph view.

**Acceptance criteria:**
- **Given** I run `/openltm:admin server start`, **when** it executes, **then** a localhost server boots on a known port and I can open it in a browser.
- **Given** memories with relations exist, **when** I open the UI, **then** I see nodes (memories) and edges (relations) with category-based coloring.
- **Given** I stop the server with `/openltm:admin server stop`, **when** done, **then** the port is released.

### US-17 — Survive plugin upgrade
**As** Sam clicking "Update now" in the plugin marketplace, **I want** my memories preserved.

**Acceptance criteria:**
- **Given** `openltm.db` exists and is at schema vN, **when** the plugin updates to a version expecting vN+1, **then** the next session auto-runs the migration (or prompts) without data loss.
- **Given** the cache path moves between versions, **when** the new version starts, **then** `LTM_DB_PATH` resolves to the same on-disk file (via `${CLAUDE_PLUGIN_DATA}`).

---

## 6. Gaps & Opportunities (Roadmap candidates)

Bold ideas to make the LTM "magnificent". These are not committed; they are the
opportunity space for system-architect and ui-ux-designer to evaluate.

### G-A — Team-shared memory bundles
Export a project's decisions + gotchas as a signed JSON bundle. Teammates import to
seed their own LTM. Solves Tara's persona. **Risk:** trust (signature verification),
conflict resolution on import. **Why magnificent:** team-wide convergence on convention.

### G-B — Memory diffing across versions
Show how a project's understanding changed between two timestamps. "What did we
believe two months ago vs. today?" Powers retrospectives and onboarding. **Why
magnificent:** memory becomes a first-class historical artifact, not just a cache.

### G-C — Auto-categorization on `learn`
Today the user picks `--category`. Use a lightweight classifier (heuristic or model
call) to suggest category and importance. **Why magnificent:** drops the friction of
`learn` to truly 1 keystroke.

### G-D — Negative memories ("we tried X, it failed because Y")
Explicit failure-mode category, surfaced when a recall would otherwise suggest the
failed approach. **Why magnificent:** turns the LTM into a cumulative anti-pattern
catalog, not just a positive-pattern one.

### G-E — Project-scoped semantic embeddings
Today recall is FTS5 + semantic fallback at the global level. A per-project embedding
index would tighten relevance and speed. **Why magnificent:** recall feels like
"someone who only thinks about this project".

### G-F — Conflict detection on learn
When a new memory contradicts an existing one (similarity high, polarity opposite),
flag it and ask the user to forget, supersede, or coexist. **Why magnificent:** the
LTM curates itself; drift cannot accumulate silently.

### G-G — `memory replay` mode
Boot a session with the LTM as it was on a chosen date. Useful for "what did we know
when we made this decision?" debugging. **Why magnificent:** memory becomes
time-traversable.

### G-H — Hook for `pre-commit` "did you learn this?"
After a non-trivial commit, the plugin prompts: "Capture the reasoning behind this
commit?" with a draft auto-pulled from diff + message. **Why magnificent:** captures
the "why" that comments and PR descriptions usually lose.

### G-I — Privacy-safe cloud sync (opt-in)
End-to-end encrypted sync of memories across the developer's own machines (no
multi-tenant cloud, no team-shared yet). Solves "I just got a new laptop". **Why
magnificent:** memory is portable across hardware, not just project switches.

### G-J — Per-memory provenance chain
Every memory links back to its source: file + line, commit SHA, conversation turn.
Powers trust and audit. **Why magnificent:** "where does Claude get this idea?" is
always answerable.

### G-K — Recall result explainer
For each result, a one-line "why this ranked here" (FTS hit, semantic similarity,
recency boost, importance boost). Powers debuggability of bad recalls. **Why
magnificent:** the user can teach the system by adjusting importance instead of
debugging in the dark.

### G-L — Memory budget + compression
When DB grows past a threshold, summarize clusters of related decisions into a
single rolled-up memory, archive originals. **Why magnificent:** memory grows
sub-linearly with project age.

### G-M — Cross-plugin memory contract
Publish a stable read-API so other plugins (e.g., dev-team task-tracker, code-review)
can write into LTM with proper category and source tag. **Why magnificent:** LTM
becomes the substrate for the whole Claude Code ecosystem, not a silo.

### G-N — Magnificent UI: graph-app v2
The current graph-app exists but is utilitarian. v2: timeline scrubber, search
overlay, force-directed clustering by category, click-through to invoking session.
**Owned by:** ui-ux-designer.

### G-O — Onboarding wizard
First-run flow: detect projects in a chosen dir, prompt to register, run GitLearn
backfill, surface first 5 candidate memories for confirmation. **Why magnificent:**
new users get value in the first 5 minutes, not the first month.

---

## 7. Non-Goals

The plugin will not, in this PRD horizon:

- **N1.** Send memories to any third-party cloud by default.
- **N2.** Replace ADRs, design docs, code comments, or commit messages.
- **N3.** Operate as a multi-tenant team-shared store. (G-A explores a bundle export
  flow, but the live store is per-developer-per-machine.)
- **N4.** Run a model locally for embeddings — embeddings either come from Claude's
  own tools or a deterministic fallback. No bundled ML runtime.
- **N5.** Modify source code automatically based on memory contents.
- **N6.** Capture or store full conversation transcripts. The LTM is for **distilled**
  insights, not raw history.
- **N7.** Provide guarantees around hostile inputs (malicious memory poisoning) beyond
  basic redaction. Threat model is single-developer, locally trusted environment.
- **N8.** Replace the `task-tracker` MCP, the `context-mode` MCP, or any other plugin's
  responsibility. LTM is one slice of the stack.

---

## 8. Success Metrics

Leading indicators (engagement / activation) come first; lagging indicators (durable
value) follow.

### 8.1 Activation
- **A1.** % of installed users who have ≥ 1 memory after 7 days. Target: > 70%.
- **A2.** % of installed users who run `/openltm:project init` within 7 days. Target: > 50%.
- **A3.** Median time from install to first `learn` call. Target: < 24h.

### 8.2 Engagement
- **E1.** `recall` calls per active session. Target: ≥ 3.
- **E2.** `learn` calls per active session. Target: ≥ 1.
- **E3.** % of sessions where SessionStart hook successfully injects context. Target: > 95%.

### 8.3 Quality
- **Q1.** Median `recall` round-trip latency. Target: < 200 ms.
- **Q2.** % of recalls where the user used a top-3 result (proxied by next-action
  alignment). Target: > 60%.
- **Q3.** Decay accuracy: % of memories the user `forget`s that were already flagged
  stale by the decay scorer. Target: > 40%.
- **Q4.** Secret-leak rate: 0. (Any non-zero is a P0 incident.)

### 8.4 Reliability
- **R1.** `/openltm:doctor` clean-pass rate across user installs. Target: > 95%.
- **R2.** Schema migration success rate (no rollback, no data loss). Target: 100%.
- **R3.** Mean DB write latency. Target: < 50 ms p95.

### 8.5 Durable value (lagging)
- **D1.** Self-reported "saved me from re-deciding" count per developer per month.
  Captured via opt-in survey or `/openltm:health` self-rating prompt. Target: ≥ 4.
- **D2.** Ratio of `recall` calls that surface a memory ≥ 30 days old. Target: > 30%.
  (Indicates LTM is doing long-memory work, not just session caching.)
- **D3.** Cross-project memory reuse rate: % of importance-5 globals injected into
  ≥ 2 distinct projects per month. Target: > 50%.

---

## 9. Open Questions

These need resolution before architecture is finalized — flagged for buddy / user.

- **OQ1.** Embedding strategy: deterministic local hashing, Claude tool call, or a
  small bundled model? Affects portability and latency.
- **OQ2.** Concurrency model: how do we serialize writes when multiple Claude Code
  instances run against the same `openltm.db`? SQLite WAL is likely sufficient but
  needs explicit decision.
- **OQ3.** Decay function: linear, exponential, or recall-driven? Needs a small
  experiment with real recall logs.
- **OQ4.** Should `EvaluateSession` be allowed to auto-write memories without user
  confirmation, or always propose? Trust vs. friction trade-off.
- **OQ5.** Is the graph-app worth maintaining, or should the visualization move into
  a Claude Code-native panel via a future plugin UI surface?

---

## 10. Hand-off

This PRD unblocks two parallel agents:

- **system-architect** — design the storage schema evolution, MCP contract surface,
  hook lifecycle, and migration path required by US-1 through US-17 and the open
  questions in §9.
- **ui-ux-designer** — design the surfaces users actually touch: `/openltm:health` and
  `/openltm:doctor` output formatting, the graph-app v2 (G-N), and the onboarding
  wizard (G-O).

Both agents should treat §4 (Feature Inventory) as the as-built ground truth and §5
(User Stories) as the contract. §6 (Gaps) is opportunity space, not commitment.
