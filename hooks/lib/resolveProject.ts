/**
 * resolveProject.ts
 * Shared utility for resolving a cwd to { name, projectDir, isNew }.
 *
 * Resolution order:
 *  1. Exact match in registry.json
 *  2. Longest prefix match in registry.json
 *  3. Fallback: slug derived from cwd
 *
 * Registry: ~/.claude/projects/registry.json
 * Format: { "/abs/path": "friendly-name" }
 */

import { existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, mkdirSync, copyFileSync } from "fs";
import { join, sep } from "path";
import { homedir } from "os";

export const CLAUDE_DIR = join(homedir(), ".claude");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
export const REGISTRY_PATH = join(PROJECTS_DIR, "registry.json");

export function getDbPath(): string {
  if (process.env.LTM_DB_PATH) return process.env.LTM_DB_PATH;
  if (process.env.CLAUDE_PLUGIN_DATA) {
    const targetDb = join(process.env.CLAUDE_PLUGIN_DATA, "ltm.db");
    const legacyDb = join(CLAUDE_DIR, "memory", "ltm.db");
    if (!existsSync(targetDb) && existsSync(legacyDb)) {
      mkdirSync(process.env.CLAUDE_PLUGIN_DATA, { recursive: true });
      copyFileSync(legacyDb, targetDb);
    }
    return targetDb;
  }
  return join(CLAUDE_DIR, "memory", "ltm.db");
}

export interface ProjectResolution {
  name: string;
  projectDir: string;
  isNew: boolean;
  registeredPath: string | null;
}

function deriveSlug(cwd: string): string {
  return cwd.replace(new RegExp("\\" + sep, "g"), "-").replace(/\./g, "-");
}

function loadRegistry(): Record<string, string> {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function writeRegistryAtomic(registryPath: string, data: unknown): void {
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
}

export function saveRegistry(registry: Record<string, string>): void {
  if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true });
  writeRegistryAtomic(REGISTRY_PATH, registry);
}

export function registerPath(cwd: string, name: string): void {
  const registry = loadRegistry();
  registry[cwd] = name;
  saveRegistry(registry);
}

function makeResult(name: string, registeredPath: string | null, isNew: boolean): ProjectResolution {
  return { name, projectDir: join(PROJECTS_DIR, name), isNew, registeredPath };
}

export function resolveProject(cwd: string): ProjectResolution {
  const registry = loadRegistry();

  // 1. Exact match
  if (registry[cwd]) {
    return makeResult(registry[cwd], cwd, false);
  }

  // 2. Longest prefix match
  const sortedPaths = Object.keys(registry).sort((a, b) => b.length - a.length);
  for (const path of sortedPaths) {
    if (cwd.startsWith(path + "/") || cwd.startsWith(path + sep)) {
      return makeResult(registry[path]!, path, false);
    }
  }

  // 3. Slug fallback
  const slug = deriveSlug(cwd);
  const slugDir = join(PROJECTS_DIR, slug);
  const contextFiles = ["context-goals.md", "context-decisions.md", "context-progress.md", "context-gotchas.md", "context-summary.md"];
  const hasContent = contextFiles.some(f => existsSync(join(slugDir, f)));

  return { name: slug, projectDir: slugDir, isNew: !hasContent, registeredPath: null };
}
