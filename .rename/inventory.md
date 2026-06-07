# Rename Inventory — ltm → openltm / OpenLtm

Gitignored scratch. Source of truth for the rename. Cross-checked against 2 OpenCode scans.

## Target mapping

| Thing | Old | New |
|-------|-----|-----|
| Plugin name (`plugin.json`) | `ltm` | `openltm` |
| Marketplace name (`marketplace.json` name) | `ltm` | `OpenLtm` |
| Marketplace plugin entry name | `ltm` | `openltm` |
| MCP server self-name (`src/mcp-server.ts`) | `ltm` | `openltm` |
| MCP tool prefix | `mcp__plugin_ltm_memory__` | `mcp__plugin_openltm_memory__` |
| GitHub repo / slug | `RohiRIK/claude-ltm-plugin` | `RohiRIK/OpenLtm` |
| package.json name | `openltm` (already) | — no change |
| MCP server key | `memory` | — no change |

## Group A — Identity literals (manual, exact)

| File:line | Old | New |
|-----------|-----|-----|
| `.claude-plugin/plugin.json:2` | `"name": "ltm"` | `"name": "openltm"` |
| `.claude-plugin/marketplace.json:2` | `"name": "ltm"` | `"name": "OpenLtm"` |
| `.claude-plugin/marketplace.json:13` | `"name": "ltm"` | `"name": "openltm"` |
| `src/mcp-server.ts:50` | `{ name: "ltm", version: "1.0.0" }` | `{ name: "openltm", ... }` |

## Group B — MCP prefix `mcp__plugin_ltm_memory__` → `mcp__plugin_openltm_memory__`

### Repo (31 hits / 13 files)
| File | Count |
|------|-------|
| CHANGELOG.md | 2 |
| agents/git-learner.md | 3 |
| commands/admin.md | 1 |
| commands/analyze-context.md | 4 |
| commands/memory.md | 5 |
| commands/project.md | 2 |
| docs/UX-SPEC.md | 1 |
| hooks/src/SessionStart.ts | 1 |
| scripts/install-wiring.ts | 2 |
| skills/GitLearn/SKILL.md | 2 |
| skills/Learned/SKILL.md | 2 |
| skills/Ltm/SKILL.md | 1 |
| skills/Spec/Workflows/ExploreAndSpec.md | 4 |

### Global ~/.claude (6 hits / 3 files)
| File | Count |
|------|-------|
| settings.json | 1 (permission `mcp__plugin_ltm_memory`) |
| CLAUDE.md | 3 |
| rules/session-context.md | 2 |

> NOTE: global `skills/Spec/Workflows/ExploreAndSpec.md` uses the OLD broken `mcp__plugin_ltm_ltm__ltm_recall`, not this prefix — and user said leave global Spec original untouched. OUT OF SCOPE.
> NOTE: global `docs/LTM_MIGRATION.md`, `CHANGELOG.md` matched a broader `plugin_ltm_`/`ltm@ltm` pattern, not this exact prefix — review separately, low priority.

## Group C — Repo slug `claude-ltm-plugin` → `OpenLtm`

### Repo (29 hits / 13 files)
| File | Count | Notes |
|------|-------|-------|
| README.md | 4 | marketplace add + clone + issues urls |
| bun.lock | 1 | DO NOT hand-edit — regenerate via `bun install` |
| docs/FRONTEND-REDESIGN-2026-06.md | 7 | docs |
| docs/UX-SPEC.md | 5 | docs |
| docs/llm-migration-guide.md | 1 | marketplace add url |
| docs/migration.md | 1 | marketplace add url |
| graph-app/app/settings/about/page.tsx | 1 | feedbackUrl |
| hooks/src/SessionStart.ts | 1 | `LTM_REPO_SLUG = "RohiRIK/claude-ltm-plugin"` |
| install.sh | 4 | clone urls + header comments |
| packages/adapter-opencode/package.json | 1 | repo url |
| packages/adapter-pi/package.json | 1 | repo url |
| packages/ltm-core/package.json | 1 | repo url |
| scripts/install-wiring.ts | 2 | runtime wiring |

## Group D — Runtime / registry / external (not file edits)

- [ ] git remote `origin` URL → `https://github.com/RohiRIK/OpenLtm.git`
- [ ] GitHub repo rename `claude-ltm-plugin` → `OpenLtm` (gh) — auto-redirects old URL
- [ ] `~/.claude/settings.json` → `extraKnownMarketplaces.ltm` key + source url; `enabledPlugins["ltm@ltm"]`
- [ ] `~/.claude/plugins/known_marketplaces.json` → `ltm` entry + installLocation
- [ ] `~/.claude/plugins/installed_plugins.json` → `ltm@ltm` key + installPath (reinstall regenerates)
- [ ] local marketplace clone dir `~/.claude/plugins/marketplaces/ltm` + cache `~/.claude/plugins/cache/ltm/`
- [ ] reinstall: `claude plugin marketplace add` new url → `claude plugin install openltm@OpenLtm`

## Group E — Internal "ltm" identifiers (surfaced by DeepSeek scan — SCOPE DECISION NEEDED)

These are `"ltm"` strings that are NOT the plugin/marketplace identity or MCP prefix. Three sub-roles:

### E1 — Internal namespaces (RECOMMEND: leave as-is — no user impact, risky to migrate)
| File:line | Role | Why leave |
|-----------|------|-----------|
| `src/config.ts:95,127` + `packages/ltm-core/src/config.ts:95,127` | config key `raw["ltm"]` (ltm.decayEnabled, injectTopN…) | config-file schema namespace; writer+reader+existing config files must change together |
| `packages/ltm-core/src/events/index.ts:19` | `LTM_CHANNEL = "ltm"` (PG LISTEN/NOTIFY) | both sides use it; internal only |
| `src/mcp-server.ts:226` | `logger: "ltm"` | cosmetic log label |
| `packages/ltm-core/src/cli/_shared.ts:46` | comment example | cosmetic |

### E2 — Standalone npm/CLI distribution (`@rohirik/ltm-core` + Pi/OpenCode adapters) — SEPARATE PRODUCT SURFACE
| File:line | Role | Impact if renamed plugin but NOT this |
|-----------|------|----------------------------------------|
| `packages/ltm-core/src/cli/claude.ts:16` | `MCP_NAME = "ltm"` (CLI-install mcpServers key + tool prefix) | CLI (non-plugin) install keeps `mcp__ltm__` prefix |
| `packages/adapter-pi/src/index.ts:47` | hardcoded cache path `cache/ltm/ltm` | **BREAKS Pi adapter** — plugin cache dir becomes `cache/OpenLtm/openltm` after rename |
| `packages/*/package.json` | npm package names `@rohirik/ltm-core` etc. | npm identity unchanged |

## Cross-check status
- [x] DeepSeek scan — DONE. B=30, C=29 (matches me); +surfaced Group E (config key, MCP_NAME, cache path, PG channel)
- [ ] Nemotron scan — re-running with `--dangerously-skip-permissions` (first run auto-rejected all bash)
- [ ] Reconciled — pending Nemotron + user scope decision on Group E

## Open scope decision (BEFORE executing)
- **Group A+B+C** = the rename the user asked for (plugin identity, MCP prefix, repo slug). DO.
- **Group E1** = internal namespaces. RECOMMEND leave.
- **Group E2** = npm/CLI + Pi adapter. Decision: rename too (full consistency, Pi keeps working) OR leave (plugin-only rename, Pi adapter path breaks)?
