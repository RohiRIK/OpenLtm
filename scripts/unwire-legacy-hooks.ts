#!/usr/bin/env bun
/**
 * unwire-legacy-hooks.ts — remove OpenLTM hook entries from ~/.claude/settings.json.
 *
 * Use when OpenLTM runs as a Claude Code plugin (hooks come from hooks/hooks.json)
 * but settings.json still has hooks from a dev/git-clone install, an older
 * version, or the bunx installer — otherwise every hook fires twice. Other
 * tools' hooks are left alone. The file is backed up first.
 *
 * Usage:
 *   bun scripts/unwire-legacy-hooks.ts           remove them (backup: settings.json.bak-openltm-<time>)
 *   bun scripts/unwire-legacy-hooks.ts --check   list them, change nothing
 * Exit: 0 ok (nothing found, or removed) · 1 settings.json is not valid JSON · 3 --check found entries
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { findLtmHooks, removeLtmHooks, userSettingsPath, type HooksSection } from "../hooks/lib/settingsHooks.js";

const checkOnly = process.argv.includes("--check");
const path = userSettingsPath();

if (!existsSync(path)) {
  console.log(`No ${path} — nothing to do.`);
  process.exit(0);
}

let settings: { hooks?: HooksSection };
try {
  settings = JSON.parse(readFileSync(path, "utf-8"));
} catch (err) {
  console.error(`${path} is not valid JSON (${err instanceof Error ? err.message : err}) — nothing was changed.`);
  process.exit(1);
}

const found = findLtmHooks(settings.hooks);
if (found.length === 0) {
  console.log(`No OpenLTM hooks in ${path}.`);
  process.exit(0);
}

console.log(`${found.length} OpenLTM hook entr${found.length === 1 ? "y" : "ies"} in ${path}:`);
for (const { event, command } of found) console.log(`  ${event}: ${command}`);

if (checkOnly) {
  console.log("Run without --check to remove them (the file is backed up first).");
  process.exit(3);
}

const backup = `${path}.bak-openltm-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(path, backup);
removeLtmHooks(settings.hooks!);
if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
console.log(`Removed. Backup: ${backup}. Restart Claude Code.`);
