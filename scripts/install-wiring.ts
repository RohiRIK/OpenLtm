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

/** POSIX single-quote for shell command strings (plugin roots may contain spaces). */
function shQuote(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Parse a JSON config file we are about to edit. On malformed JSON, say which
 * file and why, and never fall through to overwriting it.
 *  - required: exit 1 (nothing below runs, nothing is written)
 *  - optional: warn and return null so the caller skips that step
 */
function readJsonConfig(path: string, opts: { required: boolean }): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (opts.required) {
      console.error(`  ✖ ${path} is not valid JSON (${why}). Fix or move it aside, then re-run — nothing was changed.`);
      process.exit(1);
    }
    console.log(`  ⚠  Skipping ${path}: not valid JSON (${why}) — left unchanged`);
    return null;
  }
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
  const targetDb  = join(pluginData, "openltm.db");
  const legacyDb  = join(CLAUDE_DIR, "memory", "openltm.db");
  const hasTarget = existsSync(targetDb);
  if (!hasTarget && existsSync(legacyDb)) {
    mkdirSync(pluginData, { recursive: true });
    copyFileSync(legacyDb, targetDb);
    console.log(`  ✔ Migrated openltm.db → ${targetDb}`);
  } else if (!hasTarget) {
    console.log("  ✔ Fresh install — openltm.db will be created on first run");
  } else {
    console.log(`  ✔ openltm.db ready at ${targetDb}`);
  }
}
const settingsJson = join(CLAUDE_DIR, "settings.json");

// ── MCP registration ─────────────────────────────────────────────────────────
// MCP is registered by the plugin system via plugin.json mcpServers field.
// We only clean up any legacy manual entry left from pre-plugin installs.
const claude = existsSync(claudeJson) ? readJsonConfig(claudeJson, { required: false }) : null;
if (claude) {
  if (claude.mcpServers?.ltm) {
    delete claude.mcpServers.ltm;
    writeFileSync(claudeJson, JSON.stringify(claude, null, 2));
    console.log("  ✔ Removed legacy ltm MCP entry from ~/.claude.json (now managed by plugin system)");
  }
}

// ── Hooks wiring ─────────────────────────────────────────────────────────────
type HookEntry = { matcher: string; hooks: { type: string; command: string; timeout?: number }[] };

if (!existsSync(settingsJson)) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(settingsJson, "{}");
}
const settings = readJsonConfig(settingsJson, { required: true });
const hooks: Record<string, HookEntry[]> = settings.hooks ?? {};
settings.hooks = hooks;

// ── Permissions: auto-allow the LTM MCP server so its tools never prompt ──────
// MCP tools are registered as mcp__plugin_openltm_memory__<tool> (recall, learn,
// forget, relate, context, context_items, graph). Without an allowlist entry
// they prompt on every call. The whole-server rule grants all of them at once.
// Mutated here so the writeFileSync in either install branch below persists it.
const LTM_MCP_RULE = "mcp__plugin_openltm_memory";
const permissions: { allow?: string[]; deny?: string[] } = (settings.permissions ??= {});
permissions.allow ??= [];
if (!permissions.allow.includes(LTM_MCP_RULE)) {
  permissions.allow.push(LTM_MCP_RULE);
  console.log(`  ✔ Auto-allowed LTM MCP tools (${LTM_MCP_RULE}) in ~/.claude/settings.json`);
} else {
  console.log("  ✔ LTM MCP tools already auto-allowed in ~/.claude/settings.json");
}

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

// Dev/git-clone hook commands for this root. Paths are shell-quoted so a root
// with spaces still runs. `legacy` is the unquoted form older versions wrote.
function hookCommand(file: string): string {
  return `CLAUDE_PLUGIN_ROOT=${shQuote(root)} bun run ${shQuote(`${root}/hooks/src/${file}`)}`;
}
function legacyHookCommand(file: string): string {
  return `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/${file}`;
}

// Substring patterns for the four original hooks (pre-existing cleanup behaviour,
// kept so stale entries from older installs at any root are still removed).
const LTM_HOOK_PATTERNS = [
  "hooks/src/SessionStart.ts",
  "hooks/src/UpdateContext.ts",
  "hooks/src/EvaluateSession.ts",
  "hooks/src/PreCompact.ts",
];
// SessionEnd.ts, UserPromptSubmit.ts and PostToolUse.ts are generic file names other
// tools may use, so they are only ever removed on an exact match with a command
// this script writes.
const GENERIC_HOOK_FILES = ["SessionEnd.ts", "UserPromptSubmit.ts", "PostToolUse.ts"];
const LTM_EXACT_COMMANDS = new Set(GENERIC_HOOK_FILES.flatMap((f) => [hookCommand(f), legacyHookCommand(f)]));
const isLtmHookCommand = (cmd: string): boolean =>
  LTM_EXACT_COMMANDS.has(cmd) || LTM_HOOK_PATTERNS.some((p) => cmd.includes(p));

if (isMarketplaceInstall) {
  // Marketplace install: plugin system reads hooks/hooks.json directly.
  // Clean up any stale LTM hook entries from settings.json (e.g. leftover from
  // a previous dev/git-clone install or an earlier version of this script).
  let cleaned = false;
  for (const event of Object.keys(hooks)) {
    const before = hooks[event]!.length;
    hooks[event] = hooks[event]!.filter(
      (e) => !e.hooks.some((h) => isLtmHookCommand(h.command))
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
  // Mirrors hooks/hooks.json: [event, file, matcher, timeout seconds].
  const LTM_HOOKS: [string, string, string, number | undefined][] = [
    ["SessionStart",     "SessionStart.ts",     "",     15],
    ["UserPromptSubmit", "UserPromptSubmit.ts", "",     5],
    ["PostToolUse",      "PostToolUse.ts",      "Bash", 10],
    ["Stop",             "UpdateContext.ts",    "",     10],
    ["SessionEnd",       "EvaluateSession.ts",  "",     60],
    ["SessionEnd",       "SessionEnd.ts",       "",     undefined],
    ["PreCompact",       "PreCompact.ts",       "",     30],
  ];

  // 2.17 moved EvaluateSession from Stop (fires every turn) to SessionEnd —
  // drop the Stop entry older dev installs wrote.
  if (hooks["Stop"]) {
    hooks["Stop"] = hooks["Stop"].filter((e) => !e.hooks.some((h) => h.command.includes("hooks/src/EvaluateSession.ts")));
    if (hooks["Stop"].length === 0) delete hooks["Stop"];
  }

  for (const [event, file, matcher, timeout] of LTM_HOOKS) {
    const command = hookCommand(file);
    const legacy = legacyHookCommand(file);
    hooks[event] ??= [];
    let present = false;
    for (const e of hooks[event]!) {
      for (const h of e.hooks) {
        if (h.command === command) present = true;
        else if (h.command === legacy) { h.command = command; present = true; } // upgrade to quoted form in place
      }
    }
    if (!present) {
      hooks[event]!.push({ matcher, hooks: [{ type: "command", command, ...(timeout ? { timeout } : {}) }] });
    }
  }

  writeFileSync(settingsJson, JSON.stringify(settings, null, 2));
  console.log("  ✔ Hooks wired into ~/.claude/settings.json (dev install)");
}

// ── Global git post-commit hook ───────────────────────────────────────────────
const gitHooksDir = join(CLAUDE_DIR, "hooks", "git");
mkdirSync(gitHooksDir, { recursive: true });

const postCommitPath = join(gitHooksDir, "post-commit");
const postCommitScript = `#!/bin/sh\nCLAUDE_PLUGIN_ROOT=${shQuote(root)} bun ${shQuote(`${root}/hooks/GitCommit.bundle.mjs`)} "$@"\n`;

const existingPostCommit = existsSync(postCommitPath) ? readFileSync(postCommitPath, "utf-8") : "";
if (!existingPostCommit.includes("GitCommit.bundle.mjs")) {
  writeFileSync(postCommitPath, postCommitScript);
  chmodSync(postCommitPath, 0o755);
}

try {
  execSync(`git config --global core.hooksPath ${shQuote(gitHooksDir)}`, { stdio: "ignore" });
  console.log("  ✔ Global git post-commit hook installed (~/.claude/hooks/git/)");
  console.log("  ℹ  Enable with: ltm.gitLearnEnabled=true in the LTM config.json ($CLAUDE_PLUGIN_DATA/config.json; legacy ~/.claude/config.json is still read)");
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
const marketplaces = existsSync(knownMarketplacesPath) ? readJsonConfig(knownMarketplacesPath, { required: false }) : null;
if (marketplaces) {
  const ltm = marketplaces.ltm;
  if (ltm?.source?.source === "git" && ltm.source.url?.includes("RohiRIK/OpenLtm")) {
    marketplaces.ltm.source = { source: "github", repo: "RohiRIK/OpenLtm" };
    writeFileSync(knownMarketplacesPath, JSON.stringify(marketplaces, null, 2));
    console.log("  ✔ Switched ltm marketplace source to github (enables API-based update checks)");
  }
}
