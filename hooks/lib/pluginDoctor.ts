#!/usr/bin/env bun
/**
 * pluginDoctor.ts — Unified LTM plugin health check.
 * Checks every aspect of the plugin and outputs a pass/fail report.
 *
 * Usage: bun ${CLAUDE_PLUGIN_ROOT}/hooks/lib/pluginDoctor.ts
 */

import { existsSync, readFileSync, readdirSync, statSync, accessSync, openSync, readSync, closeSync, constants } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { Database } from "bun:sqlite";
import { getDbPath, CLAUDE_DIR } from "./resolveProject.js";

const HOME = homedir();
const BUN_PATH = "/opt/homebrew/bin/bun";

// Resolve plugin root: env var → derive from this file's location (hooks/lib/ → ../../)
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, "..", "..");

let passed = 0;
let failed = 0;
let warned = 0;

function ok(desc: string): void {
  console.log(`  ✅  ${desc}`);
  passed++;
}

function fail(desc: string, fix: string): void {
  console.log(`  ❌  ${desc}`);
  console.log(`       → ${fix}`);
  failed++;
}

function warn(desc: string, fix: string): void {
  console.log(`  🟡  ${desc}`);
  console.log(`       → ${fix}`);
  warned++;
}

function section(title: string): void {
  console.log(`\n## ${title}`);
}

function checkManifest(): void {
  section("Plugin Manifest");

  const pkgPath = join(PLUGIN_ROOT, "package.json");
  const pluginPath = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

  let pkgVersion: string | undefined;
  let pluginJson: Record<string, unknown> = {};

  try {
    pkgVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version as string;
  } catch {
    fail("package.json readable", `Check ${pkgPath} exists`);
    return;
  }

  try {
    pluginJson = JSON.parse(readFileSync(pluginPath, "utf-8"));
  } catch {
    fail("plugin.json readable", `Check ${pluginPath} exists`);
    return;
  }

  const pluginVersion = pluginJson.version as string | undefined;
  if (pkgVersion === pluginVersion) {
    ok(`Version consistent: ${pkgVersion}`);
  } else {
    fail(
      `Version mismatch: package.json=${pkgVersion}, plugin.json=${pluginVersion}`,
      "Bump both files to the same version"
    );
  }

  // AC-9: plugin system auto-discovers hooks.json — declaring it in plugin.json causes
  // duplicate validation error on /reload-plugins
  if ("hooks" in pluginJson) {
    fail(
      'plugin.json contains "hooks" field',
      'Remove it — plugin system auto-discovers hooks.json; causes duplicate validation error on /reload-plugins'
    );
  } else {
    ok('plugin.json has no "hooks" field (correct)');
  }

  if ("agents" in pluginJson) {
    const agentsVal = pluginJson.agents as string;
    const resolved = agentsVal.startsWith("/") ? agentsVal : join(PLUGIN_ROOT, agentsVal);
    if (!existsSync(resolved)) {
      fail(
        `plugin.json "agents" field points to missing directory: ${agentsVal}`,
        'Remove the "agents" field or create the directory'
      );
    } else {
      ok(`plugin.json "agents" field present and directory exists`);
    }
  }
}

function checkBun(): void {
  section("Bun Runtime");

  if (!existsSync(BUN_PATH)) {
    fail(`${BUN_PATH} not found`, "hooks/hooks.json commands will fail. Install bun via Homebrew: brew install bun");
    return;
  }

  try {
    accessSync(BUN_PATH, constants.X_OK);
    ok(`${BUN_PATH} exists and is executable`);
  } catch {
    fail(`${BUN_PATH} is not executable`, `Run: chmod +x ${BUN_PATH}`);
  }
}

function checkDatabase(): void {
  section("Database");

  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    fail(`ltm.db not found at ${dbPath}`, "Run /ltm:migrate to create the database");
    return;
  }
  ok(`ltm.db exists at ${dbPath}`);

  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (e) {
    fail("ltm.db is valid SQLite", `Database may be corrupted: ${e}`);
    return;
  }

  try {
    const row = db.query("SELECT count(*) as n FROM memories").get() as { n: number };
    ok(`memories table valid (${row.n} rows)`);
  } catch {
    fail("memories table exists", "Run /ltm:migrate to apply schema");
  }

  try {
    const applied = (db.query(
      "SELECT count(*) as n FROM _schema_version"
    ).get() as { n: number }).n;
    const migrationsDir = join(PLUGIN_ROOT, "migrations");
    const total = existsSync(migrationsDir)
      ? readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).length
      : 0;
    if (applied < total) {
      fail(`Migrations: ${applied}/${total} applied`, "Run /ltm:migrate to apply pending migrations");
    } else {
      ok(`Migrations: ${applied}/${total} applied`);
    }
  } catch {
    warn("Could not read _schema_version table", "Run /ltm:migrate to ensure schema is up to date");
  } finally {
    db?.close();
  }
}

function checkMcp(): void {
  section("MCP Registration");

  const pluginPath = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
  try {
    const pluginJson = JSON.parse(readFileSync(pluginPath, "utf-8")) as Record<string, unknown>;
    const mcp = pluginJson.mcpServers as Record<string, unknown> | undefined;
    if (mcp?.ltm) {
      ok("ltm MCP server registered in plugin.json");
    } else {
      fail("ltm MCP server not found in plugin.json mcpServers", "Re-install the plugin");
    }
  } catch {
    fail("plugin.json readable for MCP check", `Check ${pluginPath}`);
  }

  const claudeJson = join(HOME, ".claude.json");
  if (!existsSync(claudeJson)) {
    ok("~/.claude.json absent — no legacy MCP entry possible");
    return;
  }

  try {
    const claude = JSON.parse(readFileSync(claudeJson, "utf-8")) as Record<string, unknown>;
    const mcp = claude.mcpServers as Record<string, unknown> | undefined;
    if (mcp?.ltm) {
      fail(
        "Legacy ltm MCP entry found in ~/.claude.json",
        `Run: bun run ${join(PLUGIN_ROOT, "scripts/install-wiring.ts")} to remove it`
      );
    } else {
      ok("No legacy ltm MCP entry in ~/.claude.json");
    }
  } catch {
    warn("Could not parse ~/.claude.json", "Check JSON validity");
  }
}

type HookEntry = { matcher: string; hooks: Array<{ type: string; command: string }> };

function checkPluginHooks(): void {
  section("Plugin-Managed Hooks (hooks.json)");

  const hooksJsonPath = join(PLUGIN_ROOT, "hooks", "hooks.json");
  if (!existsSync(hooksJsonPath)) {
    fail("hooks/hooks.json not found", `Expected at ${hooksJsonPath}`);
    return;
  }

  let hooksConfig: { hooks?: Record<string, HookEntry[]> };
  try {
    hooksConfig = JSON.parse(readFileSync(hooksJsonPath, "utf-8"));
  } catch {
    fail("hooks/hooks.json parseable", "Check JSON validity");
    return;
  }

  if (!hooksConfig.hooks) {
    fail('hooks.json missing "hooks" key', "Malformed hooks.json structure");
    return;
  }

  const logPath = join(CLAUDE_DIR, "logs", "hooks.log");
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const errorsByHook = new Map<string, number>();

  if (existsSync(logPath)) {
    try {
      for (const line of readFileSync(logPath, "utf-8").split("\n")) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as { ts: string; level: string; hook: string };
          if (entry.level === "error" && new Date(entry.ts).getTime() >= cutoff) {
            errorsByHook.set(entry.hook, (errorsByHook.get(entry.hook) ?? 0) + 1);
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* skip unreadable log */ }
  }

  for (const [event, entries] of Object.entries(hooksConfig.hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        const bunMatch = h.command.match(/^(\/[^\s]+\/bun)/);
        const srcMatch = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(.+\.ts)$/);
        const bunBin = bunMatch?.[1];
        const srcRel = srcMatch?.[1];

        if (!bunBin) {
          warn(`${event}: could not parse bun path`, `Check command: ${h.command}`);
          continue;
        }

        if (!existsSync(bunBin)) {
          fail(`${event}: bun not found at ${bunBin}`, `Install bun at ${bunBin} or update hooks.json`);
        } else {
          ok(`${event}: bun path valid (${bunBin})`);
        }

        if (!srcRel) continue;

        const fullPath = join(PLUGIN_ROOT, srcRel);
        if (!existsSync(fullPath)) {
          fail(`${event}: source file missing — ${srcRel}`, `Check ${fullPath}`);
        } else {
          ok(`${event}: source file exists — ${srcRel}`);
        }

        const hookName = basename(srcRel, ".ts");
        const errCount = errorsByHook.get(hookName) ?? 0;
        if (errCount >= 3) {
          console.log(`  🔴  ${event}/${hookName}: ${errCount} errors in last 24h`);
          console.log(`       → Run: tail -50 ~/.claude/logs/hooks.log`);
          failed++;
        } else if (errCount > 0) {
          warn(`${event}/${hookName}: ${errCount} error(s) in last 24h`, "Run: tail -50 ~/.claude/logs/hooks.log");
        } else {
          ok(`${event}/${hookName}: no errors in last 24h`);
        }
      }
    }
  }
}

function checkSettingsHooks(): void {
  section("Settings.json Hooks");

  if (!existsSync(BUN_PATH)) {
    console.log("  ⚠   bun not found — skipping settings.json hook check");
    return;
  }

  const doctorPath = join(PLUGIN_ROOT, "hooks", "lib", "hookDoctor.ts");
  if (!existsSync(doctorPath)) {
    warn("hookDoctor.ts not found", `Expected at ${doctorPath}`);
    return;
  }

  const result = spawnSync(BUN_PATH, [doctorPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });

  const output = (result.stdout?.toString() ?? "").trim();
  if (output) {
    console.log(output);
  } else {
    console.log("  (no output from hookDoctor.ts)");
  }
}

function checkStaleExecutables(): void {
  section("Stale Hook Executables");

  const LTM_HOOK_DIRS = ["SessionStart", "UpdateContext", "EvaluateSession", "PreCompact"];

  for (const name of LTM_HOOK_DIRS) {
    const dir = join(CLAUDE_DIR, "hooks", name);
    if (!existsSync(dir)) {
      ok(`~/.claude/hooks/${name}/ — clean (absent)`);
      continue;
    }

    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      warn(`~/.claude/hooks/${name}/ — could not read directory`, `Check permissions: ls -la "${dir}"`);
      continue;
    }

    let staleFound = false;
    for (const file of files) {
      if (!file.endsWith(".ts") && !file.endsWith(".bundle.mjs")) continue;
      const filePath = join(dir, file);
      try {
        const stat = statSync(filePath);
        if (!(stat.mode & 0o111)) continue;

        // Read only the first 32 bytes to check shebang — avoid loading large .bundle.mjs files
        const buf = Buffer.allocUnsafe(32);
        const fd = openSync(filePath, "r");
        readSync(fd, buf, 0, 32, 0);
        closeSync(fd);
        if (buf.toString("utf-8").includes("bun")) {
          fail(
            `Stale executable: ~/.claude/hooks/${name}/${file}`,
            `Will cause exit 127. Delete: rm "${filePath}"`
          );
          staleFound = true;
        }
      } catch { /* skip unreadable files */ }
    }

    if (!staleFound) {
      ok(`~/.claude/hooks/${name}/ — clean`);
    }
  }
}

function checkMarketplace(): void {
  section("Marketplace Source");

  const knownPath = join(CLAUDE_DIR, "plugins", "known_marketplaces.json");
  if (!existsSync(knownPath)) {
    warn("known_marketplaces.json not found", "Only present in marketplace installs — skip if dev install");
    return;
  }

  try {
    const marketplaces = JSON.parse(readFileSync(knownPath, "utf-8")) as Record<string, unknown>;
    const ltm = marketplaces.ltm as { source?: { source?: string } } | undefined;
    if (!ltm) {
      warn("ltm entry not found in known_marketplaces.json", "Re-install plugin from marketplace");
      return;
    }
    const src = ltm.source?.source;
    if (src === "github") {
      ok('ltm marketplace source is "github" (API-based update checks enabled)');
    } else if (src === "git") {
      warn(
        'ltm marketplace source is "git" — update checks require manual git pull',
        "postinstall patches this automatically; or run: bun run scripts/install-wiring.ts"
      );
    } else {
      warn(`ltm marketplace source is "${src ?? "unknown"}"`, 'Expected "github" for API-based update checks');
    }
  } catch {
    warn("Could not parse known_marketplaces.json", "Check JSON validity");
  }
}

function printSummary(): void {
  console.log("\n" + "─".repeat(60));
  const total = passed + failed + warned;
  console.log(`${passed} checks passed, ${failed} failed, ${warned} warnings  (${total} total)`);
  if (failed > 0) {
    console.log("Overall: 🔴 Plugin has issues that need attention");
  } else if (warned > 0) {
    console.log("Overall: 🟡 Plugin is functional but has warnings");
  } else {
    console.log("Overall: 🟢 Plugin is healthy");
  }
}

console.log("# LTM Plugin Doctor\n");
console.log(`Plugin root: ${PLUGIN_ROOT}`);

checkManifest();
checkBun();
checkDatabase();
checkMcp();
checkPluginHooks();
checkSettingsHooks();
checkStaleExecutables();
checkMarketplace();
printSummary();
