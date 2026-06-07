#!/usr/bin/env bun
/**
 * migrate-db.ts
 * Detects where openltm.db lives and migrates it to CLAUDE_PLUGIN_DATA if needed.
 *
 * Exit codes: 0 = ok, 1 = error
 */

import { existsSync, copyFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_DIR   = join(homedir(), ".claude");
const legacyDb     = join(CLAUDE_DIR, "memory", "openltm.db");
const pluginData   = process.env.CLAUDE_PLUGIN_DATA;
const ltmDbPath    = process.env.LTM_DB_PATH;

console.log("── LTM DB Migration Check ──────────────────────────────");

// 1. LTM_DB_PATH override
if (ltmDbPath) {
  const exists = existsSync(ltmDbPath);
  console.log(`LTM_DB_PATH override : ${ltmDbPath}`);
  console.log(`Status               : ${exists ? "✅ exists" : "❌ missing — will be created on first write"}`);
  process.exit(0);
}

// 2. Marketplace install (CLAUDE_PLUGIN_DATA set)
if (pluginData) {
  const targetDb = join(pluginData, "openltm.db");
  const hasTarget = existsSync(targetDb);
  const hasLegacy = existsSync(legacyDb);

  console.log(`Install type         : marketplace (CLAUDE_PLUGIN_DATA set)`);
  console.log(`Target DB            : ${targetDb}`);
  console.log(`Legacy DB            : ${legacyDb}`);
  console.log();

  if (hasTarget) {
    const size = statSync(targetDb).size;
    console.log(`✅ Already migrated  : ${targetDb} (${(size / 1024).toFixed(1)} KB)`);
    if (hasLegacy) {
      console.log(`ℹ  Legacy DB still exists at ${legacyDb} — safe to delete manually if desired.`);
    }
  } else if (hasLegacy) {
    console.log(`⏳ Migrating ${legacyDb}`);
    console.log(`        → ${targetDb}`);
    mkdirSync(pluginData, { recursive: true });
    copyFileSync(legacyDb, targetDb);
    const size = statSync(targetDb).size;
    console.log(`✅ Migration complete (${(size / 1024).toFixed(1)} KB)`);
    console.log(`ℹ  Legacy DB kept at ${legacyDb} — safe to delete manually.`);
  } else {
    console.log(`✅ Fresh install — no legacy DB found. openltm.db will be created at:`);
    console.log(`   ${targetDb}`);
  }
  process.exit(0);
}

// 3. Dev/git-clone install
console.log(`Install type         : dev/git-clone (no CLAUDE_PLUGIN_DATA)`);
console.log(`DB path              : ${legacyDb}`);
const hasLegacy = existsSync(legacyDb);
if (hasLegacy) {
  const size = statSync(legacyDb).size;
  console.log(`✅ DB found (${(size / 1024).toFixed(1)} KB) — no migration needed.`);
} else {
  console.log(`✅ Fresh install — openltm.db will be created on first write.`);
}
