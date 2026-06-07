[0m
> Sisyphus (Ultraworker) · nemotron-3-ultra-free
[0m
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n "mcp__plugin_ltm_memory" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" .
./agents/git-learner.md:4:tools: Bash, Read, Grep, mcp__plugin_ltm_memory__learn, mcp__plugin_ltm_memory__recall
./agents/git-learner.md:37:3. For each kept learning, call `mcp__plugin_ltm_memory__learn` (see Storage).
./agents/git-learner.md:66:Call `mcp__plugin_ltm_memory__learn` once per learning with:
./CHANGELOG.md:15:- **Auto-allow the LTM MCP server on install** — `scripts/install-wiring.ts` adds `mcp__plugin_ltm_memory` to `permissions.allow` in `~/.claude/settings.json` idempotently (dev and marketplace installs). The plugin's MCP tools (`recall`, `learn`, `forget`, `relate`, `context`, `context_items`, `graph`) no longer prompt on every call; the action is logged, not silent.
./CHANGELOG.md:36:- **Stale MCP tool name in learned-pattern records** — references to the renamed `mcp__plugin_ltm_ltm__ltm_learn` eliminated (canonical is `mcp__plugin_ltm_memory__learn`).
./commands/project.md:75:Call `mcp__plugin_ltm_memory__context(project="<project>")`.
./commands/project.md:80:Call `mcp__plugin_ltm_memory__recall(query="<topic>")`.
./commands/memory.md:36:Search LTM memories. Call `mcp__plugin_ltm_memory__recall` with parsed args:
./commands/memory.md:53:Store a memory via `mcp__plugin_ltm_memory__learn`. Parse args:
./commands/memory.md:89:1. Recall the memory to show what will be deleted: `mcp__plugin_ltm_memory__recall` with the ID or a targeted query.
./commands/memory.md:92:4. Call `mcp__plugin_ltm_memory__forget` with `{ id }`.
./commands/memory.md:101:Call `mcp__plugin_ltm_memory__relate` with `{ source_id, target_id, relationship_type }`.
./commands/analyze-context.md:3:allowed-tools: ["mcp__plugin_ltm_memory__context", "mcp__plugin_ltm_memory__recall"]
./commands/analyze-context.md:23:Call `mcp__plugin_ltm_memory__context(project="<project>")`.
./commands/analyze-context.md:29:If a `[topic]` was given, call `mcp__plugin_ltm_memory__recall(query="<topic>", project="<project>")`.
./commands/analyze-context.md:30:If no topic, call `mcp__plugin_ltm_memory__recall(project="<project>", limit=5)` to surface the top recent memories.
./skills/Ltm/SKILL.md:12:Plugin `ltm`, server key `memory`. In Claude Code each is called as `mcp__plugin_ltm_memory__<name>`.
./commands/admin.md:104:Call `mcp__plugin_ltm_memory__admin_audit` with the provided filters and display the result as a table:
./skills/GitLearn/SKILL.md:72:`mcp__plugin_ltm_memory__recall`.
./skills/GitLearn/SKILL.md:76:- Before: `mcp__plugin_ltm_memory__recall query="git commit patterns"` — check what's
./skills/Learned/SKILL.md:24:- Durable patterns also live in the LTM database — query them with `mcp__plugin_ltm_memory__recall`.
./skills/Learned/SKILL.md:29:- Recall from LTM (`mcp__plugin_ltm_memory__recall`) when you need the exact reasoning, gotcha, or implementation detail behind a past decision.
./skills/Spec/Workflows/ExploreAndSpec.md:11:- `mcp__plugin_ltm_memory__recall` with the feature topic — surfaces prior architecture decisions, gotchas, and patterns while reasoning is still forming. Use a natural-language query, not bare keywords.
./skills/Spec/Workflows/ExploreAndSpec.md:12:- `mcp__plugin_ltm_memory__context` with the project name — restores existing goals, decisions, and gotchas for this project.
./skills/Spec/Workflows/ExploreAndSpec.md:48:- Durable constraint surfaced during speccing → `mcp__plugin_ltm_memory__learn` (category `constraint` or `architecture`).
./skills/Spec/Workflows/ExploreAndSpec.md:49:- Spec builds on a prior decision → `mcp__plugin_ltm_memory__relate` to link the new memory to that decision (`depends_on` / `refines`).
./hooks/src/SessionStart.ts:21:const LTM_REMINDER     = "⚡ LTM MCP live — use mcp__plugin_ltm_memory__recall before tasks, mcp__plugin_ltm_memory__learn after discoveries.\n";
./docs/UX-SPEC.md:122:| **Trigger** | Manual (user types) OR Claude calls `mcp__plugin_ltm_memory__recall` per CLAUDE.md instructions. |
./scripts/install-wiring.ts:72:// MCP tools are registered as mcp__plugin_ltm_memory__<tool> (recall, learn,
./scripts/install-wiring.ts:76:const LTM_MCP_RULE = "mcp__plugin_ltm_memory";
[0m
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n "claude-ltm-plugin" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" .
./install.sh:2:# claude-ltm-plugin installer (dev/git-clone flow)
./install.sh:7:#   git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin
./install.sh:8:#   cd ~/Projects/claude-ltm-plugin && bash install.sh
./install.sh:15:echo "claude-ltm-plugin installer"
./README.md:51:claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin
./README.md:68:git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin
./README.md:69:cd ~/Projects/claude-ltm-plugin && bash install.sh
./README.md:140:[Report a Bug](https://github.com/RohiRIK/claude-ltm-plugin/issues)
./scripts/install-wiring.ts:208:  if (ltm?.source?.source === "git" && ltm.source.url?.includes("RohiRIK/claude-ltm-plugin")) {
./scripts/install-wiring.ts:209:    marketplaces.ltm.source = { source: "github", repo: "RohiRIK/claude-ltm-plugin" };
./docs/UX-SPEC.md:190:  Project: claude-ltm-plugin
./docs/UX-SPEC.md:918:       [x] ~/projects/claude-ltm-plugin
./docs/UX-SPEC.md:926:       ✓ claude-ltm-plugin
./docs/UX-SPEC.md:931:       claude-ltm-plugin > "Ship magnificent LTM by Q3"
./docs/UX-SPEC.md:941:       claude-ltm-plugin: scanning 247 commits…
./docs/llm-migration-guide.md:36:claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin
./docs/FRONTEND-REDESIGN-2026-06.md:47:│  [🧠 OpenLTM]  [⌥ claude-ltm-plugin ▾]   Projects  Graph  Inbox(3)  Settings  ···  [⌘K Search...]  ···  [● live · 82] [☾] │
./docs/FRONTEND-REDESIGN-2026-06.md:91:- **Bounded** — a folder, repo, or topic ("claude-ltm-plugin", "ai-soc-assistant", "general architecture").
./docs/FRONTEND-REDESIGN-2026-06.md:121:- **Project name + health chip** (e.g., "claude-ltm-plugin · 82/100 · 🟢")
./docs/FRONTEND-REDESIGN-2026-06.md:191:│  [🧠 OpenLTM]  [⌥ claude-ltm-plugin ▾]      Projects  Graph … │
./docs/FRONTEND-REDESIGN-2026-06.md:197:- **Memory injection scope follows this switcher** — when you're "in" claude-ltm-plugin, that project is the default scope for recall and graph
./docs/FRONTEND-REDESIGN-2026-06.md:226:- **Auto-clustered by topic** using the existing `clusters` API. Each cluster is labeled (e.g., "auth & RLS", "Bun tooling", "claude-ltm-plugin internals") with a colored hull.
./docs/FRONTEND-REDESIGN-2026-06.md:407:Example: Inject top N. The system default is 15. The project "claude-ltm-plugin" might want 25 (it has more memory). The user goes to that project's settings to override.
./hooks/src/SessionStart.ts:22:const LTM_REPO_SLUG    = "RohiRIK/claude-ltm-plugin";
./packages/adapter-pi/package.json:27:    "url": "https://github.com/RohiRIK/claude-ltm-plugin"
./docs/migration.md:10:claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin
./packages/adapter-opencode/package.json:16:    "url": "https://github.com/RohiRIK/claude-ltm-plugin"
./packages/ltm-core/package.json:16:    "url": "https://github.com/RohiRIK/claude-ltm-plugin"
./graph-app/app/settings/about/page.tsx:29:          feedbackUrl: "https://github.com/RohiRIK/claude-ltm-plugin/issues",
[0m
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n '"ltm"' --glob "*.ts" --glob "*.json" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" .
./src/config.ts:95:    const ltm = raw["ltm"] as Record<string, unknown> | undefined;
./src/config.ts:127:  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
./scripts/install-wiring.ts:90:const pluginCacheDir = join(CLAUDE_DIR, "plugins", "cache", "ltm");
./src/graph-server.ts:795:// Liveness: prefer Honker pub/sub push — the "ltm" channel drives broadcast()
./hooks/src/SessionStart.ts:127:    const ltm = data["ltm"] as Record<string, unknown> | undefined;
./hooks/src/SessionStart.ts:130:      data["ltm"] = { ...ltm, source: { source: "github", repo: LTM_REPO_SLUG } };
./src/mcp-server.ts:50:  { name: "ltm", version: "1.0.0" },
./src/mcp-server.ts:127:        params: { level: "info", logger: "ltm", data: `memory_stored: id=${result.id} category=${resolvedCategory}${categoriseSource ? ` (auto:${categoriseSource})` : ""} importance=${importance ?? 3} action=${result.action}` },
./src/mcp-server.ts:226:        params: { level: "info", logger: "ltm", data: `graph_traversal: nodes=${totalNodes} edges=${totalEdges} depth=${depth}` },
./hooks/src/GitCommit.ts:23:const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(CLAUDE_DIR, "plugins", "ltm");
./packages/ltm-core/src/events/index.ts:5: * loop drains `listen("ltm")` and hands each notification payload to the
./packages/ltm-core/src/events/index.ts:19:export const LTM_CHANNEL = "ltm";
./packages/ltm-core/src/events/index.ts:40: * Push a liveness event on the "ltm" channel. Returns false when Honker is
./packages/ltm-core/src/events/index.ts:56: * Start the "ltm" channel listen loop. Each notification's payload is passed to
./packages/ltm-core/src/config.ts:95:    const ltm = raw["ltm"] as Record<string, unknown> | undefined;
./packages/ltm-core/src/config.ts:127:  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
./packages/ltm-core/package.json:12:    "ltm": "./src/cli/bin.ts"
./packages/ltm-core/package.json:19:    "ltm",
./packages/adapter-pi/src/index.ts:47:  const cacheBase = join(homedir(), ".claude", "plugins", "cache", "ltm", "ltm");
./packages/adapter-pi/package.json:32:    "ltm",
./packages/ltm-core/src/cli/claude.ts:16:const MCP_NAME = "ltm";
./packages/ltm-core/src/cli/_shared.ts:46: * @param name     - Key under `mcpServers` (e.g. `"ltm"`).
./packages/adapter-opencode/package.json:20:    "ltm",
./packages/ltm-core/src/__tests__/events/index.test.ts:18:    expect(LTM_CHANNEL).toBe("ltm");
./packages/ltm-core/src/__tests__/cli/claude.test.ts:42:    expect(servers["ltm"]).toBeDefined();
./packages/ltm-core/src/__tests__/cli/claude.test.ts:75:    expect(servers["ltm"]).toBeDefined();
./packages/ltm-core/src/__tests__/cli/claude.test.ts:100:    const ltm = (s["mcpServers"] as Record<string, unknown>)["ltm"] as {
./packages/ltm-core/src/__tests__/cli/install.test.ts:156:    const ltm = (settings["mcpServers"] as Record<string, unknown>)["ltm"] as {

[Category+Skill Reminder]

**Built-in**: playwright, frontend-ui-ux, git-master, dev-browser, review-work, ai-slop-remover
**⚡ YOUR SKILLS (PRIORITY)**: StrategicCompact, TddWorkflow, BackendDesign, Test, Prompting, docker-patterns, Art, FrontendDesign (+15 more)

> User-installed skills OVERRIDE built-in defaults. ALWAYS prefer YOUR SKILLS when domain matches.

```typescript
task(category="visual-engineering", load_skills=["StrategicCompact"], run_in_background=true)
```
[0m
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n '\bltm\b' --glob "*.ts" --glob "*.json" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" . | head -200
./src/onboard.ts:19:import { getDb, upsertGoal, learn } from "@rohirik/ltm-core";
./src/onboard.ts:81:  const base = pluginDataDir ?? process.env.CLAUDE_PLUGIN_DATA ?? join(CLAUDE_DIR, "plugins", "data", "ltm-ltm");
./src/onboard.ts:206:      "    /ltm:memory recall <query>     — surface past decisions",
./src/onboard.ts:207:      "    /ltm:memory learn <insight>    — store a new insight",
./src/onboard.ts:208:      "    /ltm:health                    — check memory health",
./src/onboard.ts:209:      "    /ltm:memory propose            — review pending proposals",
./src/onboard.ts:212:      "  Run /ltm:doctor if context isn't injected.",
./scripts/migrate-db.ts:4: * Detects where ltm.db lives and migrates it to CLAUDE_PLUGIN_DATA if needed.
./scripts/migrate-db.ts:14:const legacyDb     = join(CLAUDE_DIR, "memory", "ltm.db");
./scripts/migrate-db.ts:30:  const targetDb = join(pluginData, "ltm.db");
./scripts/migrate-db.ts:54:    console.log(`✅ Fresh install — no legacy DB found. ltm.db will be created at:`);
./scripts/migrate-db.ts:68:  console.log(`✅ Fresh install — ltm.db will be created on first write.`);
./src/config.ts:51:  ltm: LtmConfig;
./src/config.ts:65:  ltm: {
./src/config.ts:95:    const ltm = raw["ltm"] as Record<string, unknown> | undefined;
./src/config.ts:96:    if (ltm) {
./src/config.ts:97:      if ("decayEnabled" in ltm && typeof ltm["decayEnabled"] !== "boolean") errors.push("ltm.decayEnabled: must be boolean");
./src/config.ts:98:      if ("injectTopN" in ltm && typeof ltm["injectTopN"] !== "number") errors.push("ltm.injectTopN: must be number");
./src/config.ts:99:      if ("autoRecall" in ltm && typeof ltm["autoRecall"] !== "boolean") errors.push("ltm.autoRecall: must be boolean");
./src/config.ts:100:      if ("graphReasoning" in ltm && typeof ltm["graphReasoning"] !== "boolean") errors.push("ltm.graphReasoning: must be boolean");
./src/config.ts:101:      if ("autoRelate" in ltm && typeof ltm["autoRelate"] !== "boolean") errors.push("ltm.autoRelate: must be boolean");
./src/config.ts:127:  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
./src/config.ts:139:    ltm: {
./src/config.ts:140:      dbPath: ltm.dbPath ?? DEFAULTS.ltm.dbPath,
./src/config.ts:141:      decayEnabled: ltm.decayEnabled ?? DEFAULTS.ltm.decayEnabled,
./src/config.ts:142:      injectTopN: ltm.injectTopN ?? DEFAULTS.ltm.injectTopN,
./src/config.ts:143:      autoRelate: ltm.autoRelate ?? DEFAULTS.ltm.autoRelate,
./src/config.ts:144:      graphReasoning: ltm.graphReasoning ?? DEFAULTS.ltm.graphReasoning,
./src/config.ts:145:      evaluateSessionLlm: ltm.evaluateSessionLlm ?? DEFAULTS.ltm.evaluateSessionLlm,
./src/config.ts:146:      semanticFallback: ltm.semanticFallback ?? DEFAULTS.ltm.semanticFallback,
./src/config.ts:147:      gitLearnEnabled: ltm.gitLearnEnabled ?? DEFAULTS.ltm.gitLearnEnabled,
./src/config.ts:148:      gitLearnMinDiffChars: ltm.gitLearnMinDiffChars ?? DEFAULTS.ltm.gitLearnMinDiffChars,
./src/config.ts:149:      gitLearnFileFilter: ltm.gitLearnFileFilter ?? DEFAULTS.ltm.gitLearnFileFilter,
./src/config.ts:150:      gitLearnIgnorePatterns: ltm.gitLearnIgnorePatterns ?? DEFAULTS.ltm.gitLearnIgnorePatterns,
./src/config.ts:151:      autoRecall: ltm.autoRecall ?? DEFAULTS.ltm.autoRecall,
./src/paths.ts:6: *  2. $CLAUDE_PLUGIN_DATA/ltm.db     → marketplace install (with auto-migrate from legacy)
./src/paths.ts:8: *     OR ~/.claude/config.json ltm.dbPath
./src/paths.ts:9: *  4. ~/.claude/memory/ltm.db        → dev / git-clone fallback
./src/paths.ts:30:    const targetDb = join(process.env.CLAUDE_PLUGIN_DATA, "ltm.db");
./src/paths.ts:31:    const legacyDb = join(CLAUDE_DIR, "memory", "ltm.db");
./src/paths.ts:42:  // 3b. Read from ~/.claude/config.json ltm.dbPath
./src/paths.ts:47:      if (config?.ltm?.dbPath) return config.ltm.dbPath;
./src/paths.ts:54:  return join(CLAUDE_DIR, "memory", "ltm.db");
./scripts/cleanup-bak.ts:5:import { enforceRetention, getRetentionDefault } from "../packages/ltm-core/src/migrations.js";
./scripts/cleanup-bak.ts:14:  --path <path>   Database path (default: \$LTM_DB_PATH or ./data/ltm.db).
./scripts/cleanup-bak.ts:70:  return join(import.meta.dir, "..", "data", "ltm.db");
./scripts/cleanup-bak.ts:77:    .filter((f) => f.startsWith("ltm.db.bak-"))
./src/graph-server.ts:26:} from "@rohirik/ltm-core";
./src/graph-server.ts:132:      const baseUrl = getSetting("ltm.ollama.baseUrl") || "http://localhost:11434";
./src/graph-server.ts:173:const PID_PATH = join(CLAUDE_DIR, "tmp", "ltm-server.pid");
./src/graph-server.ts:795:// Liveness: prefer Honker pub/sub push — the "ltm" channel drives broadcast()
./src/graph-server.ts:802:  // WAL writes go to ltm.db-wal, not ltm.db — watch the WAL file (or dir as
./src/mcp-server.ts:10:         queryAudit, getItems, traverseGraph, buildReasoningContext } from "@rohirik/ltm-core";
./src/mcp-server.ts:50:  { name: "ltm", version: "1.0.0" },
./src/mcp-server.ts:100:          import("@rohirik/ltm-core"),
./src/mcp-server.ts:127:        params: { level: "info", logger: "ltm", data: `memory_stored: id=${result.id} category=${resolvedCategory}${categoriseSource ? ` (auto:${categoriseSource})` : ""} importance=${importance ?? 3} action=${result.action}` },
./src/mcp-server.ts:226:        params: { level: "info", logger: "ltm", data: `graph_traversal: nodes=${totalNodes} edges=${totalEdges} depth=${depth}` },
./src/mcp-server.ts:416:  process.stderr.write(`[ltm-mcp] Unhandled rejection: ${err}\n`);
./src/mcp-server.ts:421:    process.stderr.write("[ltm-mcp] mcp.enabled=false — server disabled\n");
./src/mcp-server.ts:427:  process.stderr.write("[ltm-mcp] LTM MCP server running on stdio\n");
./src/mcp-server.ts:431:  process.stderr.write(`[ltm-mcp] Fatal: ${err}\n`);
./src/migrate.ts:21:const { addItem, exportContextMarkdown } = await import("@rohirik/ltm-core");
./src/migrate.ts:22:const { learn, exportMarkdown }          = await import("@rohirik/ltm-core");
./package.json:17:    "dev:server": "LTM_DB_PATH=./data/ltm.db bun run src/graph-server.ts",
./package.json:18:    "migrate": "LTM_DB_PATH=./data/ltm.db bun run src/migrate.ts",
./package.json:26:    "@rohirik/ltm-core": "workspace:*",
./packages/ltm-core/src/shared-db.ts:19:/** Configure ltm-core with host-specific paths. Call before first getDb(). */
./hooks/src/SessionStart.ts:11:         runPendingMigrations, getRecentConflicts, emitEvent } from "@rohirik/ltm-core";
./hooks/src/SessionStart.ts:22:const LTM_REPO_SLUG    = "RohiRIK/claude-ltm-plugin";
./hooks/src/SessionStart.ts:50:    if (cfg?.ltm?.graphReasoning) {
./hooks/src/SessionStart.ts:93:const BACKFILL_HINT_FILE = join(TMP_DIR, "ltm-backfill-hint.flag");
./hooks/src/SessionStart.ts:111:    return `\n💡 Embedding backfill: ${cfg.embeddings.provider} provider is configured but some memories lack embeddings. Run \`/ltm:admin backfill\` to enable semantic recall.\n`;
./hooks/src/SessionStart.ts:127:    const ltm = data["ltm"] as Record<string, unknown> | undefined;
./hooks/src/SessionStart.ts:128:    const src = ltm?.["source"] as Record<string, unknown> | undefined;
./hooks/src/SessionStart.ts:130:      data["ltm"] = { ...ltm, source: { source: "github", repo: LTM_REPO_SLUG } };
./hooks/src/SessionStart.ts:157:  const pluginData = process.env.CLAUDE_PLUGIN_DATA ?? join(CLAUDE_DIR, "plugins", "data", "ltm-ltm");
./hooks/src/SessionStart.ts:166:    process.stdout.write(`LTM: auto-onboarded "${displayName}" — run /ltm:onboard to customize\n`);
./hooks/src/SessionStart.ts:209:  try { const cfg = readConfigSync(); useDirective = cfg?.ltm?.autoRecall !== false; } catch (_) {} // silent: missing/malformed config falls back to default (autoRecall=true)
./hooks/src/SessionStart.ts:212:  const injectTopN = readConfigSync().ltm?.injectTopN ?? 15;
./hooks/src/SessionStart.ts:245:    process.stdout.write("**Context not restored:** hook_error (check /ltm:health)\n");
./src/__tests__/providers/disabled.test.ts:3:import { DisabledProvider, loadProvider } from "@rohirik/ltm-core";
./src/__tests__/proposals.test.ts:6:const TEST_DIR = join(tmpdir(), `ltm-proposals-test-${process.pid}`);
./src/__tests__/proposals.test.ts:12:const { listPendingProposals, acceptProposal, rejectProposal } = await import("@rohirik/ltm-core");
./src/__tests__/mcp-tools.test.ts:6:const dbPath = `/tmp/test-ltm-mcp-tools-${process.pid}-${Date.now()}.db`;
./src/__tests__/mcp-tools.test.ts:9:let learn: (input: import("@rohirik/ltm-core").LearnInput) => import("@rohirik/ltm-core").LearnResult;
./src/__tests__/mcp-tools.test.ts:10:let recall: (input?: import("@rohirik/ltm-core").RecallInput) => Promise<import("@rohirik/ltm-core").MemoryWithRelations[]>;
./src/__tests__/mcp-tools.test.ts:12:let relate: (input: { source_id: number; target_id: number; relationship_type: import("@rohirik/ltm-core").RelationshipType }) => void;
./src/__tests__/mcp-tools.test.ts:13:let getContextMerge: (project: string) => { globals: import("@rohirik/ltm-core").Memory[]; scoped: import("@rohirik/ltm-core").Memory[] };
./src/__tests__/mcp-tools.test.ts:16:  const { runPendingMigrations, _setDbForTesting } = await import("@rohirik/ltm-core");
./src/__tests__/mcp-tools.test.ts:24:  const mod = await import("@rohirik/ltm-core");
./scripts/verify-version-sync.ts:11: *   - packages/ltm-core/package.json      →  "version": "X.Y.Z"
./scripts/verify-version-sync.ts:53:    file: "packages/ltm-core/package.json",
./scripts/verify-version-sync.ts:56:    label: "packages/ltm-core",
./src/__tests__/recall/categorise.test.ts:3:import { categorise, type MemoryCategory } from "@rohirik/ltm-core";
./graph-app/package.json:2:  "name": "ltm-graph-app",
./scripts/install-wiring.ts:22:// Resolve plugin data dir: env var → scan ~/.claude/plugins/data/ltm-*
./scripts/install-wiring.ts:27:    const match = readdirSync(dataDir).find(d => d.startsWith("ltm-"));
./scripts/install-wiring.ts:33:  const targetDb  = join(pluginData, "ltm.db");
./scripts/install-wiring.ts:34:  const legacyDb  = join(CLAUDE_DIR, "memory", "ltm.db");
./scripts/install-wiring.ts:39:    console.log(`  ✔ Migrated ltm.db → ${targetDb}`);
./scripts/install-wiring.ts:41:    console.log("  ✔ Fresh install — ltm.db will be created on first run");
./scripts/install-wiring.ts:43:    console.log(`  ✔ ltm.db ready at ${targetDb}`);
./scripts/install-wiring.ts:53:  if (claude.mcpServers?.ltm) {
./scripts/install-wiring.ts:54:    delete claude.mcpServers.ltm;
./scripts/install-wiring.ts:56:    console.log("  ✔ Removed legacy ltm MCP entry from ~/.claude.json (now managed by plugin system)");
./scripts/install-wiring.ts:90:const pluginCacheDir = join(CLAUDE_DIR, "plugins", "cache", "ltm");
./scripts/install-wiring.ts:93:  && readdirSync(pluginDataDir).some(d => d.startsWith("ltm-"));
./scripts/install-wiring.ts:183:  console.log("  ℹ  Enable with: ltm.gitLearnEnabled=true in ~/.claude/config.json");
./scripts/install-wiring.ts:207:  const ltm = marketplaces.ltm;
./scripts/install-wiring.ts:208:  if (ltm?.source?.source === "git" && ltm.source.url?.includes("RohiRIK/claude-ltm-plugin")) {
./scripts/install-wiring.ts:209:    marketplaces.ltm.source = { source: "github", repo: "RohiRIK/claude-ltm-plugin" };
./scripts/install-wiring.ts:211:    console.log("  ✔ Switched ltm marketplace source to github (enables API-based update checks)");
./src/__tests__/integration/phase3.test.ts:16:const dbPath = `/tmp/test-ltm-phase3-int-${process.pid}-${Date.now()}.db`;
./src/__tests__/integration/phase3.test.ts:19:let learn: typeof import("@rohirik/ltm-core").learn;
./src/__tests__/integration/phase3.test.ts:20:let recall: typeof import("@rohirik/ltm-core").recall;
./src/__tests__/integration/phase3.test.ts:28:  const { _setDbForTesting } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase3.test.ts:31:  const { runPendingMigrations } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase3.test.ts:34:  const dbMod = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase3.test.ts:134:    const { categorise } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase3.test.ts:142:    const { categorise } = await import("@rohirik/ltm-core");
./packages/ltm-core/src/db.ts:20:let DOCS_DIR = join(tmpdir(), "ltm-docs");
./packages/ltm-core/src/db.ts:282:    if (readConfigSync().ltm?.autoRelate === false) return;
./packages/ltm-core/src/db.ts:411:  // unless the ltm.crossProcessSync flag is on AND Honker is available.
./packages/ltm-core/src/db.ts:448:      const semanticEnabled = cfg.ltm?.semanticFallback !== false; // default true
./packages/ltm-core/src/db.ts:686:  if (!readConfigSync().ltm?.graphReasoning) return base;
./src/__tests__/recall/explainer.test.ts:3:import { buildExplainer, computeTemperature } from "@rohirik/ltm-core";
./scripts/consolidate-db.ts:3: * consolidate-db.ts — CLI tool to detect, report, and merge duplicate ltm.db files.
./scripts/consolidate-db.ts:40:      label: "legacy (~/.claude/memory/ltm.db)",
./scripts/consolidate-db.ts:41:      path: join(HOME, ".claude", "memory", "ltm.db"),
./scripts/consolidate-db.ts:44:      label: "dev (data/ltm.db)",
./scripts/consolidate-db.ts:45:      path: join(import.meta.dir, "..", "data", "ltm.db"),
./scripts/consolidate-db.ts:204:    console.log("\n⚠  No ltm.db files found. Nothing to consolidate.");
./packages/ltm-core/src/embeddings.ts:33:      `ltm.${t}.provider`,
./packages/ltm-core/src/embeddings.ts:34:      "ltm.gemini.apiKey", `ltm.gemini.${t}Model`,
./packages/ltm-core/src/embeddings.ts:35:      "ltm.openai.apiKey", `ltm.openai.${t}Model`,
./packages/ltm-core/src/embeddings.ts:36:      "ltm.openrouter.apiKey", `ltm.openrouter.${t}Model`,
./packages/ltm-core/src/embeddings.ts:37:      `ltm.cohere.apiKey`, `ltm.cohere.${t}Model`,
./packages/ltm-core/src/embeddings.ts:38:      `ltm.ollama.${t}Model`, "ltm.ollama.baseUrl",
./packages/ltm-core/src/embeddings.ts:47:    const provider = (envProvider ?? s[`ltm.${t}.provider`] ?? "gemini") as EmbedProvider;
./packages/ltm-core/src/embeddings.ts:59:        return { provider, apiKey: process.env.GEMINI_API_KEY ?? s["ltm.gemini.apiKey"], model: s[`ltm.gemini.${t}Model`] ?? DEFAULTS.gemini.model };
./packages/ltm-core/src/embeddings.ts:61:        return { provider, apiKey: process.env.OPENAI_API_KEY ?? s["ltm.openai.apiKey"], model: s[`ltm.openai.${t}Model`] ?? DEFAULTS.openai.model };
./packages/ltm-core/src/embeddings.ts:63:        return { provider, apiKey: process.env.OPENROUTER_API_KEY ?? s["ltm.openrouter.apiKey"], model: s[`ltm.openrouter.${t}Model`] ?? DEFAULTS.openrouter.model, baseUrl: "https://openrouter.ai/api/v1" };
./packages/ltm-core/src/embeddings.ts:65:        return { provider, apiKey: process.env.COHERE_API_KEY ?? s["ltm.cohere.apiKey"], model: s[`ltm.cohere.${t}Model`] ?? DEFAULTS.cohere.model };
./packages/ltm-core/src/embeddings.ts:67:        return { provider, model: s[`ltm.ollama.${t}Model`] ?? DEFAULTS.ollama.model, baseUrl: s["ltm.ollama.baseUrl"] ?? "http://localhost:11434" };
./src/__tests__/writeQueue.test.ts:3:import { WriteQueue } from "@rohirik/ltm-core";
./src/__tests__/registry-lock.test.ts:7:const TEST_DIR = join(tmpdir(), `ltm-registry-lock-test-${process.pid}`);
./packages/ltm-core/src/migrations.ts:3: * migrations.ts — Versioned schema migration runner for ltm.db
./packages/ltm-core/src/migrations.ts:120: * Filenames are `ltm.db.bak-<ISO-timestamp>`. ISO timestamps sort lexically,
./packages/ltm-core/src/migrations.ts:142:  const files = readdirSync(dir).filter((f) => f.startsWith("ltm.db.bak-"));
./graph-app/lib/types.ts:232:  ltm: ClaudeLtmConfig;
./src/__tests__/auto-recall-config.test.ts:39:    const cfg = JSON.parse(new TextDecoder().decode(result.stdout)) as { ltm: { autoRecall: boolean } };
./src/__tests__/auto-recall-config.test.ts:40:    expect(cfg.ltm.autoRecall).toBe(true);
./src/__tests__/auto-recall-config.test.ts:50:      JSON.stringify({ ltm: { autoRecall: false } }, null, 2),
./src/__tests__/auto-recall-config.test.ts:56:    const cfg = JSON.parse(new TextDecoder().decode(result.stdout)) as { ltm: { autoRecall: boolean } };
./src/__tests__/auto-recall-config.test.ts:57:    expect(cfg.ltm.autoRecall).toBe(false);
./src/__tests__/auto-recall-config.test.ts:69:          ltm: {
./src/__tests__/auto-recall-config.test.ts:86:      ltm: { autoRecall: boolean; injectTopN: number; decayEnabled: boolean; gitLearnEnabled: boolean };
./src/__tests__/auto-recall-config.test.ts:90:    expect(cfg.ltm.autoRecall).toBe(false);
./src/__tests__/auto-recall-config.test.ts:91:    expect(cfg.ltm.injectTopN).toBe(7);
./src/__tests__/auto-recall-config.test.ts:92:    expect(cfg.ltm.decayEnabled).toBe(false);
./src/__tests__/auto-recall-config.test.ts:93:    expect(cfg.ltm.gitLearnEnabled).toBe(true);
./hooks/src/EvaluateSession.ts:13:import { emitEvent } from "@rohirik/ltm-core";
./hooks/src/EvaluateSession.ts:26:  ?? join(homedir(), ".claude", "plugins", "data", "ltm-ltm");
./hooks/src/EvaluateSession.ts:237:      if ((readConfigSync() as Config).ltm?.evaluateSessionLlm) {
./src/__tests__/dao/contextItems.test.ts:7:const dbPath = `/tmp/test-ltm-dao-${process.pid}-${Date.now()}.db`;
./src/__tests__/dao/contextItems.test.ts:11:let listByProject: typeof import("@rohirik/ltm-core").listByProject;
./src/__tests__/dao/contextItems.test.ts:12:let appendProgress: typeof import("@rohirik/ltm-core").appendProgress;
./src/__tests__/dao/contextItems.test.ts:13:let upsertGoal: typeof import("@rohirik/ltm-core").upsertGoal;
./src/__tests__/dao/contextItems.test.ts:14:let addDecision: typeof import("@rohirik/ltm-core").addDecision;
./src/__tests__/dao/contextItems.test.ts:15:let addGotcha: typeof import("@rohirik/ltm-core").addGotcha;
./src/__tests__/dao/contextItems.test.ts:16:let writeQueue: typeof import("@rohirik/ltm-core").writeQueue;
./src/__tests__/dao/contextItems.test.ts:25:  const { runPendingMigrations } = await import("@rohirik/ltm-core");
./src/__tests__/dao/contextItems.test.ts:26:  const { _setDbForTesting } = await import("@rohirik/ltm-core");
./src/__tests__/dao/contextItems.test.ts:36:  const dao = await import("@rohirik/ltm-core");
./src/__tests__/dao/contextItems.test.ts:37:  const wq = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase4.test.ts:16:const dbPath = `/tmp/test-ltm-phase4-int-${process.pid}-${Date.now()}.db`;
./src/__tests__/integration/phase4.test.ts:19:let learn: typeof import("@rohirik/ltm-core").learn;
./src/__tests__/integration/phase4.test.ts:20:let recall: typeof import("@rohirik/ltm-core").recall;
./src/__tests__/integration/phase4.test.ts:28:  const { _setDbForTesting } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase4.test.ts:31:  const { runPendingMigrations } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase4.test.ts:34:  const dbMod = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase4.test.ts:75:      "ltm.janitor.lastRunAt",
./src/__tests__/integration/phase4.test.ts:76:      "ltm.janitor.lastDecayRefreshed",
./src/__tests__/integration/phase4.test.ts:77:      "ltm.janitor.lastDeprecated",
./src/__tests__/integration/phase4.test.ts:78:      "ltm.janitor.lastArchived",
./src/__tests__/integration/phase4.test.ts:105:    const { runDecay } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase4.test.ts:134:    const { runDecay } = await import("@rohirik/ltm-core");
./src/__tests__/integration/phase4.test.ts:135:    const { runArchive } = await import("@rohirik/ltm-core");
./graph-app/lib/api.ts:170:    put("/config", { ltm: ltmPatch }),
./hooks/lib/hookLogger.ts:20:  /** Structured event name — present when level === "event". Consumed by /ltm:health. */
./hooks/lib/hookLogger.ts:85: * Events are aggregated by /ltm:health to show real activity counts.
./src/__tests__/dao/embeddings.test.ts:44:  const { _setDbForTesting, waitForInit } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:47:  const { runPendingMigrations } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:60:    const { getEmbedding } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:65:    const { getEmbedding, setEmbedding } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:76:    const { getEmbedding, setEmbedding } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:86:    const { setEmbedding } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:99:    const { getEmbedding, setEmbedding, deleteEmbedding } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:107:    const { deleteEmbedding } = await import("@rohirik/ltm-core");
./src/__tests__/dao/embeddings.test.ts:114:    const { listMemoryIdsMissingEmbedding, setEmbedding } = await import("@rohirik/ltm-core");
[0m
Now let me compile all results into the requested markdown table:
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n '"ltm"' --glob "*.json" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" .
./packages/ltm-core/package.json:12:    "ltm": "./src/cli/bin.ts"
./packages/ltm-core/package.json:19:    "ltm",
./packages/adapter-opencode/package.json:20:    "ltm",
./packages/adapter-pi/package.json:32:    "ltm",
[0m
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n '"ltm"' --glob "*.ts" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" . 2>/dev/null | wc -l
24
[0m
[0m$ [0mexport CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; rg -n '"ltm"' --glob "*.ts" --glob "!node_modules" --glob "!bun.lock" --glob "!.git" .
./src/mcp-server.ts:50:  { name: "ltm", version: "1.0.0" },
./src/mcp-server.ts:127:        params: { level: "info", logger: "ltm", data: `memory_stored: id=${result.id} category=${resolvedCategory}${categoriseSource ? ` (auto:${categoriseSource})` : ""} importance=${importance ?? 3} action=${result.action}` },
./src/mcp-server.ts:226:        params: { level: "info", logger: "ltm", data: `graph_traversal: nodes=${totalNodes} edges=${totalEdges} depth=${depth}` },
./src/config.ts:95:    const ltm = raw["ltm"] as Record<string, unknown> | undefined;
./src/config.ts:127:  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
./src/graph-server.ts:795:// Liveness: prefer Honker pub/sub push — the "ltm" channel drives broadcast()
./scripts/install-wiring.ts:90:const pluginCacheDir = join(CLAUDE_DIR, "plugins", "cache", "ltm");
./hooks/src/SessionStart.ts:127:    const ltm = data["ltm"] as Record<string, unknown> | undefined;
./hooks/src/SessionStart.ts:130:      data["ltm"] = { ...ltm, source: { source: "github", repo: LTM_REPO_SLUG } };
./packages/ltm-core/src/events/index.ts:5: * loop drains `listen("ltm")` and hands each notification payload to the
./packages/ltm-core/src/events/index.ts:19:export const LTM_CHANNEL = "ltm";
./packages/ltm-core/src/events/index.ts:40: * Push a liveness event on the "ltm" channel. Returns false when Honker is
./packages/ltm-core/src/events/index.ts:56: * Start the "ltm" channel listen loop. Each notification's payload is passed to
./hooks/src/GitCommit.ts:23:const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(CLAUDE_DIR, "plugins", "ltm");
./packages/ltm-core/src/config.ts:95:    const ltm = raw["ltm"] as Record<string, unknown> | undefined;
./packages/ltm-core/src/config.ts:127:  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
./packages/adapter-pi/src/index.ts:47:  const cacheBase = join(homedir(), ".claude", "plugins", "cache", "ltm", "ltm");
./packages/ltm-core/src/__tests__/events/index.test.ts:18:    expect(LTM_CHANNEL).toBe("ltm");
./packages/ltm-core/src/__tests__/cli/install.test.ts:156:    const ltm = (settings["mcpServers"] as Record<string, unknown>)["ltm"] as {
./packages/ltm-core/src/__tests__/cli/claude.test.ts:42:    expect(servers["ltm"]).toBeDefined();
./packages/ltm-core/src/__tests__/cli/claude.test.ts:75:    expect(servers["ltm"]).toBeDefined();
./packages/ltm-core/src/__tests__/cli/claude.test.ts:100:    const ltm = (s["mcpServers"] as Record<string, unknown>)["ltm"] as {
./packages/ltm-core/src/cli/_shared.ts:46: * @param name     - Key under `mcpServers` (e.g. `"ltm"`).
./packages/ltm-core/src/cli/claude.ts:16:const MCP_NAME = "ltm";
[0m
Now I have all the data. Compiling the comprehensive markdown table:

| token | file | line | matched-text |
|-------|------|------|--------------|
| mcp__plugin_ltm_memory | ./agents/git-learner.md | 4 | tools: Bash, Read, Grep, mcp__plugin_ltm_memory__learn, mcp__plugin_ltm_memory__recall |
| mcp__plugin_ltm_memory | ./agents/git-learner.md | 37 | 3. For each kept learning, call `mcp__plugin_ltm_memory__learn` (see Storage). |
| mcp__plugin_ltm_memory | ./agents/git-learner.md | 66 | Call `mcp__plugin_ltm_memory__learn` once per learning with: |
| mcp__plugin_ltm_memory | ./CHANGELOG.md | 15 | **Auto-allow the LTM MCP server on install** — `scripts/install-wiring.ts` adds `mcp__plugin_ltm_memory` to `permissions.allow` in `~/.claude/settings.json` idempotently (dev and marketplace installs). The plugin's MCP tools (`recall`, `learn`, `forget`, `relate`, `context`, `context_items`, `graph`) no longer prompt on every call; the action is logged, not silent. |
| mcp__plugin_ltm_memory | ./CHANGELOG.md | 36 | **Stale MCP tool name in learned-pattern records** — references to the renamed `mcp__plugin_ltm_ltm__ltm_learn` eliminated (canonical is `mcp__plugin_ltm_memory__learn`). |
| mcp__plugin_ltm_memory | ./commands/project.md | 75 | Call `mcp__plugin_ltm_memory__context(project="<project>")`. |
| mcp__plugin_ltm_memory | ./commands/project.md | 80 | Call `mcp__plugin_ltm_memory__recall(query="<topic>")`. |
| mcp__plugin_ltm_memory | ./commands/memory.md | 36 | Search LTM memories. Call `mcp__plugin_ltm_memory__recall` with parsed args: |
| mcp__plugin_ltm_memory | ./commands/memory.md | 53 | Store a memory via `mcp__plugin_ltm_memory__learn`. Parse args: |
| mcp__plugin_ltm_memory | ./commands/memory.md | 89 | 1. Recall the memory to show what will be deleted: `mcp__plugin_ltm_memory__recall` with the ID or a targeted query. |
| mcp__plugin_ltm_memory | ./commands/memory.md | 92 | 4. Call `mcp__plugin_ltm_memory__forget` with `{ id }`. |
| mcp__plugin_ltm_memory | ./commands/memory.md | 101 | Call `mcp__plugin_ltm_memory__relate` with `{ source_id, target_id, relationship_type }`. |
| mcp__plugin_ltm_memory | ./commands/analyze-context.md | 3 | allowed-tools: ["mcp__plugin_ltm_memory__context", "mcp__plugin_ltm_memory__recall"] |
| mcp__plugin_ltm_memory | ./commands/analyze-context.md | 23 | Call `mcp__plugin_ltm_memory__context(project="<project>")`. |
| mcp__plugin_ltm_memory | ./commands/analyze-context.md | 29 | If a `[topic]` was given, call `mcp__plugin_ltm_memory__recall(query="<topic>", project="<project>")`. |
| mcp__plugin_ltm_memory | ./commands/analyze-context.md | 30 | If no topic, call `mcp__plugin_ltm_memory__recall(project="<project>", limit=5)` to surface the top recent memories. |
| mcp__plugin_ltm_memory | ./skills/Ltm/SKILL.md | 12 | Plugin `ltm`, server key `memory`. In Claude Code each is called as `mcp__plugin_ltm_memory__<name>`. |
| mcp__plugin_ltm_memory | ./commands/admin.md | 104 | Call `mcp__plugin_ltm_memory__admin_audit` with the provided filters and display the result as a table: |
| mcp__plugin_ltm_memory | ./skills/GitLearn/SKILL.md | 72 | `mcp__plugin_ltm_memory__recall`. |
| mcp__plugin_ltm_memory | ./skills/GitLearn/SKILL.md | 76 | - Before: `mcp__plugin_ltm_memory__recall query="git commit patterns"` — check what's |
| mcp__plugin_ltm_memory | ./skills/Learned/SKILL.md | 24 | - Durable patterns also live in the LTM database — query them with `mcp__plugin_ltm_memory__recall`. |
| mcp__plugin_ltm_memory | ./skills/Learned/SKILL.md | 29 | - Recall from LTM (`mcp__plugin_ltm_memory__recall`) when you need the exact reasoning, gotcha, or implementation detail behind a past decision. |
| mcp__plugin_ltm_memory | ./skills/Spec/Workflows/ExploreAndSpec.md | 11 | - `mcp__plugin_ltm_memory__recall` with the feature topic — surfaces prior architecture decisions, gotchas, and patterns while reasoning is still forming. Use a natural-language query, not bare keywords. |
| mcp__plugin_ltm_memory | ./skills/Spec/Workflows/ExploreAndSpec.md | 12 | - `mcp__plugin_ltm_memory__context` with the project name — restores existing goals, decisions, and gotchas for this project. |
| mcp__plugin_ltm_memory | ./skills/Spec/Workflows/ExploreAndSpec.md | 48 | - Durable constraint surfaced during speccing → `mcp__plugin_ltm_memory__learn` (category `constraint` or `architecture`). |
| mcp__plugin_ltm_memory | ./skills/Spec/Workflows/ExploreAndSpec.md | 49 | - Spec builds on a prior decision → `mcp__plugin_ltm_memory__relate` to link the new memory to that decision (`depends_on` / `refines`). |
| mcp__plugin_ltm_memory | ./hooks/src/SessionStart.ts | 21 | const LTM_REMINDER     = "⚡ LTM MCP live — use mcp__plugin_ltm_memory__recall before tasks, mcp__plugin_ltm_memory__learn after discoveries.\n"; |
| mcp__plugin_ltm_memory | ./docs/UX-SPEC.md | 122 | | **Trigger** | Manual (user types) OR Claude calls `mcp__plugin_ltm_memory__recall` per CLAUDE.md instructions. | |
| mcp__plugin_ltm_memory | ./scripts/install-wiring.ts | 72 | // MCP tools are registered as mcp__plugin_ltm_memory__<tool> (recall, learn, |
| mcp__plugin_ltm_memory | ./scripts/install-wiring.ts | 76 | const LTM_MCP_RULE = "mcp__plugin_ltm_memory"; |
| claude-ltm-plugin | ./install.sh | 2 | # claude-ltm-plugin installer (dev/git-clone flow) |
| claude-ltm-plugin | ./install.sh | 7 | #   git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin |
| claude-ltm-plugin | ./install.sh | 8 | #   cd ~/Projects/claude-ltm-plugin && bash install.sh |
| claude-ltm-plugin | ./install.sh | 15 | echo "claude-ltm-plugin installer" |
| claude-ltm-plugin | ./README.md | 51 | claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin |
| claude-ltm-plugin | ./README.md | 68 | git clone https://github.com/RohiRIK/claude-ltm-plugin ~/Projects/claude-ltm-plugin |
| claude-ltm-plugin | ./README.md | 69 | cd ~/Projects/claude-ltm-plugin && bash install.sh |
| claude-ltm-plugin | ./README.md | 140 | [Report a Bug](https://github.com/RohiRIK/claude-ltm-plugin/issues) |
| claude-ltm-plugin | ./scripts/install-wiring.ts | 208 | if (ltm?.source?.source === "git" && ltm.source.url?.includes("RohiRIK/claude-ltm-plugin")) { |
| claude-ltm-plugin | ./scripts/install-wiring.ts | 209 | marketplaces.ltm.source = { source: "github", repo: "RohiRIK/claude-ltm-plugin" }; |
| claude-ltm-plugin | ./docs/UX-SPEC.md | 190 | Project: claude-ltm-plugin |
| claude-ltm-plugin | ./docs/UX-SPEC.md | 918 | [x] ~/projects/claude-ltm-plugin |
| claude-ltm-plugin | ./docs/UX-SPEC.md | 926 | ✓ claude-ltm-plugin |
| claude-ltm-plugin | ./docs/UX-SPEC.md | 931 | claude-ltm-plugin > "Ship magnificent LTM by Q3" |
| claude-ltm-plugin | ./docs/UX-SPEC.md | 941 | claude-ltm-plugin: scanning 247 commits… |
| claude-ltm-plugin | ./docs/llm-migration-guide.md | 36 | claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 47 | [🧠 OpenLTM]  [⌥ claude-ltm-plugin ▾]   Projects  Graph  Inbox(3)  Settings  ···  [⌘K Search...]  ···  [● live · 82] [☾] |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 91 | **Bounded** — a folder, repo, or topic ("claude-ltm-plugin", "ai-soc-assistant", "general architecture"). |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 121 | **Project name + health chip** (e.g., "claude-ltm-plugin · 82/100 · 🟢") |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 191 | [🧠 OpenLTM]  [⌥ claude-ltm-plugin ▾]      Projects  Graph … |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 197 | **Memory injection scope follows this switcher** — when you're "in" claude-ltm-plugin, that project is the default scope for recall and graph |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 226 | **Auto-clustered by topic** using the existing `clusters` API. Each cluster is labeled (e.g., "auth & RLS", "Bun tooling", "claude-ltm-plugin internals") with a colored hull. |
| claude-ltm-plugin | ./docs/FRONTEND-REDESIGN-2026-06.md | 407 | Example: Inject top N. The system default is 15. The project "claude-ltm-plugin" might want 25 (it has more memory). The user goes to that project's settings to override. |
| claude-ltm-plugin | ./hooks/src/SessionStart.ts | 22 | const LTM_REPO_SLUG    = "RohiRIK/claude-ltm-plugin"; |
| claude-ltm-plugin | ./packages/adapter-pi/package.json | 27 | "url": "https://github.com/RohiRIK/claude-ltm-plugin" |
| claude-ltm-plugin | ./docs/migration.md | 10 | claude plugin marketplace add https://github.com/RohiRIK/claude-ltm-plugin |
| claude-ltm-plugin | ./packages/adapter-opencode/package.json | 16 | "url": "https://github.com/RohiRIK/claude-ltm-plugin" |
| claude-ltm-plugin | ./packages/ltm-core/package.json | 16 | "url": "https://github.com/RohiRIK/claude-ltm-plugin" |
| claude-ltm-plugin | ./graph-app/app/settings/about/page.tsx | 29 | feedbackUrl: "https://github.com/RohiRIK/claude-ltm-plugin/issues", |
| "ltm" (string literal) | ./src/mcp-server.ts | 50 | { name: "ltm", version: "1.0.0" }, |
| "ltm" (string literal) | ./src/mcp-server.ts | 127 | params: { level: "info", logger: "ltm", data: `memory_stored: id=${result.id} category=${resolvedCategory}${categoriseSource ? ` (auto:${categoriseSource})` : ""} importance=${importance ?? 3} action=${result.action}` }, |
| "ltm" (string literal) | ./src/mcp-server.ts | 226 | params: { level: "info", logger: "ltm", data: `graph_traversal: nodes=${totalNodes} edges=${totalEdges} depth=${depth}` }, |
| "ltm" (string literal) | ./src/config.ts | 95 | const ltm = raw["ltm"] as Record<string, unknown> \| undefined; |
| "ltm" (string literal) | ./src/config.ts | 127 | const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>; |
| "ltm" (string literal) | ./src/graph-server.ts | 795 | // Liveness: prefer Honker pub/sub push — the "ltm" channel drives broadcast() |
| "ltm" (string literal) | ./scripts/install-wiring.ts | 90 | const pluginCacheDir = join(CLAUDE_DIR, "plugins", "cache", "ltm"); |
| "ltm" (string literal) | ./hooks/src/SessionStart.ts | 127 | const ltm = data["ltm"] as Record<string, unknown> \| undefined; |
| "ltm" (string literal) | ./hooks/src/SessionStart.ts | 130 | data["ltm"] = { ...ltm, source: { source: "github", repo: LTM_REPO_SLUG } }; |
| "ltm" (string literal) | ./packages/ltm-core/src/events/index.ts | 5 | * loop drains `listen("ltm")` and hands each notification payload to the |
| "ltm" (string literal) | ./packages/ltm-core/src/events/index.ts | 19 | export const LTM_CHANNEL = "ltm"; |
| "ltm" (string literal) | ./packages/ltm-core/src/events/index.ts | 40 | * Push a liveness event on the "ltm" channel. Returns false when Honker is |
| "ltm" (string literal) | ./packages/ltm-core/src/events/index.ts | 56 | * Start the "ltm" channel listen loop. Each notification's payload is passed to |
| "ltm" (string literal) | ./hooks/src/GitCommit.ts | 23 | const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(CLAUDE_DIR, "plugins", "ltm"); |
| "ltm" (string literal) | ./packages/ltm-core/src/config.ts | 95 | const ltm = raw["ltm"] as Record<string, unknown> \| undefined; |
| "ltm" (string literal) | ./packages/ltm-core/src/config.ts | 127 | const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>; |
| "ltm" (string literal) | ./packages/adapter-pi/src/index.ts | 47 | const cacheBase = join(homedir(), ".claude", "plugins", "cache", "ltm", "ltm"); |
| "ltm" (string literal) | ./packages/ltm-core/src/__tests__/events/index.test.ts | 18 | expect(LTM_CHANNEL).toBe("ltm"); |
| "ltm" (string literal) | ./packages/ltm-core/src/__tests__/cli/install.test.ts | 156 | const ltm = (settings["mcpServers"] as Record<string, unknown>)["ltm"] as { |
| "ltm" (string literal) | ./packages/ltm-core/src/__tests__/cli/claude.test.ts | 42 | expect(servers["ltm"]).toBeDefined(); |
| "ltm" (string literal) | ./packages/ltm-core/src/__tests__/cli/claude.test.ts | 75 | expect(servers["ltm"]).toBeDefined(); |
| "ltm" (string literal) | ./packages/ltm-core/src/__tests__/cli/claude.test.ts | 100 | const ltm = (s["mcpServers"] as Record<string, unknown>)["ltm"] as { |
| "ltm" (string literal) | ./packages/ltm-core/src/cli/_shared.ts | 46 | * @param name     - Key under `mcpServers` (e.g. `"ltm"`). |
| "ltm" (string literal) | ./packages/ltm-core/src/cli/claude.ts | 16 | const MCP_NAME = "ltm"; |
| "ltm" (string literal) | ./packages/ltm-core/package.json | 12 | "ltm": "./src/cli/bin.ts" |
| "ltm" (string literal) | ./packages/ltm-core/package.json | 19 | "ltm", |
| "ltm" (string literal) | ./packages/adapter-opencode/package.json | 20 | "ltm", |
| "ltm" (string literal) | ./packages/adapter-pi/package.json | 32 | "ltm", |
