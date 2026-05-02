# ROADMAP — Claude LTM Plugin

> **Master integration spec.** Synthesises `PRD.md`, `ARCHITECTURE.md`, `UX-SPEC.md` into a single phased plan. `DB-SPEC.md` augments §6 (Schema) and per-phase DB work once written.
>
> Source documents — keep authoritative:
> - `docs/PRD.md` — what & why (vision, personas, JTBDs, US-1..17, gaps G-A..G-O)
> - `docs/ARCHITECTURE.md` — system shape (C4, ADR-001..006, weaknesses W1..W12, capabilities C1..C10)
> - `docs/UX-SPEC.md` — user-facing surface (interaction model, hooks, surfaces S1..S5)
> - `docs/DB-SPEC.md` — schema (pending; section 6 + per-phase DB rows updated when ready)

---

## 1. Executive Summary

**Where we are (v1.4.20):** A working LTM plugin with SQLite + FTS5 + 4 hooks + 7 MCP tools + grouped commands. Functional. Honest weaknesses: silent hook failures, hand-rolled migrations, O(N) recall, no provenance, no audit, no observability. UX is invisible-by-default but onboarding is "abandoned by 50%".

**Where we want to be:** A magnificent LTM that is invisible when it should be, surgical when invoked, trustable for teams and enterprise, and pluggable for embeddings, sync, bundles, and cross-plugin contracts.

**The plan:** 8 phases (v1.5.x → v2.2.x). Phases 0–4 are non-breaking foundation. Phase 5 (v2.0.0) is the semver-major cross-plugin contract. Phases 6–7 layer on team/enterprise/power-user features.

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

**Goal:** Make the system inspectable. Decouple hooks from raw SQL.

| Source | Item |
|---|---|
| Arch | W5 Structured logs (JSONL) + log-rotation; `/ltm:health` reads from it |
| Arch | W7 DAO returns slim recall rows (drop embeddings unless requested) |
| Arch | W8 Hooks call DAO, never raw SQL; schema changes don't ripple to hooks |
| UX | §3 hook map — every hook publishes a structured event consumable by `/ltm:health` |
| UX | §2.4 `/ltm:health` becomes the single source of truth (consumes Phase 1 events) |

**Exit criteria:** schema can change without touching hooks · `/ltm:health` shows real activity counts from logs · MCP recall response < 50ms p95 at 10k memories.

---

### Phase 2 — Provenance + Audit (v1.7.x, non-breaking)

**Goal:** Every memory is traceable. Every write is auditable.

| Source | Item |
|---|---|
| Arch | W9 + C5 Provenance chain on every memory (source: `learn` / `git-learn` / `evaluate-session` / `import-bundle`) |
| Arch | W11 + C5 `memory_audit` table — every insert/update/delete recorded with actor, hook, session-id |
| PRD | G-J per-memory provenance chain (PRD-side requirement satisfied) |
| UX | §8.4 S3 Memory Review UI — show provenance per memory |
| DB | `memory_audit` schema (pending DB-SPEC §7) |

**Exit criteria:** every memory has `source` + `created_by` populated · audit table is query-able from `/ltm:admin audit` · UX-SPEC §8.4 S3 can render provenance.

---

### Phase 3 — Embedding Provider Abstraction (v1.8.x, non-breaking)

**Goal:** FTS5 stays. Embeddings become pluggable, not bundled.

| Source | Item |
|---|---|
| Arch | C1 Pluggable embedding provider interface (Gemini / OpenAI / Ollama / disabled) |
| PRD | G-E project-scoped semantic embeddings (provider configurable) |
| PRD | G-C auto-categorisation on `ltm_learn` (uses embedding provider when enabled) |
| Arch | C8 Recall result explainer — show why each result ranked where it did |
| UX | §8.3 S2 Smart recall surfacing — uses C1 + C8 |
| DB | `memory_embeddings` table split (pending DB-SPEC §7) |

**Exit criteria:** plugin works fully without any embedding provider · with provider, recall latency stays < 200ms p95 · explainer shows score breakdown.

---

### Phase 4 — Janitor (v1.9.x, non-breaking)

**Goal:** The plugin curates itself. Decay, compression, cleanup happen as background work.

| Source | Item |
|---|---|
| Arch | W4 Materialise `decay_score` on memories; janitor refreshes nightly |
| Arch | C6 Memory compression / rollups (low-importance + low-recall → archive table) |
| PRD | G-L memory budget + compression |
| UX | §8.8 magnificent defaults — janitor enabled by default |
| DB | `decay_score` column + janitor job spec (pending DB-SPEC §4, §8) |

**Exit criteria:** recall scoring is O(top-k log N) not O(N) · DB size growth flattens at scale · janitor logs visible in `/ltm:health`.

---

### Phase 5 — Cross-Plugin Contract (v2.0.0, semver-major)

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

**Goal:** Memory becomes history. You can replay it, diff it, audit it.

| Source | Item |
|---|---|
| Arch | C9 Time-travel replay — re-create a session's memory state at a point in time |
| Arch | C10 Memory diffing across versions |
| PRD | G-G `memory replay` mode |
| PRD | G-B memory diffing across versions |
| UX | §8.4 S3 Memory Review UI surfaces diff/replay |
| DB | versioning tables (pending DB-SPEC §9) |

**Exit criteria:** `/ltm:memory replay --at 2026-04-01` reconstructs the memory set as it was · diff between two memory snapshots renders.

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

`docs/DB-SPEC.md` is now authoritative for all schema work. Cross-references:

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
