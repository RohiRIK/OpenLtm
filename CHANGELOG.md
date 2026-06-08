# Changelog

## [2.8.0] — 2026-06-08

### Changed
- **Open source under MIT.** OpenLTM is now a public, MIT-licensed project. No cloud, no account, no telemetry — the memory database stays local and owned by the user.
- **Renamed to OpenLTM.** The brand and identifiers moved from the private `claude-ltm-plugin` to the open `openltm`:
  - Plugin name `claude-ltm-plugin` → `openltm`; marketplace → `OpenLtm` (`RohiRIK/OpenLtm`).
  - MCP tool prefix `mcp__plugin_ltm_memory__*` → `mcp__plugin_openltm_memory__*`.
  - Core npm package `@rohirik/ltm-core` → `@rohirik/openltm-core`.
  - Plugin data directory `ltm-ltm/` → `OpenLtm-openltm/`; database file → `openltm.db`.
  - Slash commands `/ltm:*` → `/openltm:*`.
  - The concept word "LTM" is unchanged. Existing memory databases migrate automatically.

### Added
- **README open-source announcement + banner** — landing page rewritten for the public launch with a new OpenLTM hero banner.
- **`Spec` skill and `planner` agent** — spec-driven definition and planning skills, wired to the LTM contract.
- **Documentation overhaul** — `docs/` reorganized into a numbered, user-facing set (`00-quickstart` … `09-troubleshooting`); product and design specs moved to `docs/internal/`. New guides: Quickstart, Installation, Troubleshooting, and a root `CONTRIBUTING.md`.

### Removed
- Obsolete migration docs (`docs/migration.md` and the root `MIGRATION.md`) covering the deprecated git-clone setup; the marketplace install path migrates existing databases automatically.

## [2.7.0] — 2026-06-05

### Added
- **Project layer 3-pane shell** — new routes under `/projects/...`: overview, memories, timeline, connections, health, settings. Each project gets a 56px icon sub-nav (acid-lime active bar), main pane, and an optional 320px inspector. "All projects (global)" is a first-class switcher entry.
- **5-section Settings split** — `/settings` now has a left-rail nav with System (providers + storage), Behavior (reasoning + decay + inbox 30d), Health (Memory Keeper + Recover), Advanced (System Explorer, collapsed by default), and About (version + license + feedback).
- **Recover drawer** — slide-in tray from the right at `Settings → Health`, surface for soft-deleted memories (UI shell; the real soft-delete pipeline lands in v2.8.0).
- **`/api/health/history?project=X`** — synthetic 30-point series (deterministic per-day drift seeded by project name). Lets the Health page render a 30-day sparkline; a real `health_history` table is scheduled for v2.8.0.
- **Inspector right-click menu** — right-click anywhere in the inspector reveals: Open in project (navigates to `/projects/:name/memories`), Mark permanent (v2.8), Find conflicts (v2.8). v2.8 items are labelled.
- **Decision "Why?" tooltip** — decision context nodes get a small "Why?" button in the category banner. Click reveals the decision's content + source session id + a hint to use Recall.
- **⌘K search history** — SpotlightModal now shows the last 10 queries from `localStorage` (`ltm.searchHistory`, deduped) when the query is empty. Submitting a search pushes to history.
- **`--accent-blue` and `--accent-lime-foreground` tokens** — added to all 6 themes. Mercury blue is rationed to one primary CTA per Settings section; acid lime stays rationed to the 2 use-sites from v2.5.0.
- **Animated Status Badge** (isaiahbjork, 21st.dev) — used in `Settings → Health` for the Janitor running state.
- **Auto-allow the LTM MCP server on install** — `scripts/install-wiring.ts` adds `mcp__plugin_openltm_memory` to `permissions.allow` in `~/.claude/settings.json` idempotently (dev and marketplace installs). The plugin's MCP tools (`recall`, `learn`, `forget`, `relate`, `context`, `context_items`, `graph`) no longer prompt on every call; the action is logged, not silent.

### Changed
- **Component refactors** — `ProjectTableView`, `ProjectBoardView`, `ProjectTimeline`, `ProjectConnections`, `ProjectRelevance`, `StaleMemoryAlert` rewritten to the redesign spec:
  - Table: 32px rows, hairline borders, sticky header, 2-button row action menu on hover.
  - Board: inline edit (double-click content → textarea, ⌘+Enter saves, Esc cancels).
  - Timeline: Status Indicators Timeline pattern (color-coded pills on vertical rail, day-grouped, 4 ranges).
  - Connections: map-first with 6 relation filter chips, floating legend, "Why this exists" banner.
  - Relevance: 32px Cursor-style thumbs colored with `nodeColor(category)`.
  - StaleMemoryAlert: project-scoped, 3-action row (Confirm/Edit/Forget) revealed on hover.
- **`/project/[name]` → `/projects/[name]`** — `/project/[name]` is now a 5-line server redirect. Kept for backward compatibility through v2.7.x; removed at v2.8.0 per redesign spec §8 Q5.
- **`/` → `/projects`** — the home page is now `/projects`; the old `/` 307-redirects there.
- **`AppShell` wraps in `ProjectProvider`** — the TopNav `ProjectSwitcher` is now project-aware on every route.
- **GitLearn runs key-free via a Haiku subagent** — `skills/GitLearn/SKILL.md` (→ v1.2.0) spawns a Haiku subagent (Agent tool) that reads commit diffs and stores memories through the `learn` MCP tool. Removes the LLM-API-key dependency on the interactive path and keeps raw diffs out of the main thread's context. The background post-commit hook still calls an LLM API directly (a detached process cannot spawn a subagent).
- **`Learned` skill points at live sources only** — `skills/Learned/SKILL.md` now references `summary.md` (auto-updated by the EvaluateSession hook) and LTM recall, instead of the removed per-session archive files.

### Removed
- **Per-session `Learned/patterns/*.md` archives** — relic snapshots no longer written by any code path; their content was already imported into the LTM database. Removed from the repo and the plugin cache.

### Fixed
- **Version sync across sub-packages** — `packages/openltm-core`, `packages/adapter-pi`, and `packages/adapter-opencode` were stranded at `2.2.0` while the plugin advanced. All workspace packages, the plugin manifest, the README badge, and `docs/ARCHITECTURE.md` are now aligned to the source-of-truth version.
- **Stale MCP tool name in learned-pattern records** — references to the renamed `mcp__plugin_ltm_ltm__ltm_learn` eliminated (canonical is `mcp__plugin_openltm_memory__learn`).

### Notes
- Phases 2 + 3 of the frontend redesign — Restructure + Refine. See `docs/FRONTEND-REDESIGN-2026-06.md` for the full plan.
- Cluster labels already use a tag-frequency heuristic in `src/cluster.ts:64` (`generateClusterLabel`); LLM-generated labels are deferred to v2.8+.
- The synthetic `/api/health/history` series is stable per `(project_name, date)` — refreshing the page does not jitter the chart.

## [2.5.0] — 2026-06-05

### Changed
- **Frontend route rename** — `/pending` → `/inbox` across the web graph-app. The old `/pending` route now 302-redirects to `/inbox` for backward compatibility through v2.7.0; the redirect is removed at v2.8.0 per the redesign spec §8 Q5.
- **New "Ask" affordance** — A small sparkle-icon button in the top nav opens a dialog powered by the johuniq/ai-prompt-box component (21st.dev). On send, it pipes the query to the existing semantic search endpoint and routes to `/graph?q=…`. The full LLM-mediated ask flow is deferred to v2.6+.

### Added
- **AI Prompt Box** (johuniq, 21st.dev) — installed via `bunx shadcn@latest add https://21st.dev/r/johuniq/ai-prompt-box`. Self-contained input with expanding textarea, model selector, and file attachments. Drop-in at `graph-app/components/ui/ai-prompt-box.tsx`.
- **`--accent-lime` CSS token** — Reserved single-accent color for the project layer (Linear territory), added to all 6 themes. Per the redesign spec §13, the token is rationed to two specific uses in v2.6: (a) 2px left bar of selected sub-nav item, (b) ring around the central project node in the mini-graph.

### Notes
- Phase 1 of the frontend redesign — Cut. See `docs/FRONTEND-REDESIGN-2026-06.md` for the full plan (Phases 1–3, v2.5.0 → v2.7.0).
- The Anthropic plugin marketplace detects new versions via the `version` field in `.claude-plugin/plugin.json`. Bump in both `package.json` and `.claude-plugin/plugin.json` to keep them in sync.

## [2.4.0] — 2026-06-04

### Added
- **Complete UX Redesign**: Transitioned the app from a basic aesthetic to a premium, cinematic, dark-tactile design.
- **Theme System**: Added 6 cinematic themes (Studio Black, Midnight Indigo, Forest Void, Monochrome Concrete, Cyberpunk Wine, Abyssal Ocean) powered by global CSS variables and Next Themes.
- **Theme Switcher**: Added a dropdown toggle to the Top Nav to switch between the 6 themes.
- **Dashboard Overhaul**: Restructured the dashboard to prioritize global metrics. Moved `ActivityHeatmap` to the top as a full-width hero card, showing 52-weeks of contribution data. Separated project partitions and added a toggle to hide/show projects.
- **Hover Preview Card**: Replaced the raw DOM tooltip in the graph with a styled, floating card showing category, memory preview, and confidence score.
- **Search-to-Focus**: Added a floating search input in the Graph View to highlight matching nodes instantly.
- **Animated Node Entrance**: Added a fade-in effect when graph nodes are first loaded on the canvas.
- **URL-driven Graph State**: The graph's state (`activeProject`, `importanceMin`, `electricEffectsEnabled`) is now synchronized with URL search params to allow sharing exact views.
- **Project Activity Log**: Added a vertical timeline showing recent memory events on project pages.
- **Decay Visualization**: Board and table views now show visual indicators (subtle red dashed borders or down arrows) for memories whose confidence is < 0.4.
- **Empty States**: Replaced plain text fallbacks with beautifully designed typographic empty states using Lucide icons.
- **Keyboard Navigation**: The table view now supports `j`/`k` (or arrow keys) to navigate through memories, highlighting the selected row.
- **Related Memories Sidebar**: The node inspector sidebar now uses `api.semanticSearch` to display a list of semantically related memories.
- **Responsive Mobile Nav**: Added a hamburger menu to `TopNav` for mobile screens, replacing hidden elements.

### Removed
- **System Health Card**: Removed the global system health card from the dashboard since the metrics are now represented in the hero and activity views.

## [1.9.1] — 2026-05-09

### Removed
- **15 deprecated command aliases** — `recall`, `learn`, `forget`, `relate`, `capture`, `init-context`, `analyze-context`, `register-project`, `doctor`, `hook-doctor`, `decay-report`, `migrate`, `migrate-db`, `secrets-scan`, `ltm-server`. Use the 4 grouped commands: `/openltm:memory`, `/openltm:project`, `/openltm:health`, `/openltm:admin`.

### Fixed
- **README version badge** — Updated from stale `1.4.20` to current version.
- **SessionStart error message** — Referenced deprecated `/openltm:doctor`; now points to `/openltm:health`.
- **docs version headers** — `ARCHITECTURE.md`, `UX-SPEC.md`, `PRD.md` updated from `v1.4.20`.
- **Install diagram** — Removed "(+ 11 aliases)" from command count.

### Added
- **`scripts/verify-version-sync.ts`** — Checks that `package.json`, `.claude-plugin/plugin.json`, `README.md` badge, and `docs/ARCHITECTURE.md` all reference the same version.

---

## [1.9.0] — 2026-05-04

### Added
- **`memory_archive` table** — Evicted deprecated memories are preserved as JSON snapshots rather than deleted. Recoverable in Phase 7 (time-travel).
- **`memory_archive` migration (011)** — Adds `decay_score REAL NOT NULL DEFAULT 1.0` column + `idx_memories_decay_score` index to `memories`; creates `memory_archive` table with project + reason indexes.
- **Janitor settings seed (012)** — Seeds `ltm.janitor.lastRunAt`, `lastDecayRefreshed`, `lastDeprecated`, `lastArchived` rows via `INSERT OR IGNORE`.
- **`src/janitor/archive.ts`** — New `runArchive()`: evicts `deprecated + importance≤2 + recall_count≤1 + decay_score<0.10` memories into `memory_archive`. Batch of 100 per run; single-transaction DELETE cascades `memory_embeddings`, `memory_tags`, and `memory_relations`.
- **Janitor run tracking** — `runJanitor()` writes stats to settings after each pass (`lastRunAt`, `lastDecayRefreshed`, `lastDeprecated`, `lastArchived`).
- **WAL hygiene** — `runJanitor()` runs `PRAGMA wal_checkpoint(TRUNCATE)` + `PRAGMA analysis_limit=400; ANALYZE` after every pass.
- **`/openltm:health` Janitor Status section** — Shows last run timestamp, refreshed/deprecated/archived counts, next run estimate, at-risk memory count (`decay_score < 0.25`). Replaces the old inline JS decay formula with a SQL-backed summary.

### Changed
- **`runDecay()` rewritten** — Replaced O(N) JS loop + N individual UPDATEs with two batch SQL statements in one transaction: (1) `UPDATE SET decay_score = CASE …` using `power()` for all active memories, (2) `UPDATE SET status='deprecated' WHERE decay_score < 0.25`. Orders-of-magnitude faster at scale.
- **`recall()` default sort** — Replaced O(N) JS `.map(computeDecayScore).sort()` with `ORDER BY decay_score DESC` in SQL. Default sort is now O(log N) via the new index.
- **`recall()` UPDATE merged** — Two consecutive `UPDATE memories SET …` calls on the same row set (one for `last_used_at`, one for `last_recalled_at`/`recall_count`) merged into a single statement.
- **`DecayResult`** — Removed redundant `scanned` field (was always equal to `refreshed`).
- **`ArchiveResult`** — Removed unused `skipped` field (was computed but never surfaced).
- **`SETTING_KEYS`** — Added 4 new janitor tracking keys; `SETTING_DEFAULTS` updated with empty/zero defaults.

### Performance
| Path | Before | After |
|------|--------|-------|
| `recall()` default sort (10k memories) | O(N) JS ~40ms | O(log N) SQL ~3ms |
| `runDecay()` janitor pass (10k memories) | N×UPDATE ~2s | 2×SQL batch ~30ms |
| `recall()` row UPDATE | 2 sequential UPDATEs | 1 merged UPDATE |

---

## [1.8.0] — 2026-05-04

### Added
- **`EmbeddingProvider` interface** — Pluggable `generate(text): Promise<Float32Array | null>` + `available(): Promise<boolean>` abstraction. Four adapters: `disabled` (default), `Ollama`, `OpenAI`, `Gemini`.
- **`memory_embeddings` side-table (migration 010)** — Splits embedding BLOB from `memories` table into a separate `memory_embeddings` table with `ON DELETE CASCADE`. Eliminates ~260 KB/row from the recall hot path.
- **Embeddings DAO** (`src/dao/embeddings.ts`) — `getEmbedding`, `setEmbedding`, `deleteEmbedding`, `listMemoryIdsMissingEmbedding`. All embedding reads/writes go through this layer.
- **Recall explainer** — `recall()` attaches `explainer` to every result: `{ ftsRank, semanticScore, importanceBoost, recencyBoost, totalScore, temperature }`.
- **Memory temperature labels** — `hot` (recall≥10 or within 7d), `warm` (≥3 or 30d), `cool` (≥1 or 90d), `cold` (never recalled).
- **Auto-categoriser** (`src/recall/categorise.ts`) — `ltm_learn` detects category when omitted. Heuristic keyword scoring first; falls back to Anthropic API (claude-haiku) if confidence < threshold. Configurable via `embeddings.confidenceThreshold` (default 0.6).
- **SessionStart backfill hint** — One-per-day suggestion to run `/openltm:admin backfill` when a provider is configured but memories lack embeddings.
- **`ltm_recall` MCP response** — `compact()` formatter now surfaces `temperature` + `score` on every result.

### Changed
- **Ollama adapter** — Corrected endpoint (`/api/embed`), request body field (`input` not `prompt`), and response parse (`embeddings[0]` not `embedding`).
- **`available()` guard** — Called once before batch operations, not N times in a loop.
- **`workspace_id` / `agent_id`** — Now correctly forwarded through `ltm_learn` MCP handler to `learn()`.
- **`categorise.test.ts`** — Replaced 6 near-duplicate `it()` blocks with `it.each` table over `Array<[MemoryCategory, string]>`.

---

## [1.4.17] — 2026-04-15

### Added
- **`/openltm:memory` command** — Grouped routing for `recall | learn | forget | relate`. Replaces the 4 flat commands with a single entry point; flat commands kept as unchanged aliases.
- **`/openltm:project` command** — Grouped routing for `init | analyze | register`. Embeds full logic from `init-context`, `analyze-context`, `register-project`.
- **`/openltm:admin` command** — Grouped routing for `migrate | scan | server`. Includes all migrate flags, secrets scan, and server management.
- **`--save-context` flag on `/openltm:learn`** — Stores memory AND writes to `context_items` table in one shot. Replaces the need for separate `/openltm:capture` calls.
- **Legacy DB detection in `/openltm:migrate`** — Automatically checks for `~/.claude/memory/openltm.db` on `status` runs; `--legacy` flag triggers migration.

### Changed
- **`/openltm:health`** — Now shows graph server project scores (if running) AND inline memory decay summary from local DB. Graph server is optional — decay section always renders.
- **`/openltm:doctor`** — Now runs both `pluginDoctor.ts` (plugin health) and `hookDoctor.ts` (hook health) in a single command. Replaces the need for `/openltm:hook-doctor`.

### Fixed
- **`/openltm:secrets-scan`** — Fixed `secretsScrubber.js` import → `secretsScrubber.ts`. Previous `.js` extension caused a runtime error since Bun runs `.ts` directly.
- **Added auto-scrub note** to `secrets-scan` and `admin scan` — clarifies that new memories are already scrubbed on write via `db.ts:263`; this command patches existing memories only.

### Deprecated (removing in v1.6.0)
- `/openltm:hook-doctor` → use `/openltm:doctor`
- `/openltm:migrate-db` → use `/openltm:migrate --legacy` or `/openltm:admin migrate --legacy`
- `/openltm:capture` → use `/openltm:learn --save-context` or `/openltm:memory learn --save-context`
- `/openltm:decay-report` → use `/openltm:health`

---

## [1.4.15] — 2026-04-14

### Added
- **`/openltm:doctor` command** — Unified plugin health check covering 9 areas: version consistency, bun runtime, database integrity + migrations, MCP registration, hooks.json source files + log error counts, settings.json hooks, stale executables (exit 127 source), marketplace source, and plugin.json forbidden fields. Output: ✅/❌/🟡/🔴 per check with `→` remediation and final N passed/M failed summary.
- **`hooks/bin/run-hook.sh`** — POSIX shell wrapper that locates bun across all install methods (Homebrew, Volta, asdf, curl installer) before falling back to shell profile sourcing. Eliminates the hardcoded `/opt/homebrew/bin/bun` dependency that broke non-Homebrew installs.

### Fixed
- **Exit 127 on session start** — Stale `.ts` and `.bundle.mjs` executables in `~/.claude/hooks/` were auto-discovered by Claude Code and run via `#!/usr/bin/env bun` shebang; bun is not in the harness subprocess PATH → exit 127. `install-wiring.ts` now removes these stale files on every update.
- **hooks.json commands** — Replaced hardcoded `/opt/homebrew/bin/bun run ...` with `run-hook.sh` wrapper. Works on any machine regardless of bun install method and survives marketplace updates without requiring postinstall re-patching.

### Changed
- **`install-wiring.ts`** — Stale hook file cleanup now derived from `LTM_HOOK_PATTERNS` instead of hardcoded list; removes both `.ts` and `.bundle.mjs` variants. Adds defensive `chmod +x` on `run-hook.sh` after each update.

---

## [1.4.5] — 2026-04-11

### Added
- **LTM Evolution Plan (18 tasks)** — Full implementation of automatic LLM memory tool utilization, conflict detection, temporal reasoning, and multi-agent support
- **SessionStart hook** — Inject memories + context at session start with imperative recall instructions
- **MCP tool descriptions** — Added "MUST-CALL" triggers to all tools for automatic LLM usage
- **CLAUDE.md rewrite** — Imperative rules requiring LTM tool usage before non-trivial tasks
- **Skill YAML frontmatter** — Enhanced descriptions with auto-invocation triggers
- **autoRecall config** — Option to auto-call ltm_recall at session start
- **Few-shot examples** — Added to ContinuousLearning skill
- **/analyze-context command** — Wrapper for context analysis
- **Unified decay model** — Half-life based (90 days default) eliminating dual-model contradiction
- **Temporal metadata** — first_recalled_at, last_recalled_at, recall_count on memories table
- **Contradiction detection** — janitor detects conflicting memories via embeddings
- **Conflict surfacing** — SessionStart shows conflicting memories to user
- **Timeline view** — graph-app shows memory recall history
- **Temporal queries** — ltm_recall supports since/until/sort_by params

### Fixed
- **plugin.json** — Added hooks and agents paths for proper Claude Code plugin discovery

### Changed
- **Skills** — Now 5 skills: ContinuousLearning, GitLearn, Learned, LtmServer, session-context

---

# Changelog

## [1.3.9] — 2026-04-01

### Added
- **LLM migration guide** (`docs/llm-migration-guide.md`) — prompt-engineered guide that LLMs can follow to migrate users from legacy `~/.claude/memory/` setup to the plugin system. Imperative steps, shell-ready commands, decision table, verification checklist.
- **Curl one-liner in README** — users paste a single curl command into any LLM coding session to trigger the full migration autonomously.

### Fixed
- **install-wiring.ts** — handle missing `~/.claude/settings.json` on fresh installs and CI runners.
- **install-wiring.ts** — auto-detect marketplace installs and skip `settings.json` hook wiring (plugin system uses `hooks/hooks.json` instead). Cleans up stale LTM hooks left from previous dev installs.
- **install-wiring.ts** — scan `~/.claude/plugins/data/ltm-*` as fallback when `CLAUDE_PLUGIN_DATA` is not set, so DB auto-copy works on first install without a session restart.
- **CI** — use `bun run test` instead of bare `bun test` to exclude Playwright e2e tests via `--path-ignore-patterns`.
- **bunfig.toml** — remove `preload = []` (rejected by Bun as invalid).
- **LLM migration guide** — use `~/.claude/plugins/data/ltm-*/openltm.db` instead of `$CLAUDE_PLUGIN_DATA` (env var is only set inside plugin runtime, not in user shells).

---

## [1.3.8] — 2026-03-27

### Fixed
- **Compact MCP responses** — `ltm_recall` now returns a compact format by default, reducing response size by ~70-80%. Strips verbose metadata fields, truncates content to 300 chars, and slims relations to `{id, type, dir}`. Pass `verbose: true` to get the full output.
- **Removed JSON pretty-printing** across all MCP tools and resources (`ltm_recall`, `ltm_context`, `ltm_context_items`, globals/recent/tags resources). Compact JSON halves whitespace overhead.

---

## [1.3.7] — 2026-03-26

### Added
- **Graph UI improvements** — nav active state, config polish, force-directed graph tuning, health auto-refresh.
- **Config Explorer page** in graph-app — browse LTM configuration visually.
- **`src/janitor/`** module for memory maintenance tasks.

### Changed
- **Graph visualization** migrated from custom D3 to `react-force-graph-2d`.
- **Config Explorer API** added to graph-server (`/api/config-explorer`).
- Removed old HTML route from graph-server.
- LtmServer skill updated to use `CLAUDE_PLUGIN_ROOT` instead of hardcoded `~/.claude/memory/`.

---

## [1.3.0–1.3.6] — 2026-03-25

### Added
- **`/migrate-db` command** — check and migrate `openltm.db` from legacy `~/.claude/memory/` to marketplace plugin data directory.
- **Auto git-fetch** on SessionStart — marketplace clone stays current without manual pulls.
- **Self-healing GitHub source** — `install-wiring.ts` patches `known_marketplaces.json` to `"source":"github"` on every postinstall, preventing the plugin system from reverting to `"git"` source.

### Fixed
- DB path migration fix — ensures `openltm.db` is always found at the correct marketplace data path.
- Duplicate MCP registration removed from `install-wiring.ts`.
- `patchMarketplaceSource` refactored — no mutation, no TOCTOU race, uses named constant.
- Version sync — both `package.json` and `.claude-plugin/plugin.json` are kept in lockstep.

---

## [1.2.0] — 2026-03-24

### Added
- **Git Commit Hooks** (`hooks/src/GitCommit.ts`) — global post-commit hook that auto-extracts learnings from diffs using LLM extraction. Fires on every commit across all projects, exits immediately (non-blocking). Controlled by `ltm.gitLearnEnabled` config flag (default: `false`).
- **Shared LLM extraction** (`hooks/lib/llmExtract.ts`) — `extractAndLearn()` shared by both `EvaluateSession` and `GitCommit` hooks.
- **`/git-learn` skill** (`skills/GitLearn/SKILL.md`) — retroactive extraction for past commits (`--commits N` / `--since <date>`).
- **`scripts/update-wiring.ts`** — re-wires MCP, hooks, and git hook after marketplace updates. Runs automatically via `postinstall` in `package.json`.
- **4 new config fields** in `ltm.*`:
  - `gitLearnEnabled` (boolean, default: `false`)
  - `gitLearnMinDiffChars` (number, default: `200`)
  - `gitLearnFileFilter` (string[], default: `[]`)
  - `gitLearnIgnorePatterns` (string[], default: `["package-lock.json","*.lock","dist/",".min.js"]`)
- **`.ltmignore` opt-out** — place a `.ltmignore` file in any repo root to skip git-learn extraction for that repo.

### Changed
- `EvaluateSession.ts` refactored to use shared `extractAndLearn()` from `hooks/lib/llmExtract.ts`.
- `scripts/install-wiring.ts` now wires global git hook dir (`~/.claude/hooks/git/post-commit`) and sets `git config --global core.hooksPath`.
- `bunfig.toml` — removed invalid `exclude` key; test exclusion handled via `--path-ignore-patterns` in `bun run test`.

---

## [1.1.0] — 2026-03-21

### Added
- ASCII architecture diagrams in README.
- 12 LTM slash commands added to plugin (`skills/`).
- `CLAUDE_PLUGIN_DATA` support for db path isolation per marketplace install.
- `scripts/install-wiring.ts` — replaces Python subprocess in `install.sh`.
- Migration: copies existing `openltm.db` from legacy path on marketplace install.

---

## [1.0.0] — 2026-03-15

### Added
- Initial release.
- SQLite LTM with FTS5 + semantic search via embeddings.
- MCP server (`src/mcp-server.ts`) with 7 tools: `ltm_recall`, `ltm_learn`, `ltm_forget`, `ltm_relate`, `ltm_context`, `ltm_context_items`, `ltm_graph`.
- Claude Code hooks: `SessionStart`, `Stop` (UpdateContext + EvaluateSession), `PreCompact`.
- Memory graph visualization server (`src/graph-server.ts`).
- `install.sh` — safe idempotent installer (never overwrites `openltm.db`).
