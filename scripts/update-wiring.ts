#!/usr/bin/env bun
/**
 * update-wiring.ts — Re-wires LTM plugin after a marketplace update.
 *
 * Called automatically via package.json "postinstall" script, so it runs
 * whenever `bun install` is executed in the plugin directory (e.g. on
 * marketplace update). Safe to run multiple times — all operations are
 * idempotent.
 *
 * Only the plugin system's own copy (under ~/.claude/plugins) is re-wired
 * automatically. A development checkout or worktree is left alone — running
 * `bun install` there must not write the contributor's global ~/.claude
 * (that used to wire one more set of hooks per checkout). Opt in with
 * LTM_WIRE_HOOKS=1, or use `bash install.sh` for a git-clone install.
 *
 * Usage: bun run scripts/update-wiring.ts [plugin-root]
 *   plugin-root defaults to the directory of this script's parent.
 */
import { join, dirname, resolve, sep } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// Resolve plugin root: explicit arg → env var → script location
const __dir = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? process.env.CLAUDE_PLUGIN_ROOT ?? resolve(__dir, "..");

const pluginsDir = resolve(homedir(), ".claude", "plugins");
const managedByPluginSystem = resolve(root).startsWith(pluginsDir + sep) || !!process.env.CLAUDE_PLUGIN_DATA;
if (!managedByPluginSystem && process.env.LTM_WIRE_HOOKS !== "1") {
  console.log("openltm: development checkout — not wiring hooks into ~/.claude (set LTM_WIRE_HOOKS=1 or run `bash install.sh` to wire this checkout).");
  process.exit(0);
}

const result = spawnSync(
  "bun",
  ["run", join(root, "scripts", "install-wiring.ts"), root],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 0);
