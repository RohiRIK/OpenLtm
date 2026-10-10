/**
 * cli/opencode.ts — Installer for OpenCode.
 *
 * Installs the complete LTM OpenCode customization:
 *   - Plugin package (@rohirik/opencode-ltm)
 *   - Agents (aegis.md)
 *   - Skills (AgentTrustBoundaries, CommandPathSafety, SecretSafeHandling)
 *   - Plugins (aegis.ts)
 * Resolves the config path using OpenCode's documented priority order.
 * Idempotent — safe to run multiple times.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from "fs";
import { join, dirname } from "path";
import os from "os";
import type { InstallResult } from "./types.js";
import { configHomeFor } from "./configHome.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLUGIN_PACKAGE = "@rohirik/opencode-ltm@latest";
const PLUGIN_MATCH = "@rohirik/opencode-ltm";
const SCHEMA = "https://opencode.ai/config.json";

// Files that must never be copied into the user's config when deploying assets.
const COPY_DENYLIST = new Set([
  "node_modules",
  "package.json",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  ".gitignore",
  ".DS_Store",
]);

/**
 * Resolve the bundled OpenCode customization assets.
 *
 * The canonical, shipped location is `assets/opencode/` inside this package —
 * it is committed and included in the published npm tarball, so it resolves
 * identically in dev, in a built package, and in a `bunx`/installed package.
 * The repo-root `.opencode/` is kept as a dev-only fallback.
 */
function getOpenCodeSourceDir(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "assets", "opencode"), // shipped: packages/openltm-core/assets/opencode
    join(import.meta.dir, "..", "..", "..", ".opencode"),    // dev fallback: monorepo root
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * OpenCode config directories for `homedir`, in OpenCode's priority order:
 *   1. $XDG_CONFIG_HOME/opencode — only when `homedir` is the process home
 *      (configHomeFor); for any other home it is <homedir>/.config/opencode
 *   2. <homedir>/.config/opencode
 *   3. <homedir>/Library/Application Support/opencode (darwin only)
 */
export function openCodeConfigDirs(homedir: string): string[] {
  const dirs = [join(configHomeFor(homedir), "opencode"), join(homedir, ".config", "opencode")];
  if (process.platform === "darwin") dirs.push(join(homedir, "Library", "Application Support", "opencode"));
  return [...new Set(dirs)];
}

/**
 * Resolve the OpenCode config file: the first `opencode.json` that exists in
 * openCodeConfigDirs(homedir), else the default creation path for the platform.
 */
function resolveConfigPath(homedir: string): { path: string; exists: boolean } {
  for (const dir of openCodeConfigDirs(homedir)) {
    const p = join(dir, "opencode.json");
    if (existsSync(p)) return { path: p, exists: true };
  }

  // Default creation path
  const defaultPath =
    process.platform === "darwin"
      ? join(homedir, "Library", "Application Support", "opencode", "opencode.json")
      : join(homedir, ".config", "opencode", "opencode.json");

  return { path: defaultPath, exists: false };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * installOpenCode — install complete LTM OpenCode customization.
 *
 * @param opts.homedir - Override home directory (useful for tests).
 * @param opts.dryRun  - Compute result without writing any files.
 * @returns InstallResult describing what happened.
 */
export async function installOpenCode(opts: {
  homedir?: string;
  dryRun?: boolean;
}): Promise<InstallResult> {
  const homedir = opts.homedir ?? os.homedir();
  const dryRun = opts.dryRun ?? false;

  const details: string[] = [];

  // 1. Install plugin package in config
  const { path: configPath, exists } = resolveConfigPath(homedir);
  let config: Record<string, unknown> = {};

  if (exists) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      config = {};
    }
  } else {
    config = { $schema: SCHEMA };
  }

  const plugins = Array.isArray(config["plugin"]) ? (config["plugin"] as unknown[]) : [];
  const pluginAlreadyPresent = plugins.some(
    (p) => typeof p === "string" && p.includes(PLUGIN_MATCH),
  );

  if (!pluginAlreadyPresent) {
    const updated = { ...config, plugin: [...plugins, PLUGIN_PACKAGE] };
    if (!dryRun) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    }
    details.push(`plugin: ${dryRun ? "would add" : "added"} @rohirik/opencode-ltm`);
  } else {
    details.push("plugin: already present (skipped)");
  }

  // 2. Deploy agents, skills, plugins alongside the resolved config so the
  //    customization always lives in the same opencode directory as the plugin.
  const sourceDir = getOpenCodeSourceDir();
  const targetDir = dirname(configPath);

  const components = ["agents", "skills", "plugins"];

  let anyDeployed = !pluginAlreadyPresent;

  for (const comp of components) {
    const srcPath = join(sourceDir, comp);
    const dstPath = join(targetDir, comp);

    if (!existsSync(srcPath)) {
      details.push(`${comp}: source not found (skipped)`);
      continue;
    }

    const alreadyDeployed = existsSync(dstPath) && readdirSync(dstPath).length > 0;

    if (!alreadyDeployed) {
      if (!dryRun) {
        mkdirSync(dstPath, { recursive: true });
        copyRecursive(srcPath, dstPath);
      }
      details.push(`${comp}: ${dryRun ? "would deploy" : "deployed"}`);
      anyDeployed = true;
    } else {
      details.push(`${comp}: already deployed (skipped)`);
    }
  }

  return {
    target: "opencode",
    status: anyDeployed ? "installed" : "skipped",
    detail: details.join("; "),
  };
}

// Copy directory recursively, preserving structure. Skips node_modules,
// lockfiles, and other denylisted entries at every level.
function copyRecursive(src: string, dst: string): void {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (COPY_DENYLIST.has(entry.name) || entry.name.endsWith(".lock")) continue;

    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(dstPath, { recursive: true });
      copyRecursive(srcPath, dstPath);
    } else {
      cpSync(srcPath, dstPath, { force: true });
    }
  }
}
