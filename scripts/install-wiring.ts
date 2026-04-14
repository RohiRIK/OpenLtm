#!/usr/bin/env bun
/**
 * Wires the LTM plugin into ~/.claude.json (MCP) and ~/.claude/settings.json (hooks).
 * Called by install.sh. Safe to run multiple times — skips already-wired entries.
 *
 * Usage: bun run scripts/install-wiring.ts <plugin-root>
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync, mkdirSync, chmodSync, rmSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const root = process.argv[2];
if (!root) {
  console.error("Usage: bun run scripts/install-wiring.ts <plugin-root>");
  process.exit(1);
}

const CLAUDE_DIR = join(homedir(), ".claude");
const claudeJson = join(homedir(), ".claude.json");

// Resolve plugin data dir: env var → scan ~/.claude/plugins/data/ltm-*
let pluginData = process.env.CLAUDE_PLUGIN_DATA;
if (!pluginData) {
  const dataDir = join(CLAUDE_DIR, "plugins", "data");
  if (existsSync(dataDir)) {
    const match = readdirSync(dataDir).find(d => d.startsWith("ltm-"));
    if (match) pluginData = join(dataDir, match);
  }
}

if (pluginData) {
  const targetDb  = join(pluginData, "ltm.db");
  const legacyDb  = join(CLAUDE_DIR, "memory", "ltm.db");
  const hasTarget = existsSync(targetDb);
  if (!hasTarget && existsSync(legacyDb)) {
    mkdirSync(pluginData, { recursive: true });
    copyFileSync(legacyDb, targetDb);
    console.log(`  ✔ Migrated ltm.db → ${targetDb}`);
  } else if (!hasTarget) {
    console.log("  ✔ Fresh install — ltm.db will be created on first run");
  } else {
    console.log(`  ✔ ltm.db ready at ${targetDb}`);
  }
}
const settingsJson = join(CLAUDE_DIR, "settings.json");

// ── MCP registration ─────────────────────────────────────────────────────────
// MCP is registered by the plugin system via plugin.json mcpServers field.
// We only clean up any legacy manual entry left from pre-plugin installs.
if (existsSync(claudeJson)) {
  const claude = JSON.parse(readFileSync(claudeJson, "utf-8"));
  if (claude.mcpServers?.ltm) {
    delete claude.mcpServers.ltm;
    writeFileSync(claudeJson, JSON.stringify(claude, null, 2));
    console.log("  ✔ Removed legacy ltm MCP entry from ~/.claude.json (now managed by plugin system)");
  }
}

// ── Hooks wiring ─────────────────────────────────────────────────────────────
type HookEntry = { matcher: string; hooks: { type: string; command: string }[] };

if (!existsSync(settingsJson)) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(settingsJson, "{}");
}
const settings = JSON.parse(readFileSync(settingsJson, "utf-8"));
const hooks: Record<string, HookEntry[]> = settings.hooks ?? {};
settings.hooks = hooks;

// Detect marketplace install: plugin system manages hooks via hooks.json.
// hooks.json exists in both dev and marketplace installs, but the plugin system
// only reads it for marketplace installs. Best signal: CLAUDE_PLUGIN_DATA is set,
// or the plugin cache directory exists.
const pluginCacheDir = join(CLAUDE_DIR, "plugins", "cache", "ltm");
const pluginDataDir = join(CLAUDE_DIR, "plugins", "data");
const hasPluginData = existsSync(pluginDataDir)
  && readdirSync(pluginDataDir).some(d => d.startsWith("ltm-"));
const isMarketplaceInstall = !!process.env.CLAUDE_PLUGIN_DATA
  || existsSync(pluginCacheDir)
  || hasPluginData;

// Patterns that identify LTM hook entries in settings.json (for cleanup)
const LTM_HOOK_PATTERNS = [
  "hooks/src/SessionStart.ts",
  "hooks/src/UpdateContext.ts",
  "hooks/src/EvaluateSession.ts",
  "hooks/src/PreCompact.ts",
];

if (isMarketplaceInstall) {
  // Marketplace install: plugin system reads hooks/hooks.json directly.
  // Clean up any stale LTM hook entries from settings.json (e.g. leftover from
  // a previous dev/git-clone install or an earlier version of this script).
  let cleaned = false;
  for (const event of Object.keys(hooks)) {
    const before = hooks[event]!.length;
    hooks[event] = hooks[event]!.filter(
      (e) => !e.hooks.some((h) => LTM_HOOK_PATTERNS.some((p) => h.command.includes(p)))
    );
    if (hooks[event]!.length === 0) {
      delete hooks[event];
    }
    if (hooks[event]?.length !== before) cleaned = true;
  }
  writeFileSync(settingsJson, JSON.stringify(settings, null, 2));
  if (cleaned) {
    console.log("  ✔ Removed stale LTM hooks from ~/.claude/settings.json (now managed by plugin system)");
  } else {
    console.log("  ✔ Hooks managed by plugin system (hooks/hooks.json) — settings.json clean");
  }

  // Remove stale hook files from ~/.claude/hooks/<Handler>/ that were installed
  // by older plugin system versions. They have #!/usr/bin/env bun shebangs and
  // are auto-discovered as executables by Claude Code, but bun is not in the
  // harness execution PATH → exit 127 on every session start.
  // The plugin system now runs these via hooks.json (absolute bun path).
  const STALE_FILES = LTM_HOOK_PATTERNS.flatMap(p => {
    const name = basename(p, ".ts");
    return [
      join(CLAUDE_DIR, "hooks", name, `${name}.bundle.mjs`),
      join(CLAUDE_DIR, "hooks", name, `${name}.ts`),
    ];
  });
  let staleRemoved = 0;
  for (const p of STALE_FILES) {
    try { rmSync(p); staleRemoved++; } catch {}
  }
  if (staleRemoved > 0)
    console.log(`  ✔ Removed ${staleRemoved} stale hook file(s) from ~/.claude/hooks/`);
} else {
  // Dev/git-clone install: no plugin system, wire hooks into settings.json directly
  const LTM_HOOKS: [string, string][] = [
    ["SessionStart", `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/SessionStart.ts`],
    ["Stop",         `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/UpdateContext.ts`],
    ["Stop",         `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/EvaluateSession.ts`],
    ["PreCompact",   `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/PreCompact.ts`],
  ];

  for (const [event, command] of LTM_HOOKS) {
    hooks[event] ??= [];
    const already = hooks[event]!.some(e => e.hooks.some(h => h.command.includes(command)));
    if (!already) {
      hooks[event]!.push({ matcher: "", hooks: [{ type: "command", command }] });
    }
  }

  writeFileSync(settingsJson, JSON.stringify(settings, null, 2));
  console.log("  ✔ Hooks wired into ~/.claude/settings.json (dev install)");
}

// ── Global git post-commit hook ───────────────────────────────────────────────
const gitHooksDir = join(CLAUDE_DIR, "hooks", "git");
mkdirSync(gitHooksDir, { recursive: true });

const postCommitPath = join(gitHooksDir, "post-commit");
const postCommitScript = `#!/bin/sh\nCLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/GitCommit.ts "$@"\n`;

if (!existsSync(postCommitPath) || !readFileSync(postCommitPath, "utf-8").includes("GitCommit")) {
  writeFileSync(postCommitPath, postCommitScript);
  chmodSync(postCommitPath, 0o755);
}

try {
  execSync(`git config --global core.hooksPath ${gitHooksDir}`, { stdio: "ignore" });
  console.log("  ✔ Global git post-commit hook installed (~/.claude/hooks/git/)");
  console.log("  ℹ  Enable with: ltm.gitLearnEnabled=true in ~/.claude/config.json");
} catch {
  console.log("  ⚠  Could not set git core.hooksPath — set manually: git config --global core.hooksPath " + gitHooksDir);
}

// ── Ensure run-hook.sh is executable (defensive — git preserves bit, but cache copies may not) ──
const runHookScript = join(root, "hooks", "bin", "run-hook.sh");
try {
  chmodSync(runHookScript, 0o755);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    console.log("  ⚠  hooks/bin/run-hook.sh not found — skipping chmod");
  } else {
    console.log("  ⚠  Could not chmod hooks/bin/run-hook.sh — hooks may fail if executable bit is missing");
  }
}

// ── Patch known_marketplaces.json to use GitHub API source ───────────────────
// The plugin system defaults to "git" source (requires local git fetch).
// "github" source uses the GitHub API — no fetch needed for update checks.
const knownMarketplacesPath = join(CLAUDE_DIR, "plugins", "known_marketplaces.json");
if (existsSync(knownMarketplacesPath)) {
  const marketplaces = JSON.parse(readFileSync(knownMarketplacesPath, "utf-8"));
  const ltm = marketplaces.ltm;
  if (ltm?.source?.source === "git" && ltm.source.url?.includes("RohiRIK/claude-ltm-plugin")) {
    marketplaces.ltm.source = { source: "github", repo: "RohiRIK/claude-ltm-plugin" };
    writeFileSync(knownMarketplacesPath, JSON.stringify(marketplaces, null, 2));
    console.log("  ✔ Switched ltm marketplace source to github (enables API-based update checks)");
  }
}
