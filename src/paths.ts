/**
 * paths.ts — Canonical path resolution for the LTM plugin.
 *
 * Priority chain for DB path:
 *  1. LTM_DB_PATH env var            → explicit override, always wins
 *  2. $CLAUDE_PLUGIN_DATA/openltm.db     → marketplace install (with auto-migrate from legacy)
 *  3. configOverride.dbPath           → injected by callers (used in tests, MCP server init)
 *     OR ltm.dbPath in the LTM config (getConfigPath(): LTM_CONFIG_PATH →
 *     <dataDir>/config.json → legacy ~/.claude/config.json)
 *  4. ~/.claude/memory/openltm.db        → dev / git-clone fallback
 */
import { existsSync, readFileSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { getConfigPath, getLegacyClaudeDir } from "@rohirik/openltm-core";

export const CLAUDE_DIR = getLegacyClaudeDir();

export interface DbPathOptions {
  /** Injected dbPath (e.g. from config.json read by caller, or test fixtures). */
  dbPath?: string;
  /** Skip copyFileSync auto-migration (used in unit tests to avoid FS side effects). */
  skipAutoMigrate?: boolean;
}

export function getDbPath(configOverride?: DbPathOptions): string {
  const claudeDir = getLegacyClaudeDir();

  // 1. Explicit env override always wins
  if (process.env.LTM_DB_PATH) return process.env.LTM_DB_PATH;

  // 2. Marketplace install — use plugin data dir, auto-migrate from legacy if needed
  if (process.env.CLAUDE_PLUGIN_DATA) {
    const targetDb = join(process.env.CLAUDE_PLUGIN_DATA, "openltm.db");
    const legacyDb = join(claudeDir, "memory", "openltm.db");
    if (!configOverride?.skipAutoMigrate && !existsSync(targetDb) && existsSync(legacyDb)) {
      mkdirSync(process.env.CLAUDE_PLUGIN_DATA, { recursive: true });
      copyFileSync(legacyDb, targetDb);
    }
    return targetDb;
  }

  // 3a. Injected override (test seam / caller-provided)
  if (configOverride?.dbPath) return configOverride.dbPath;

  // 3b. Read ltm.dbPath from the LTM config file
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config?.ltm?.dbPath) return config.ltm.dbPath;
    } catch {
      // Malformed config.json — fall through to legacy
    }
  }

  // 4. Legacy fallback
  return join(claudeDir, "memory", "openltm.db");
}

export function getSchemaPath(): string {
  return join(import.meta.dir, "schema.sql");
}

export function getMigrationsDir(): string {
  return join(import.meta.dir, "..", "migrations");
}
