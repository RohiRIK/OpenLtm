# ROADMAP — OpenLTM Plugin

> **Master integration spec.** Synthesises `PRD.md`, `ARCHITECTURE.md`, `UX-SPEC.md` into a single phased plan. `DB-SPEC.md` augments §6 (Schema) and per-phase DB work once written.
>
> Source documents — keep authoritative:
> - `docs/internal/PRD.md` — what & why (vision, personas, JTBDs, US-1..17, gaps G-A..G-O)
> - `docs/03-architecture.md` — system shape (C4, ADR-001..006, weaknesses W1..W12, capabilities C1..C10)
> - `docs/internal/UX-SPEC.md` — user-facing surface (interaction model, hooks, surfaces S1..S5)
> - `docs/internal/DB-SPEC.md` — schema (pending; section 6 + per-phase DB rows updated when ready)

---

## 1. Executive Summary

**Where we are (v2.16.x):** Phases 0–4 have shipped, and the plugin has outgrown "a Claude Code plugin":

- **Foundation (Phase 0):** a versioned migration runner with a fail-closed DDL gate, propose-only session evaluation, and the `/openltm:onboard` wizard.
- **Observability (Phase 1):** structured JSONL hook events feeding `/openltm:health`, and DAO-backed slim recall rows (embeddings split out of the hot path).
- **Trust (Phase 2):** a provenance chain and an append-only `memory_audit` log, queryable through `/openltm:admin audit` and the `admin_audit` MCP tool.
- **Recall (Phase 3):** pluggable embedding providers (local llama.cpp by default since 2.16; Gemini, OpenAI, and Ollama opt-in), sqlite-vec KNN, auto-categorisation, and a recall explainer.
- **Janitor (Phase 4):** materialised `decay_score`, a leader-elected janitor, and an archive table for evicted memories.

Beyond the original plan: code-anchored memories with stale flagging and `revalidate` (2.10), recall v2 ranking and one shared session prefill (2.13), and **one engine for five hosts**. `@rohirik/openltm-core` runs the MCP server (`mcp-serve`) and a headless CLI, and adapters ship for Claude Code, OpenCode, Pi, OpenClaw (ClawHub), and Hermes. All npm and ClawHub releases publish tokenless through OIDC.

**Honest gaps going into 2.17:**
- The graph server listens beyond loopback and returns provider secrets unmasked.
- The Stop hook does session-end work on every turn.
- Memories reach the model only at session start, never per prompt.
- Stale flagging needs the opt-in git hook.
- The MCP surface cannot write project context or review proposals.
- Recall falls back from FTS to semantic search instead of fusing the two.
- Seven overlapping skills compete for triggers.
- Project identity differs per adapter, and plugin state lives under `~/.claude/projects`.

**Where we want to be:** A magnificent LTM that is invisible when it should be, surgical when invoked, trustable for teams and enterprise, and pluggable for embeddings, sync, bundles, and cross-plugin contracts.

**The plan:** Phases 0–4 (non-breaking foundation) are done. The [2.17 hardening release](#217--hardening--recall-everywhere-in-progress) closes the gaps above. Phase 5 is half done: the shared core and its adapters exist, but the versioned capability-discovery contract does not. Phases 6–7 (sync, bundles, time travel) remain planned.

---

## 2. Unified Work Inventory

The four source docs catalogue overlapping concerns from different angles. This table maps every issue/feature to its owners across docs.

| Theme | PRD gap | Arch weakness | Arch capability | UX surface | DB impact |
|---|---|---|---|---|---|
| Migration framework | — | W3 | (Phase 0) | §6.3 errors | TBD §5 |
| Recall scoring at scale | — | W4 | C8 explainer | §8.3 S2 | TBD §4 (decay_score) |
| Embedding-based recall | G-E | (impl in C1) | C1 | §8.3 S2 | TBD §7 (memory_embeddings) |
| Provenance | G-J | W9 | C5 | §8.4 S3 review | TBD §7 (memory_audit) |
| Audit trail | — | W11 | C5 | §6 errors | TBD §7 (memory_audit) |
| Observability | — | W5 | (Phase 1) | §3 hook map, §6.5 silent-fail | — |
| MCP response bloat | — | W7 | (Phase 1 DAO) | §2.1 recall latency | TBD §7 (split embeddings) |
| Hook failure visibility | — | W1 | (Phase 1) | §3 hook UX, §6.1 | — |
| Concurrent writes | — | W2, W12 | (Phase 0) | §6.4 lifecycle | TBD §6 (locking) |
| Cache vs source dual-write | — | W6 | (Phase 5) | §6.4 lifecycle | — |
| Hook ↔ schema coupling | — | W8 | (Phase 1 DAO) | — | — |
| EvaluateSession policy | — | W10 | (Phase 0) | §3.3 (propose-not-write) | — |
| Auto-categorisation | G-C | — | (Phase 3) | §8.2 ambient | — |
| Negative memories | G-D | — | C4 conflict | §8.3 S2 | TBD §7 (conflict tables) |
| Conflict detection | G-F | — | C4 | §8.3 S2 conflict modal | TBD §7 |
| Memory diffing | G-B | — | C10 | §8.4 S3 review | — |
| Replay mode | G-G | — | C9 | §8.4 S3 | TBD §9 (time-travel) |
| Pre-commit "did you learn this?" | G-H | — | (Phase 6) | §8 ambient | — |
| Cloud sync (E2E) | G-I | — | C2 | §8.6 S4 team | TBD §7 (sync tables) |
| Memory budget / compression | G-L | — | C6 | §8.8 defaults | TBD §8 scale |
| Cross-plugin contract | G-M | — | C7 | §8.7 surfaces | TBD §9 (versioning) |
| Team bundles | G-A | — | C3 | §8.6 S4 | TBD §7 (team_bundles) |
| Graph-app v2 | G-N | — | (Phase 6) | §8.7 inventory | — |
| Onboarding wizard | G-O | — | (Phase 0) | §5, §8.5 | — |
| Cognitive load reduction | — | — | — | §9 (40→17 concepts) | — |

---

## 3. The 8-Phase Roadmap

Each phase aligns with `ARCHITECTURE.md §9`. Versions are guidance; ship cadence is per-phase, not per-feature.

### Phase 0 — Foundation Hardening (v1.5.x, non-breaking)

> **Status: shipped.** Versioned migrations (fail-closed runner since 2.12), propose-only EvaluateSession, `/openltm:onboard` wizard, `BEGIN IMMEDIATE` + WAL write discipline.

**Goal:** Stop the bleeding. Fix the things that silently lose data or fail without telling anyone.

| Source | Item |
|---|---|
| Arch | W1 surface hook errors to user (panel + log path) |
| Arch | W2 advisory lock around `registry.json` writes |
| Arch | W3 `migration_history` table + versioned migration files (replaces hand-rolled ALTERs) |
| Arch | W10 Lock down `EvaluateSession` policy: **propose, do not auto-write** (resolves UX-SPEC §3.3) |
| Arch | W12 Single-process write coordinator (mutex / write queue) |
| UX | §6.5 Silent-failure audit — every catch block emits a visible result |
| UX | §3.1 SessionStart panel: explicit "context restored / not restored" line |
| PRD | G-O onboarding wizard v1 (terminal walkthrough, 5 steps) |

**Exit criteria:** zero silent hook failures in 1 week of dogfooding · migration history table is the source of truth · EvaluateSession never writes without a confirmation step.

---

### Phase 1 — DAO + Observability (v1.6.x, non-breaking)

> **Status: shipped.** `ltm.jsonl` structured events, `/openltm:health` activity + janitor sections, DAO layer with slim recall rows.

**Goal:** Make the system inspectable. Decouple hooks from raw SQL.

| Source | Item |
|---|---|
| Arch | W5 Structured logs (JSONL) + log-rotation; `/openltm:health` reads from it |
| Arch | W7 DAO returns slim recall rows (drop embeddings unless requested) |
| Arch | W8 Hooks call DAO, never raw SQL; schema changes don't ripple to hooks |
| UX | §3 hook map — every hook publishes a structured event consumable by `/openltm:health` |
| UX | §2.4 `/openltm:health` becomes the single source of truth (consumes Phase 1 events) |

**Exit criteria:** schema can change without touching hooks · `/openltm:health` shows real activity counts from logs · MCP recall response < 50ms p95 at 10k memories.

---

### Phase 2 — Provenance + Audit (v1.7.x, non-breaking)

> **Status: shipped.** `memory_provenance` + `memory_audit`, `/openltm:admin audit`, `admin_audit` MCP tool, `includeProvenance` on recall.

**Goal:** Every memory is traceable. Every write is auditable.

| Source | Item |
|---|---|
| Arch | W9 + C5 Provenance chain on every memory (source: `learn` / `git-learn` / `evaluate-session` / `import-bundle`) |
| Arch | W11 + C5 `memory_audit` table — every insert/update/delete recorded with actor, hook, session-id |
| PRD | G-J per-memory provenance chain (PRD-side requirement satisfied) |
| UX | §8.4 S3 Memory Review UI — show provenance per memory |
| DB | `memory_audit` schema (pending DB-SPEC §7) |

**Exit criteria:** every memory has `source` + `created_by` populated · audit table is query-able from `/openltm:admin audit` · UX-SPEC §8.4 S3 can render provenance.

---

### Phase 3 — Embedding Provider Abstraction (v1.8.x, non-breaking)

> **Status: shipped.** Provider interface (llama.cpp default since 2.16; Gemini / OpenAI / Ollama opt-in), `memory_embeddings` split, sqlite-vec KNN (2.9), auto-categoriser, recall explainer.

**Goal:** FTS5 stays. Embeddings become pluggable, not bundled.

| Source | Item |
|---|---|
| Arch | C1 Pluggable embedding provider interface (Gemini / OpenAI / Ollama / disabled) |
| PRD | G-E project-scoped semantic embeddings (provider configurable) |
| PRD | G-C auto-categorisation on `learn` (uses embedding provider when enabled) |
| Arch | C8 Recall result explainer — show why each result ranked where it did |
| UX | §8.3 S2 Smart recall surfacing — uses C1 + C8 |
| DB | `memory_embeddings` table split (pending DB-SPEC §7) |

**Exit criteria:** plugin works fully without any embedding provider · with provider, recall latency stays < 200ms p95 · explainer shows score breakdown.

---

### Phase 4 — Janitor (v1.9.x, non-breaking)

> **Status: shipped.** Materialised `decay_score`, `memory_archive`, leader-elected janitor cron (2.9), WAL checkpoint + `ANALYZE` per pass.

**Goal:** The plugin curates itself. Decay, compression, cleanup happen as background work.

| Source | Item |
|---|---|
| Arch | W4 Materialise `decay_score` on memories; janitor refreshes nightly |
| Arch | C6 Memory compression / rollups (low-importance + low-recall → archive table) |
| PRD | G-L memory budget + compression |
| UX | §8.8 magnificent defaults — janitor enabled by default |
| DB | `decay_score` column + janitor job spec (pending DB-SPEC §4, §8) |

**Exit criteria:** recall scoring is O(top-k log N) not O(N) · DB size growth flattens at scale · janitor logs visible in `/openltm:health`.

---

### 2.17 — Hardening & recall everywhere (in progress)

**Goal:** Close the gaps the 2.16 audit found. Make memory safe to expose, present on every prompt, and cheap to curate, with one project identity across hosts.

| Area | Item |
|---|---|
| Security | Graph server binds loopback only, rejects cross-origin requests, and masks provider secrets in settings and config responses. |
| Hook lifecycle | Session-end work moves from `Stop` to `SessionEnd`. `Stop` only records per-session `progress`. |
| Recall everywhere | `UserPromptSubmit` recalls a few prompt-relevant memories and injects them (small, capped, de-duplicated against the SessionStart block). |
| Freshness | `PostToolUse` on a Bash `git commit` flags memories anchored to the committed files as stale. No opt-in git hook required. |
| MCP surface | New `context_add` and `proposals` (list / accept / reject) tools, tool annotations (read-only / destructive hints), and `project` defaulting to the current project on `context`, `context_items`, and `context_add`. |
| Ranking | Hybrid recall fuses FTS5 and vector results with reciprocal-rank fusion (RRF) instead of a semantic fallback. |
| Skills | Seven overlapping skills consolidated into `Ltm` (contract plus reference files), `MemoryReview` (new curation pass), `GitLearn`, and `Spec`. The graph server skill becomes `/openltm:server`, and the planner agent becomes `ltm-planner` with read-only memory tools. |
| Project identity | One project-identity resolver shared by every adapter. OpenLTM state (registry, snapshots, session logs) moves out of `~/.claude/projects` into the plugin data directory. |

**Exit criteria:**
- `curl` from another host cannot reach `:7331`.
- No secret appears in any graph-server response.
- A prompt about a known topic gets its memories injected without a manual `recall`.
- A commit touching an anchored file flags its memory stale, and `MemoryReview` can clear it.
- The same repository resolves to the same project name in Claude Code, OpenCode, and Pi.

---

### Phase 5 — Cross-Plugin Contract (v2.0.0, semver-major)

> **Status: partial.** The shared engine (`@rohirik/openltm-core` with `mcp-serve` and a headless CLI) and the OpenCode, Pi, OpenClaw, and Hermes adapters have shipped. The versioned contract with capability discovery, and the `MIGRATION.md` for it, are still open.

**Goal:** LTM becomes a contract. Other plugins read/write memories through a versioned interface.

| Source | Item |
|---|---|
| Arch | C7 Cross-plugin memory contract (versioned MCP API + capability discovery) |
| PRD | G-M cross-plugin memory contract |
| Arch | W6 Resolve cache vs source-repo dual-write (single execution model) |
| UX | §9 cognitive load reduction — drop the `:memory:` subnamespace, consolidate to ~17 concepts |
| UX | §7.3 sunset timeline — deprecated aliases removed at 2.0.0 |

**Exit criteria:** another plugin can recall+learn through the contract without coupling · breaking changes documented in MIGRATION.md · all UX-SPEC §7 deprecations sunset.

---

### Phase 6 — Sync + Bundles (v2.1.x, non-breaking on contract)

> **Status: planned.** The graph-app v2 redesign (2.4–2.7) has landed. Conflict detection exists only as opt-in `autoRelate`, which can link a new memory as `contradicts`; the conflict tables and conflict modal are still open. Sync and bundles have not started.

**Goal:** Multi-device. Team-shareable.

| Source | Item |
|---|---|
| Arch | C2 Multi-device E2E encrypted sync |
| Arch | C3 Team memory bundles (signed export/import) |
| Arch | C4 Conflict detection on learn |
| PRD | G-A team-shared memory bundles |
| PRD | G-F conflict detection on learn |
| PRD | G-I privacy-safe cloud sync (opt-in) |
| PRD | G-D negative memories ("we tried X, it failed because Y") |
| PRD | G-H pre-commit "did you learn this?" hook |
| UX | §8.6 S4 team handoff |
| PRD | G-N graph-app v2 |
| DB | sync tables, team_bundles, conflict tables (pending DB-SPEC §7) |

**Exit criteria:** two devices stay in sync · a team can import a signed bundle and reject it on signature mismatch · conflict modal renders on duplicate learn.

---

### Phase 7 — Time-Travel + Diffing (v2.2.x, non-breaking)

> **Status: planned.** `memory_archive` (Phase 4) is the first building block for replay.

**Goal:** Memory becomes history. You can replay it, diff it, audit it.

| Source | Item |
|---|---|
| Arch | C9 Time-travel replay — re-create a session's memory state at a point in time |
| Arch | C10 Memory diffing across versions |
| PRD | G-G `memory replay` mode |
| PRD | G-B memory diffing across versions |
| UX | §8.4 S3 Memory Review UI surfaces diff/replay |
| DB | versioning tables (pending DB-SPEC §9) |

**Exit criteria:** `/openltm:memory replay --at 2026-04-01` reconstructs the memory set as it was · diff between two memory snapshots renders.

---

## 4. Cross-Cutting Workstreams (run alongside all phases)

### 4.1 UX Cognitive Load Reduction (UX-SPEC §9)
- Drop `:memory:` subnamespace by Phase 5
- Consolidate 40 concepts → 17 (5 commands, 4 categories, 5 link types, 3 weight tiers)
- Naming cleanups across deprecated aliases

### 4.2 Discoverability (UX-SPEC §5)
- Phase 0: terminal onboarding wizard
- Phase 3: ambient suggestion panel (S1)
- Phase 6: graph-app v2 (G-N)

### 4.3 Trust & Transparency (UX-SPEC §6 + Arch W11/C5)
- Phase 0: silent-failure audit
- Phase 2: provenance + audit
- Phase 3: recall explainer
- Phase 6: signed bundles

### 4.4 Performance Budget
- Recall p95 < 200ms across all phases
- Plugin startup overhead < 100ms
- DB size growth flattens by Phase 4

---

## 5. Open Questions / Risk Register

From PRD §9 + Arch hand-off:

| ID | Question | Owner | Phase to resolve |
|---|---|---|---|
| OQ1 | Embedding strategy: bundled vs BYO provider? | architect | Phase 3 (default: BYO) |
| OQ2 | Cross-process write coordination: lock vs queue? | architect | Phase 0 |
| OQ3 | Decay function shape: exponential vs piecewise? | DB | Phase 4 (DB-SPEC §4) |
| OQ4 | EvaluateSession: auto-write vs propose? | UX + arch | **Resolved: propose-only (Phase 0)** |
| OQ5 | Graph-app future: keep, retire, or rewrite? | UX | Phase 6 (G-N decision point) |

---

## 6. Schema Evolution (linked to DB-SPEC.md)

`docs/internal/DB-SPEC.md` is now authoritative for all schema work. Cross-references:

| ROADMAP phase | DB-SPEC section | DDL highlights |
|---|---|---|
| Phase 0 | §5 migration system | `schema_migrations` table + versioned migration runner |
| Phase 0 | §2 indexes | 4 missing indexes added: `idx_memories_status_importance`, `idx_memories_created_at`, `idx_memories_last_recalled_at`, `idx_ctx_project_type_created` |
| Phase 0 | §6 concurrency | `BEGIN IMMEDIATE`, atomic rename for registry, WAL semantics documented |
| Phase 1 | §1 + §2 | DAO splits expensive columns (embeddings, audit) from hot paths |
| Phase 2 | §7 audit/provenance | `memory_provenance`, `memory_audit` tables (DDL in DB-SPEC §7) |
| Phase 3 | §7 embeddings | `memory_embeddings` table split from `memories`; multi-column FTS rebuild |
| Phase 4 | §4 decay | Materialised `decay_score` column + janitor refresh job |
| Phase 5 | §1 contract | `projects`, `hook_events` tables stabilised at 2.0.0 |
| Phase 6 | §7 sync/bundles | `team_bundles`, `bundle_memories`, `signing_keys`, `memory_conflicts`, `sync_state`, `sync_ops` |
| Phase 7 | §7 versioning | `memory_snapshots`, `snapshot_memories` |

DB-SPEC §9 sequences 19 migration files across these phases — that file is the migration order of record.

---

## 7. Hand-off

- **product-manager** → owns PRD evolution; reviews each phase's exit criteria
- **system-architect** → owns ADR additions per phase; reviews capability deltas
- **ui-ux-designer** → owns surface designs S1–S5; reviews onboarding + review UI
- **database-admin** → owns DB-SPEC; updates this doc §6 once DB-SPEC ships
- **buddy** → orchestrates per-phase work via task-tracker DAGs
