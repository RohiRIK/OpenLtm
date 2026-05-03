# Spec — ROADMAP Phase 0: Foundation Hardening (v1.5.x)

**Source roadmap:** `docs/ROADMAP.md` §3 Phase 0
**Cross-refs:** `docs/ARCHITECTURE.md` (W1, W2, W3, W10, W12), `docs/UX-SPEC.md` §3.1, §6.5, `docs/DB-SPEC.md` §5–§6, `docs/PRD.md` G-O
**Target version:** `v1.5.0` (next minor; non-breaking)
**Status:** ready for `/plan`

---

## 1. Context (grounded)

### 1.1 What exists today

Validated against the codebase, not the roadmap claims.

**Hooks** — 6 entry points (roadmap undercounted as 4):
- `hooks/src/SessionStart.ts` — restores context at session start
- `hooks/src/PreCompact.ts` — writes `context-summary.md` before compaction
- `hooks/src/EvaluateSession.ts` — fires on Stop; learns from session
- `hooks/src/UpdateContext.ts` — fires on Stop; updates context_items
- `hooks/src/NotifyLtmServer.ts` — pings the LTM graph server
- `hooks/src/GitCommit.ts` — git-learn entry point

**Hook libs** — already include `hookLogger.ts` (do not re-invent):
- `hooks/lib/hookLogger.ts` — structured logging primitive (reuse, expand)
- `hooks/lib/hookUtils.ts` — shared stdin/JSON helpers
- `hooks/lib/resolveProject.ts` — `REGISTRY_PATH` constant + lookup
- `hooks/lib/hookDoctor.ts`, `pluginDoctor.ts` — health checks

**Migrations** — `src/shared-db.ts:runMigrations()` is the hand-rolled offender:
- Each migration wrapped in `try { db.exec("ALTER TABLE …") } catch { /* idempotent */ }`
- No `schema_migrations` table, no checksum, no version pin
- Runs on every DB open via `runMigrations(_db)` at line 123
- Confirmed by `docs/DB-SPEC.md` §5

**Registry** — `~/.claude/projects/registry.json`:
- Read by `hooks/lib/resolveProject.ts` (`REGISTRY_PATH`)
- Read/written by `src/migrate.ts:48`
- No locking, no atomic rename — concurrent SessionStart hooks can clobber it (W2)

**Plugin manifest** — `.claude-plugin/plugin.json`:
- `version: 1.4.20`
- Single MCP server (`ltm`, command `bun src/mcp-server.ts`)
- Hooks wired via `hooks/hooks.json` (separate file)
- No `engines` field in `package.json` — Bun-only assumed

**Specs convention** — `specs/` already has 5 prior specs (`command-consolidation-v2.md`, `ltm-doctor.md`, etc.). This spec follows their pattern.

### 1.2 Prior art surfaced from LTM

- **Memory #290** (`claude-config`): a working schema-migration system already exists outside the plugin — versioned `.sql` files in `~/.claude/migrations/` with UP/DOWN sections, `_schema_version` table tracks applied migrations with checksum, runner uses `bun:sqlite` + `Bun.file`, auto-backup before first migration. **Reuse this design verbatim** — don't re-invent.
- **Memory #45** (`claude-config`): hook shared-lib checklist — every hook must use the shared `hooks/lib/` helpers, not reimplement stdin parsing or path resolution. Phase 0 silent-fail audit reinforces this.
- **Memory #316** (`portfolio-manager`): `@clack/prompts` is the proven CLI prompt library for onboarding wizards (test-mode + clack-mode branching pattern). Reuse for G-O wizard.
- **Memory #122** (`claude-config`): hook files organised in subdirs (SessionStart/, PreCompact/, …) — plugin uses flat `hooks/src/*.ts` instead. Acceptable; do not reorganise in Phase 0.
- **Memory #176, #178** (`lifecycle`): always read short slug from `registry.json`; the session header may inject the old long slug — ignore the header, prefer registry. Relevant to Phase 0 SessionStart panel work.

### 1.3 Out of scope for Phase 0

(Explicitly deferred per ROADMAP — do not let scope creep eat them.)

- DAO layer (Phase 1)
- Structured observability + log rotation (Phase 1)
- Provenance / audit columns (Phase 2)
- Embedding provider abstraction (Phase 3)
- Materialised `decay_score` / janitor (Phase 4)
- Cross-plugin contract (Phase 5)

---

## 2. Phase 0 Work Items

8 items. Each with file paths, current state, target state, and AC.

---

### W1 — Surface hook errors to the user

**Files touched:**
- `hooks/src/SessionStart.ts`, `PreCompact.ts`, `EvaluateSession.ts`, `UpdateContext.ts`, `NotifyLtmServer.ts`, `GitCommit.ts`
- `hooks/lib/hookLogger.ts` (extend; do not replace)
- `hooks/lib/hookUtils.ts` (add `safeRun()` wrapper)

**Current state:** Hook errors are swallowed by top-level `try/catch` and logged to stderr only — Claude Code UI shows nothing. Users have no signal that a hook failed.

**Target state:** Every hook entry point wraps its body in `safeRun()`. On failure, the wrapper:
1. Writes a structured event to the hook log (existing `hookLogger`)
2. Emits a one-line user-visible warning via the hook's stdout JSON (`additionalContext` for SessionStart; `notice` for Stop hooks)
3. Returns success exit code (does not crash Claude Code) — but the user sees the error

**AC:**
- [ ] AC-W1-1: A forced exception in any hook's body produces a user-visible warning line containing the hook name, error class, and a hint to run `/ltm:doctor`
- [ ] AC-W1-2: The same exception writes a structured JSON event (`{ts, hook, level: "error", message, stack}`) to the hook log
- [ ] AC-W1-3: Hook exit code stays 0 — Claude Code session does not abort
- [ ] AC-W1-4: `safeRun()` is exported from `hooks/lib/hookUtils.ts` and used in all 6 hook entry points; no top-level `try/catch` left in the entry files

---

### W2 — Atomic registry.json writes

**Files touched:**
- `hooks/lib/resolveProject.ts` (add `writeRegistryAtomic()`)
- `src/migrate.ts:48` (replace direct write with `writeRegistryAtomic()`)
- Any other registry writers (grep for `REGISTRY_PATH`)

**Current state:** `registry.json` is read by every SessionStart hook and written by registration flows. No locking, no atomic rename — two concurrent SessionStarts that both register a project can clobber each other (W2).

**Target state:** All registry writes go through `writeRegistryAtomic(registry)`:
1. Acquire an advisory lock file (`registry.json.lock`, `O_EXCL` create, retry with backoff up to 2s)
2. Re-read registry inside the lock (to merge concurrent additions)
3. Write to `registry.json.tmp.<pid>`, then `rename()` over `registry.json` (atomic on POSIX)
4. Release lock

**AC:**
- [ ] AC-W2-1: Two concurrent calls to `writeRegistryAtomic()` with different new entries both end up in the final file (no last-write-wins data loss)
- [ ] AC-W2-2: If the lock cannot be acquired within 2 s, the call fails loudly with a structured error (W1 surfaces it)
- [ ] AC-W2-3: A crashed writer leaves no permanent lockfile — stale locks (>5 s old) are reclaimable
- [ ] AC-W2-4: Direct writes to `REGISTRY_PATH` are removed — only `writeRegistryAtomic` mutates the file (verified via grep)

---

### W3 — `schema_migrations` table + versioned migration files

**Files touched:**
- `src/schema.sql` (add `schema_migrations` table at the top)
- `src/shared-db.ts` (replace `runMigrations()` body)
- `src/migrations/` (NEW directory; one `.sql` per migration)
- `src/migrate.ts` (CLI runner; reuse Memory #290 design)

**Current state:** `runMigrations()` in `src/shared-db.ts` (lines 33–123) does idempotent `try { ALTER TABLE … } catch {}` for each historical change. No version tracking, no checksum, no rollback path (DB-SPEC §5).

**Target state:** Reuse the proven design from claude-config (Memory #290):
1. `schema_migrations` table: `(version TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT, name TEXT)`
2. `src/migrations/0001_initial.sql`, `0002_add_status_column.sql`, … each with `-- UP` and `-- DOWN` sections
3. `runMigrations(db)` reads `schema_migrations`, applies pending files in order, computes SHA-256 checksum, records each
4. Auto-backup `ltm.db` → `ltm.db.bak.YYYYMMDD-HHMMSS` before applying any migration
5. The 9 historical column-adds become migration files `0002_*.sql` … `0010_*.sql`

**AC:**
- [ ] AC-W3-1: Fresh DB applies all migrations in `src/migrations/` and ends up bit-identical to a DB that ran the old `runMigrations()` (validated by schema diff)
- [ ] AC-W3-2: Existing DBs (already on the post-`runMigrations()` schema) are detected and back-filled into `schema_migrations` without re-running ALTERs
- [ ] AC-W3-3: A pending migration's `-- DOWN` section can roll it back via `bun run migrate down --to <version>`
- [ ] AC-W3-4: Auto-backup file is created before any migration runs; visible in `/ltm:health`
- [ ] AC-W3-5: Two processes that try to migrate concurrently — one wins, one waits (advisory lock on `schema_migrations` table or filesystem lock on the DB path)

---

### W10 — EvaluateSession: propose-not-write

**Files touched:**
- `hooks/src/EvaluateSession.ts`
- New: `hooks/lib/proposalQueue.ts` (writes proposals to disk; UX surface reads them)
- `commands/ltm/memory.md` (add `propose review` subcommand surface)

**Current state:** `EvaluateSession` runs on Stop, extracts memories, and writes them directly to the DB. PRD OQ4 and UX-SPEC §3.3 resolved this: **EvaluateSession should never auto-write**.

**Target state:**
1. EvaluateSession extracts memory candidates as it does today
2. Writes them to `${CLAUDE_PLUGIN_DATA}/proposals/<session-id>.json` (NOT the DB)
3. Emits a one-line notice: `"LTM: 3 memory proposals from this session. Run /ltm:memory propose review to inspect."`
4. New surface (`/ltm:memory propose review`) lets user accept/reject each → only accepted ones reach the DB

**AC:**
- [ ] AC-W10-1: Stopping a session never inserts rows into the `memories` table from EvaluateSession
- [ ] AC-W10-2: Proposals file is written under `${CLAUDE_PLUGIN_DATA}/proposals/` with one JSON per session
- [ ] AC-W10-3: User-visible notice fires when ≥1 proposal exists
- [ ] AC-W10-4: `/ltm:memory propose review` lists pending proposals; accept inserts into DB, reject deletes the proposal
- [ ] AC-W10-5: `/ltm:health` shows pending proposal count

---

### W12 — Single-process write coordinator

**Files touched:**
- `src/shared-db.ts` — wrap all write paths in a serialised queue
- New: `src/lib/writeQueue.ts` (in-process FIFO)
- Any caller doing direct `db.exec(INSERT/UPDATE/DELETE)` — route through queue

**Current state:** SQLite is in WAL mode (good), but the plugin assumes single-process access. Multiple Claude Code sessions opening the same DB cause `SQLITE_BUSY` — caught silently in some paths.

**Target state:**
1. In-process write queue (`writeQueue.enqueue(fn)` returns a Promise) serialises all writes within one MCP server process
2. SQLite `busy_timeout` set to 5000 ms for cross-process retries
3. Reads stay direct (WAL allows concurrent reads)
4. `SQLITE_BUSY` exceptions become structured errors (W1 surfaces them)

**AC:**
- [ ] AC-W12-1: `BEGIN IMMEDIATE` is used for every write transaction (verified by grep)
- [ ] AC-W12-2: `busy_timeout=5000` is set on every connection at open
- [ ] AC-W12-3: Two parallel `ltm_learn` calls in one process complete in serial order; neither errors
- [ ] AC-W12-4: An external `sqlite3 ltm.db` write during plugin operation does not crash the plugin — it retries within `busy_timeout`

---

### UX-SPEC §6.5 — Silent-failure audit

**Files touched:** every `catch` block in `hooks/`, `src/`, `commands/`.

**Current state:** UX-SPEC §6.5 calls out that many `catch` blocks log nothing or log to stderr only. Users see no signal.

**Target state:** Every `catch` block falls into one of three policies:
1. **Surface** — wrap in `safeRun()` (W1) → user sees a notice
2. **Recover-and-record** — recovery is intended, but a structured `level: "warn"` event is logged
3. **Truly-ignore** — explicitly annotated with `// silent: <reason>` comment

**AC:**
- [ ] AC-SF-1: Every `catch` in `hooks/`, `src/`, and `commands/` either calls a logger, calls `safeRun`, or has a `// silent:` comment with rationale
- [ ] AC-SF-2: A grep for `} catch (e?) { *}` returns zero matches in non-test code
- [ ] AC-SF-3: `/ltm:doctor` reports the count of warn/error events from the last 24 h

---

### UX-SPEC §3.1 — SessionStart panel

**Files touched:**
- `hooks/src/SessionStart.ts`
- `hooks/lib/resolveProject.ts` (use short slug per Memory #176/#178)

**Current state:** SessionStart sometimes injects context, sometimes silently skips. User cannot tell which.

**Target state:** SessionStart always emits a single-line panel header into `additionalContext`:
- `## LTM Session: <project-slug> | restored: <N> ctx items, <M> top memories`
- OR: `## LTM Session: <project-slug> | NO CONTEXT (reason: registry miss / fresh project / hook error)`

The reason field is required when no context was restored.

**AC:**
- [ ] AC-SS-1: Every session start produces exactly one panel line at the top of `additionalContext`
- [ ] AC-SS-2: When context is restored, the line includes the count of context items + top memories
- [ ] AC-SS-3: When no context is restored, the line includes a reason string from a known enum (`registry_miss`, `fresh_project`, `hook_error`, `db_unavailable`)
- [ ] AC-SS-4: Project slug is read from `registry.json` directly (Memory #176) — not from any session header
- [ ] AC-SS-5: Hook errors (W1) produce the `hook_error` reason rather than disappearing

---

### G-O — Onboarding wizard v1 (terminal walkthrough)

**Files touched:**
- New: `commands/ltm/onboard.md` (slash command surface)
- New: `src/onboard.ts` (CLI runner)
- `package.json` (add `@clack/prompts` dep — reuse Memory #316 pattern)

**Current state:** UX-SPEC §5.1: "abandoned by 50%". No first-run guidance.

**Target state:** `/ltm:onboard` runs a 5-step terminal wizard:
1. **Diagnose** — runs `pluginDoctor`; if anything fails, refers to `/ltm:doctor` and exits
2. **Project register** — confirms current `cwd` short-slug from registry; offers to register if missing
3. **Goal capture** — prompts for one-line project goal; stores as `goal` context_item
4. **Tour** — shows 4 commands (recall, learn, health, doctor) with one-line descriptions
5. **Done** — writes `${CLAUDE_PLUGIN_DATA}/onboarded.flag` so we don't re-prompt

**AC:**
- [ ] AC-G-O-1: `/ltm:onboard` completes all 5 steps in <2 minutes for a fresh user
- [ ] AC-G-O-2: Wizard works in `--non-interactive` mode (test path branches on `_testPrompter` per Memory #316)
- [ ] AC-G-O-3: Re-running `/ltm:onboard` after completion is idempotent — detects the flag, prints "already onboarded; re-run with `--force`"
- [ ] AC-G-O-4: At least 8 unit tests cover the wizard branches; existing tests stay green
- [ ] AC-G-O-5: Wizard never proceeds if `pluginDoctor` reports a CRITICAL failure (it links to `/ltm:doctor` instead)

---

## 3. Cross-cutting AC (gates the whole phase)

- [ ] AC-PHASE-1: All 8 work items merged behind feature flag if not safe-by-default; remove flag at `1.5.0` cut
- [ ] AC-PHASE-2: `bun run typecheck` and `bun test` stay green throughout
- [ ] AC-PHASE-3: Plugin version bumped to `1.5.0` in both `package.json` and `.claude-plugin/plugin.json` (per `CLAUDE.md` mandate)
- [ ] AC-PHASE-4: `docs/MIGRATION.md` updated with Phase 0 ledger (which migrations exist, how to roll back, how to recover from a stale lock)
- [ ] AC-PHASE-5: 1-week dogfood window passes with zero silent hook failures (W1 confirms by metric in `/ltm:health`)

## 4. Risks & open decisions

| ID | Question | Default if undecided |
|---|---|---|
| R1 | Lock mechanism for registry.json: file-lock vs `proper-lockfile` dep? | File-lock (no new deps) |
| R2 | Where does `proposals/` live: `${CLAUDE_PLUGIN_DATA}/proposals/` or new table? | Filesystem (matches W10 "propose, not write") |
| R3 | Onboarding wizard — invoke automatically on first MCP call, or strictly user-invoked? | Strictly user-invoked in v1; auto-invoke is Phase 1 (S1 ambient) |
| R4 | `schema_migrations` checksum: SHA-256 of file content, or content + filename? | Content only (filename rename should not invalidate) |

## 5. Out-of-scope reminders

(Stop scope creep — these are NOT Phase 0)

- DAO layer (Phase 1)
- Hook ↔ DB decoupling beyond the safeRun wrapper (Phase 1)
- Provenance columns on memories (Phase 2)
- Embedding provider (Phase 3)
- Materialised decay_score / janitor (Phase 4)
- Memory diffing, conflict modal, signed bundles (Phase 6+)

## 6. Hand-off

After this spec is approved:
- `/plan` — turn each AC into one or more plan tasks; identify shared work (e.g., `safeRun` lands first because W1 + UX-SPEC §6.5 both depend on it)
- Suggested execution order: W3 (migrations) → W1 + safeRun → UX-SPEC §6.5 audit → W2 (registry) → W12 (write queue) → SessionStart panel → W10 (proposals) → G-O (wizard)
- Suggested agents: `database-admin` for W3, `backend-developer` for W1/W2/W10/W12, `ui-ux-designer` for SessionStart panel + onboarding wizard surface, `qa-tester` for AC verification per item, `github-manager` for the v1.5.0 cut
