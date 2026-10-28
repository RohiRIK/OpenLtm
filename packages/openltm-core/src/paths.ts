/**
 * paths.ts (openltm-core) — Path resolution without any host-specific defaults.
 *
 * Database:  LTM_DB_PATH env var > CLAUDE_PLUGIN_DATA env var > dev fallback
 *            (monorepo checkout) or the Claude plugin data dir (published install).
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
import { homedir } from "os";
import { getClaudePluginDataDir, getLegacyClaudeDir, sharedDbPath } from "./project.js";

/**
 * An env value, unless empty or an unexpanded `${…}` placeholder from a host
 * config. A leading `~/` is expanded: values from Claude Code's settings.json
 * `env` never pass through a shell, and would otherwise name a directory "~".
 */
function envPath(name: string): string | undefined {
  const v = process.env[name];
  if (!v || v.includes("${")) return undefined;
  return v === "~" || v.startsWith("~/") ? join(homedir(), v.slice(1)) : v;
}

export function getDbPath(): string {
  const explicit = envPath("LTM_DB_PATH");
  if (explicit) return explicit;
  const pluginData = envPath("CLAUDE_PLUGIN_DATA");
  if (pluginData) return join(pluginData, "openltm.db");
  return fallbackDbPath();
}

/**
 * The database when no env var names one. In the monorepo that is
 * `<root>/data/openltm.db`. In a published install `<root>` is node_modules —
 * for bunx a per-version cache — so a database created there would vanish on
 * the next upgrade: keep one that already exists, otherwise use the shared
 * Claude plugin data dir (where `ltm --claude` points the agents too).
 */
export function fallbackDbPath(root: string = join(import.meta.dir, "..", "..", "..")): string {
  const devDb = join(root, "data", "openltm.db");
  if (existsSync(devDb) || existsSync(join(root, "packages", "openltm-core"))) return sharedDbPath(devDb);
  return join(getClaudePluginDataDir(), "openltm.db");
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
 * Locate the versioned SQL migrations (shipped inside the npm tarball). Throws
 * when the directory is missing: carrying on would silently find zero
 * migrations and hand back a column-incomplete database.
 */
export function getMigrationsDir(): string {
  const dir = join(import.meta.dir, "..", "migrations");
  if (!existsSync(dir)) throw new Error(`[openltm] migrations directory not found: ${dir} (broken install?)`);
  return dir;
}
