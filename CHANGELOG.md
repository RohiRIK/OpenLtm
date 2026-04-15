# Changelog

## [1.4.17] — 2026-04-15

### Added
- **`/ltm:memory` command** — Grouped routing for `recall | learn | forget | relate`. Replaces the 4 flat commands with a single entry point; flat commands kept as unchanged aliases.
- **`/ltm:project` command** — Grouped routing for `init | analyze | register`. Embeds full logic from `init-context`, `analyze-context`, `register-project`.
- **`/ltm:admin` command** — Grouped routing for `migrate | scan | server`. Includes all migrate flags, secrets scan, and server management.
- **`--save-context` flag on `/ltm:learn`** — Stores memory AND writes to `context_items` table in one shot. Replaces the need for separate `/ltm:capture` calls.
- **Legacy DB detection in `/ltm:migrate`** — Automatically checks for `~/.claude/memory/ltm.db` on `status` runs; `--legacy` flag triggers migration.

### Changed
- **`/ltm:health`** — Now shows graph server project scores (if running) AND inline memory decay summary from local DB. Graph server is optional — decay section always renders.
- **`/ltm:doctor`** — Now runs both `pluginDoctor.ts` (plugin health) and `hookDoctor.ts` (hook health) in a single command. Replaces the need for `/ltm:hook-doctor`.

### Fixed
- **`/ltm:secrets-scan`** — Fixed `secretsScrubber.js` import → `secretsScrubber.ts`. Previous `.js` extension caused a runtime error since Bun runs `.ts` directly.
- **Added auto-scrub note** to `secrets-scan` and `admin scan` — clarifies that new memories are already scrubbed on write via `db.ts:263`; this command patches existing memories only.

### Deprecated (removing in v1.6.0)
- `/ltm:hook-doctor` → use `/ltm:doctor`
- `/ltm:migrate-db` → use `/ltm:migrate --legacy` or `/ltm:admin migrate --legacy`
- `/ltm:capture` → use `/ltm:learn --save-context` or `/ltm:memory learn --save-context`
- `/ltm:decay-report` → use `/ltm:health`

---

## [1.4.15] — 2026-04-14

### Added
- **`/ltm:doctor` command** — Unified plugin health check covering 9 areas: version consistency, bun runtime, database integrity + migrations, MCP registration, hooks.json source files + log error counts, settings.json hooks, stale executables (exit 127 source), marketplace source, and plugin.json forbidden fields. Output: ✅/❌/🟡/🔴 per check with `→` remediation and final N passed/M failed summary.
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
- **LLM migration guide** — use `~/.claude/plugins/data/ltm-*/ltm.db` instead of `$CLAUDE_PLUGIN_DATA` (env var is only set inside plugin runtime, not in user shells).

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
- **`/migrate-db` command** — check and migrate `ltm.db` from legacy `~/.claude/memory/` to marketplace plugin data directory.
- **Auto git-fetch** on SessionStart — marketplace clone stays current without manual pulls.
- **Self-healing GitHub source** — `install-wiring.ts` patches `known_marketplaces.json` to `"source":"github"` on every postinstall, preventing the plugin system from reverting to `"git"` source.

### Fixed
- DB path migration fix — ensures `ltm.db` is always found at the correct marketplace data path.
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
- Migration: copies existing `ltm.db` from legacy path on marketplace install.

---

## [1.0.0] — 2026-03-15

### Added
- Initial release.
- SQLite LTM with FTS5 + semantic search via embeddings.
- MCP server (`src/mcp-server.ts`) with 7 tools: `ltm_recall`, `ltm_learn`, `ltm_forget`, `ltm_relate`, `ltm_context`, `ltm_context_items`, `ltm_graph`.
- Claude Code hooks: `SessionStart`, `Stop` (UpdateContext + EvaluateSession), `PreCompact`.
- Memory graph visualization server (`src/graph-server.ts`).
- `install.sh` — safe idempotent installer (never overwrites `ltm.db`).
