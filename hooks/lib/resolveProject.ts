/**
 * resolveProject.ts
 * Claude Code hooks: resolve a cwd to { name, projectDir, isNew }.
 *
 * Name — the shared core resolver (`resolveProjectNameDetailed`):
 *  1. Exact match in the registry
 *  2. Longest prefix match in the registry
 *  3. Git repository root basename, normalized
 *  4. cwd basename, normalized
 * Continuity: before 3/4 is used, an unregistered cwd whose old name — the
 * full-path slug, e.g. "-home-user-repo" — has rows in the DB (or OpenLTM context
 * files in the legacy dir for that slug) while the new name has none keeps the
 * slug, and the slug is registered so the name stays stable from then on.
 *
 * Storage — OpenLTM-owned, never inside Claude Code's transcript dir:
 *   <dataDir>/projects/registry.json   { "/abs/path": "friendly-name" }
 *   <dataDir>/projects/<name>/         context-*.md
 *   dataDir = LTM_DATA_DIR → CLAUDE_PLUGIN_DATA → dirname(getDbPath())
 * The legacy registry and context files in Claude Code's projects dir
 * (CLAUDE_TRANSCRIPTS_DIR) are copied on first access and never modified or
 * deleted — Claude Code owns that directory.
 */

import { existsSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, mkdirSync, copyFileSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import {
  getDataDir, getProjectsDir as projectsDirFor, getRegistryPath as registryPathFor,
  getLegacyClaudeDir, getClaudeTranscriptsDir,
  resolveProjectNameDetailed, legacyClaudeSlug, loadProjectRegistry, migrateLegacyRegistry,
  migrateLegacyContextFiles, hasContextFiles, isSafeProjectDirName, createProjectDataProbe,
  type ProjectNameSource,
} from "@rohirik/openltm-core";

/** Claude Code's own directory (tmp, logs, plugins, settings). */
export const CLAUDE_DIR = getLegacyClaudeDir();
/** Claude Code's session transcripts (`<CLAUDE_DIR>/projects`). Read-only for OpenLTM. */
export const CLAUDE_TRANSCRIPTS_DIR = getClaudeTranscriptsDir();

export function getDbPath(): string {
  if (process.env.LTM_DB_PATH) return process.env.LTM_DB_PATH;
  if (process.env.CLAUDE_PLUGIN_DATA) {
    const targetDb = join(process.env.CLAUDE_PLUGIN_DATA, "openltm.db");
    const legacyDb = join(getLegacyClaudeDir(), "memory", "openltm.db");
    if (!existsSync(targetDb) && existsSync(legacyDb)) {
      mkdirSync(process.env.CLAUDE_PLUGIN_DATA, { recursive: true });
      copyFileSync(legacyDb, targetDb);
    }
    return targetDb;
  }
  return join(getLegacyClaudeDir(), "memory", "openltm.db");
}

/** OpenLTM's projects dir (`<dataDir>/projects`), resolved from the environment now. */
export function getProjectsDir(): string {
  return projectsDirFor(getDataDir(getDbPath()));
}

/** OpenLTM's registry (`<dataDir>/projects/registry.json`), resolved from the environment now. */
export function getRegistryPath(): string {
  return registryPathFor(getDataDir(getDbPath()));
}

/** Import-time snapshots of the getters above (hooks are short-lived processes). */
export const PROJECTS_DIR = getProjectsDir();
export const REGISTRY_PATH = getRegistryPath();

export interface ProjectResolution {
  name: string;
  projectDir: string;
  isNew: boolean;
  registeredPath: string | null;
  /** Which resolution step produced `name`. */
  source?: ProjectNameSource;
}

/** Registry with the one-time legacy copy applied, plus legacy entries not yet copied. */
function loadRegistry(): Record<string, string> {
  const registryPath = getRegistryPath();
  migrateLegacyRegistry(registryPath);
  return loadProjectRegistry(registryPath);
}

const LOCK_STALE_MS = 5000;
const LOCK_RETRIES = 5;
const LOCK_BASE_DELAY_MS = 50;

function acquireLock(lockPath: string): void {
  for (let i = 0; i < LOCK_RETRIES; i++) {
    // Reclaim stale lock (process died before cleanup)
    if (existsSync(lockPath)) {
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) unlinkSync(lockPath);
      } catch { /* lock removed by another process — retry */ }
    }
    try {
      // O_EXCL: atomic creation — fails if file already exists
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      return; // lock acquired
    } catch {
      // Another process holds the lock — exponential backoff
      const delay = LOCK_BASE_DELAY_MS * Math.pow(2, i);
      const start = Date.now();
      while (Date.now() - start < delay) { /* spin-wait */ }
    }
  }
  throw new Error(`[writeRegistryAtomic] could not acquire lock after ${LOCK_RETRIES} retries`);
}

export function writeRegistryAtomic(registryPath: string, data: unknown): void {
  const lockPath = registryPath + ".lock";
  acquireLock(lockPath);
  try {
    const tmp = registryPath + ".tmp";
    const json = JSON.stringify(data, null, 2);
    writeFileSync(tmp, json, "utf8");
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, registryPath);
  } finally {
    try { unlinkSync(lockPath); } catch { /* already removed — harmless */ }
  }
}

export function saveRegistry(registry: Record<string, string>): void {
  mkdirSync(getProjectsDir(), { recursive: true });
  writeRegistryAtomic(getRegistryPath(), registry);
}

export function registerPath(cwd: string, name: string): void {
  const registry = loadRegistry();
  registry[cwd] = name;
  saveRegistry(registry);
}

export function resolveProject(cwd: string): ProjectResolution {
  const projectsDir = getProjectsDir();
  const registry = loadRegistry();
  const dbProbe = createProjectDataProbe(getDbPath());
  const hasContext = (name: string): boolean =>
    isSafeProjectDirName(name) &&
    (hasContextFiles(join(projectsDir, name)) || hasContextFiles(join(getClaudeTranscriptsDir(), name)));

  const resolved = resolveProjectNameDetailed(cwd, {
    registry,
    legacyName: legacyClaudeSlug(cwd),
    hasProjectData: (name) => (hasContext(name) ? true : dbProbe(name)),
  });
  const { name, source } = resolved;
  let registeredPath = resolved.registeredPath;

  // Continuity confirmed: pin the old slug so later sessions resolve it via the registry.
  if (source === "legacy" && resolved.legacyVerified) {
    try {
      registerPath(cwd, name);
      registeredPath = cwd;
    } catch { /* registry busy — this resolution is still correct */ }
  }

  migrateLegacyContextFiles(name, projectsDir);
  const projectDir = join(projectsDir, name);
  // New = nothing anywhere: no registry entry, no context files, no DB rows.
  const isNew = (source === "repo-root" || source === "cwd") && !hasContextFiles(projectDir) && dbProbe(name) === false;
  return { name, projectDir, isNew, registeredPath, source };
}
