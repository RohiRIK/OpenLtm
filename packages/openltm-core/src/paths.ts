/**
 * paths.ts (openltm-core) — Path resolution without any host-specific defaults.
 *
 * Database:  LTM_DB_PATH env var > CLAUDE_PLUGIN_DATA env var > dev fallback.
 * Data dir:  LTM_DATA_DIR > CLAUDE_PLUGIN_DATA > directory of the database.
 *   <dataDir>/projects/registry.json   cwd → project name
 *   <dataDir>/projects/<name>/         per-project context markdown
 *   <dataDir>/config.json              LTM config (see getConfigPath)
 *
 * OpenLTM state used to live in ~/.claude/projects/ — Claude Code's own
 * transcript directory. That location is now a read-only migration source.
 */
import { dirname, join } from "path";
import { existsSync } from "fs";
import { getLegacyClaudeDir } from "./project.js";

/** An env value, unless empty or an unexpanded `${…}` placeholder from a host config. */
function envPath(name: string): string | undefined {
  const v = process.env[name];
  return v && !v.includes("${") ? v : undefined;
}

export function getDbPath(): string {
  const explicit = envPath("LTM_DB_PATH");
  if (explicit) return explicit;
  const pluginData = envPath("CLAUDE_PLUGIN_DATA");
  if (pluginData) return join(pluginData, "openltm.db");
  return join(import.meta.dir, "..", "..", "..", "data", "openltm.db");
}

/**
 * Where OpenLTM keeps its own files (registry, context markdown, config).
 * `dbPath` is only the last-resort anchor; hosts with their own DB resolution
 * (the Claude hooks) pass theirs so registry and DB stay side by side. Pass a
 * function to defer it — it is only called when neither env var is set.
 */
export function getDataDir(dbPath: string | (() => string) = getDbPath): string {
  const fromEnv = envPath("LTM_DATA_DIR") || envPath("CLAUDE_PLUGIN_DATA");
  if (fromEnv) return fromEnv;
  return dirname(typeof dbPath === "function" ? dbPath() : dbPath);
}

/** `<dataDir>/projects` — registry + per-project context markdown. */
export function getProjectsDir(dataDir: string = getDataDir()): string {
  return join(dataDir, "projects");
}

/** `<dataDir>/projects/registry.json`. */
export function getRegistryPath(dataDir: string = getDataDir()): string {
  return join(getProjectsDir(dataDir), "registry.json");
}

/** `~/.claude/config.json` — legacy config location, still read as a fallback. */
export function getLegacyConfigPath(): string {
  return join(getLegacyClaudeDir(), "config.json");
}

/**
 * The LTM config file. Read order:
 *   1. LTM_CONFIG_PATH env var (returned even if missing — explicit wins)
 *   2. <dataDir>/config.json        if it exists
 *   3. ~/.claude/config.json        if it exists (legacy)
 *   4. <dataDir>/config.json        (where a new config is written)
 * Writers write to this path too, so an existing legacy file keeps being
 * updated in place rather than forked.
 */
export function getConfigPath(dataDir: string = getDataDir()): string {
  if (process.env["LTM_CONFIG_PATH"]) return process.env["LTM_CONFIG_PATH"];
  const preferred = join(dataDir, "config.json");
  if (existsSync(preferred)) return preferred;
  const legacy = getLegacyConfigPath();
  if (existsSync(legacy)) return legacy;
  return preferred;
}

export function getSchemaPath(): string {
  return join(import.meta.dir, "schema.sql");
}

/**
 * Locate the versioned SQL migrations.
 *
 * Order matters: the package-local `migrations/` copy is checked FIRST because
 * it is the one that ships inside the published npm tarball. The monorepo-root
 * path is only the development fallback. A published install that resolved to
 * the root path would silently find zero migrations and hand back a
 * column-incomplete database (missing `decay_score`, `workspace_id`, …).
 */
export function getMigrationsDir(): string {
  const packaged = join(import.meta.dir, "..", "migrations");
  if (existsSync(packaged)) return packaged;

  // Development inside the monorepo.
  return join(import.meta.dir, "..", "..", "..", "migrations");
}
