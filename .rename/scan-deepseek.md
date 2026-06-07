[93m[1m! [0m agent "plan" is a subagent, not a primary agent. Falling back to default agent
[0m
> Sisyphus (Ultraworker) · deepseek-v4-flash-free
[0m
[0m• [0mSearch mcp__plugin_ltm_memory[90m Explore Agent[0m
[0m✓ [0mSearch mcp__plugin_ltm_memory[90m Explore Agent[0m
[0m• [0mSearch claude-ltm-plugin[90m Explore Agent[0m
[0m✓ [0mSearch claude-ltm-plugin[90m Explore Agent[0m
[0m• [0mSearch "ltm" in key files[90m Explore Agent[0m
[0m✓ [0mSearch "ltm" in key files[90m Explore Agent[0m
[0m✱ [0mGrep "mcp__plugin_ltm_memory"[90m in .[0m
[0m✱ [0mGrep "claude-ltm-plugin"[90m in .[0m
[0m✱ [0mGrep ""ltm""[90m in .[0m
[0m→ [0mRead .claude-plugin
[0m✱ [0mGrep ""ltm""[90m in .claude-plugin[0m
[0m✱ [0mGrep ""ltm""[90m in src/mcp-server.ts[0m
[0m✱ [0mGrep ""ltm""[90m in src/config.ts[0m
Direct grep already captured everything. Let me verify the specific marketplace files for the standalone `"ltm"` identifier, and also grab the key files the user asked about.
[0m→ [0mRead .claude-plugin/plugin.json
[0m→ [0mRead .claude-plugin/marketplace.json
All data collected. Here is the exhaustive results table:

---

## Complete Token Reference Scan

### Token 1: `mcp__plugin_ltm_memory`

| token | file | line | matched-text |
|-------|------|------|-------------|
| `mcp__plugin_ltm_memory` | docs/UX-SPEC.md | 122 | Claude calls `mcp__plugin_ltm_memory__recall` per CLAUDE.md instructions |
| `mcp__plugin_ltm_memory` | agents/git-learner.md | 4 | tools: Bash, Read, Grep, mcp__plugin_ltm_memory__learn, mcp__plugin_ltm_memory__recall |
| `mcp__plugin_ltm_memory` | agents/git-learner.md | 37 | call `mcp__plugin_ltm_memory__learn` (see Storage) |
| `mcp__plugin_ltm_memory` | agents/git-learner.md | 66 | Call `mcp__plugin_ltm_memory__learn` once per learning |
| `mcp__plugin_ltm_memory` | commands/memory.md | 36 | Call `mcp__plugin_ltm_memory__recall` with parsed args |
| `mcp__plugin_ltm_memory` | commands/memory.md | 53 | Store a memory via `mcp__plugin_ltm_memory__learn` |
| `mcp__plugin_ltm_memory` | commands/memory.md | 89 | `mcp__plugin_ltm_memory__recall` with the ID |
| `mcp__plugin_ltm_memory` | commands/memory.md | 92 | Call `mcp__plugin_ltm_memory__forget` with `{ id }` |
| `mcp__plugin_ltm_memory` | commands/memory.md | 101 | Call `mcp__plugin_ltm_memory__relate` with `{ source_id, target_id, relationship_type }` |
| `mcp__plugin_ltm_memory` | commands/project.md | 75 | Call `mcp__plugin_ltm_memory__context(project="<project>")` |
| `mcp__plugin_ltm_memory` | commands/project.md | 80 | Call `mcp__plugin_ltm_memory__recall(query="<topic>")` |
| `mcp__plugin_ltm_memory` | commands/admin.md | 104 | Call `mcp__plugin_ltm_memory__admin_audit` with the provided filters |
| `mcp__plugin_ltm_memory` | commands/analyze-context.md | 3 | allowed-tools: ["mcp__plugin_ltm_memory__context", "mcp__plugin_ltm_memory__recall"] |
| `mcp__plugin_ltm_memory` | commands/analyze-context.md | 23 | Call `mcp__plugin_ltm_memory__context(project="<project>")` |
| `mcp__plugin_ltm_memory` | commands/analyze-context.md | 29 | call `mcp__plugin_ltm_memory__recall(query="<topic>", project="<project>")` |
| `mcp__plugin_ltm_memory` | commands/analyze-context.md | 30 | call `mcp__plugin_ltm_memory__recall(project="<project>", limit=5)` |
| `mcp__plugin_ltm_memory` | skills/Spec/Workflows/ExploreAndSpec.md | 11 | `mcp__plugin_ltm_memory__recall` with the feature topic |
| `mcp__plugin_ltm_memory` | skills/Spec/Workflows/ExploreAndSpec.md | 12 | `mcp__plugin_ltm_memory__context` with the project name |
| `mcp__plugin_ltm_memory` | skills/Spec/Workflows/ExploreAndSpec.md | 48 | `mcp__plugin_ltm_memory__learn` (category `constraint` or `architecture`) |
| `mcp__plugin_ltm_memory` | skills/Spec/Workflows/ExploreAndSpec.md | 49 | `mcp__plugin_ltm_memory__relate` to link the new memory |
| `mcp__plugin_ltm_memory` | skills/Ltm/SKILL.md | 12 | server key `memory`. Each called as `mcp__plugin_ltm_memory__<name>` |
| `mcp__plugin_ltm_memory` | skills/Learned/SKILL.md | 24 | query them with `mcp__plugin_ltm_memory__recall` |
| `mcp__plugin_ltm_memory` | skills/Learned/SKILL.md | 29 | `mcp__plugin_ltm_memory__recall` when you need exact reasoning |
| `mcp__plugin_ltm_memory` | skills/GitLearn/SKILL.md | 72 | `mcp__plugin_ltm_memory__recall` |
| `mcp__plugin_ltm_memory` | skills/GitLearn/SKILL.md | 76 | `mcp__plugin_ltm_memory__recall query="git commit patterns"` |
| `mcp__plugin_ltm_memory` | CHANGELOG.md | 15 | adds `mcp__plugin_ltm_memory` to `permissions.allow` |
| `mcp__plugin_ltm_memory` | CHANGELOG.md | 36 | references to renamed `mcp__plugin_ltm_ltm__ltm_learn` eliminated (canonical is `mcp__plugin_ltm_memory__learn`) |
| `mcp__plugin_ltm_memory` | scripts/install-wiring.ts | 72 | MCP tools registered as mcp__plugin_ltm_memory__<tool> |
| `mcp__plugin_ltm_memory` | scripts/install-wiring.ts | 76 | const LTM_MCP_RULE = "mcp__plugin_ltm_memory" |
| `mcp__plugin_ltm_memory` | hooks/src/SessionStart.ts | 21 | use mcp__plugin_ltm_memory__recall before tasks, mcp__plugin_ltm_memory__learn after discoveries |

**Total: 30 occurrences across 13 files** (all listed above, none collapsed)

---

### Token 2: `claude-ltm-plugin`

| token | file | line | matched-text |
|-------|------|------|-------------|
| `claude-ltm-plugin` | scripts/install-wiring.ts | 208 | ltm.source.url?.includes("RohiRIK/claude-ltm-plugin") |
| `claude-ltm-plugin` | scripts/install-wiring.ts | 209 | repo: "RohiRIK/claude-ltm-plugin" |
| `claude-ltm-plugin` | hooks/src/SessionStart.ts | 22 | const LTM_REPO_SLUG = "RohiRIK/claude-ltm-plugin" |
| `claude-ltm-plugin` | install.sh | 2 | # claude-ltm-plugin installer (dev/git-clone flow) |
| `claude-ltm-plugin` | install.sh | 7 | git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin |
| `claude-ltm-plugin` | install.sh | 8 | cd ~/Projects/claude-ltm-plugin && bash install.sh |
| `claude-ltm-plugin` | install.sh | 15 | echo "claude-ltm-plugin installer" |
| `claude-ltm-plugin` | README.md | 51 | https://github.com/RohiRIK/claude-ltm-plugin |
| `claude-ltm-plugin` | README.md | 68 | https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin |
| `claude-ltm-plugin` | README.md | 69 | cd ~/Projects/claude-ltm-plugin && bash install.sh |
| `claude-ltm-plugin` | README.md | 140 | https://github.com/RohiRIK/claude-ltm-plugin/issues |
| `claude-ltm-plugin` | docs/UX-SPEC.md | 190 | Project: claude-ltm-plugin |
| `claude-ltm-plugin` | docs/UX-SPEC.md | 918 | ~/projects/claude-ltm-plugin |
| `claude-ltm-plugin` | docs/UX-SPEC.md | 926 | ✓ claude-ltm-plugin |
| `claude-ltm-plugin` | docs/UX-SPEC.md | 931 | claude-ltm-plugin > "Ship magnificent LTM by Q3" |
| `claude-ltm-plugin` | docs/UX-SPEC.md | 941 | claude-ltm-plugin: scanning 247 commits… |
| `claude-ltm-plugin` | docs/llm-migration-guide.md | 36 | https://github.com/RohiRIK/claude-ltm-plugin |
| `claude-ltm-plugin` | docs/migration.md | 10 | https://github.com/RohiRIK/claude-ltm-plugin |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 47 | [⌥ claude-ltm-plugin ▾] |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 91 | a topic ("claude-ltm-plugin", "ai-soc-assistant", ...) |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 121 | "claude-ltm-plugin · 82/100 · 🟢" |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 191 | [⌥ claude-ltm-plugin ▾] |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 197 | when you're "in" claude-ltm-plugin |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 226 | "claude-ltm-plugin internals" |
| `claude-ltm-plugin` | docs/FRONTEND-REDESIGN-2026-06.md | 407 | The project "claude-ltm-plugin" might want 25 |
| `claude-ltm-plugin` | packages/ltm-core/package.json | 16 | https://github.com/RohiRIK/claude-ltm-plugin |
| `claude-ltm-plugin` | packages/adapter-pi/package.json | 27 | https://github.com/RohiRIK/claude-ltm-plugin |
| `claude-ltm-plugin` | packages/adapter-opencode/package.json | 16 | https://github.com/RohiRIK/claude-ltm-plugin |
| `claude-ltm-plugin` | graph-app/app/settings/about/page.tsx | 29 | https://github.com/RohiRIK/claude-ltm-plugin/issues |

**Total: 29 occurrences across 13 files** (bun.lock line 6 excluded per instruction — it also contains the name)

---

### Token 3: `"ltm"` as plugin/marketplace identifier

| token | file | line | matched-text |
|-------|------|------|-------------|
| `"ltm"` | .claude-plugin/plugin.json | 2 | `"name": "ltm",` |
| `"ltm"` | .claude-plugin/marketplace.json | 2 | `"name": "ltm",` |
| `"ltm"` | .claude-plugin/marketplace.json | 13 | `"name": "ltm",` |
| `"ltm"` | .claude-plugin/marketplace.json | 23 | `"ltm"` (in `"keywords"` array) |
| `"ltm"` | src/mcp-server.ts | 50 | `{ name: "ltm", version: "1.0.0" }` |
| `"ltm"` | src/mcp-server.ts | 127 | `logger: "ltm"` |
| `"ltm"` | src/mcp-server.ts | 226 | `logger: "ltm"` |
| `"ltm"` | src/config.ts | 95 | `raw["ltm"]` |
| `"ltm"` | src/config.ts | 127 | `(raw["ltm"] ?? {})` |

**Total: 9 occurrences across 4 specified files** (additional `"ltm"` hits beyond these files exist in packages/ subdirs — e.g. `packages/ltm-core/src/events/index.ts:19`, `packages/ltm-core/src/cli/claude.ts:16`, etc. — but those are internal references, not the plugin/marketplace identifier; list above covers the 3 files explicitly asked for, plus `src/config.ts` which also configures the `"ltm"` key).

---

### Summary

| Token | Total Hits | Files |
|-------|-----------|-------|
| `mcp__plugin_ltm_memory` | **30** | 13 |
| `claude-ltm-plugin` | **29** (+1 in bun.lock) | 13 |
| `"ltm"` as identifier | **9** (in 4 requested files) | 4 |
