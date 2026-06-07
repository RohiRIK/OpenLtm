/**
 * cli/opencode.ts — Installer for OpenCode.
 *
 * Patches (or creates) the OpenCode config file to add the LTM plugin.
 * Resolves the config path using OpenCode's documented priority order.
 * Idempotent — safe to run multiple times.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import os from "os";
import type { InstallResult } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLUGIN_PACKAGE = "@rohirik/opencode-ltm@latest";
const PLUGIN_MATCH = "@rohirik/opencode-ltm";
const SCHEMA = "https://opencode.ai/config.json";

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the OpenCode config file path using the standard priority order:
 *   1. $XDG_CONFIG_HOME/opencode/opencode.json
 *   2. ~/.config/opencode/opencode.json
 *   3. ~/Library/Application Support/opencode/opencode.json (darwin only)
 *
 * Returns the first path that exists. If none exist, returns the default
 * creation path for the current platform.
 */
function resolveConfigPath(homedir: string): { path: string; exists: boolean } {
  const candidates: string[] = [];

  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg) candidates.push(join(xdg, "opencode", "opencode.json"));

  candidates.push(join(homedir, ".config", "opencode", "opencode.json"));

  if (process.platform === "darwin") {
    candidates.push(join(homedir, "Library", "Application Support", "opencode", "opencode.json"));
  }

  for (const p of candidates) {
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
 * installOpenCode — patch or create the OpenCode config file.
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

  const { path, exists } = resolveConfigPath(homedir);

  if (!exists) {
    // Create a new config file
    const newConfig = {
      $schema: SCHEMA,
      plugin: [PLUGIN_PACKAGE],
    };

    if (!dryRun) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n", "utf8");
    }

    return {
      target: "opencode",
      status: "installed",
      detail: dryRun ? "dry-run — no files written" : path,
    };
  }

  // Parse existing config
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    config = {};
  }

  // Check if plugin already present
  const plugins = Array.isArray(config["plugin"]) ? (config["plugin"] as unknown[]) : [];
  const alreadyPresent = plugins.some(
    (p) => typeof p === "string" && p.includes(PLUGIN_MATCH),
  );

  if (alreadyPresent) {
    return { target: "opencode", status: "skipped", detail: "plugin already registered" };
  }

  // Add the plugin
  const updated = {
    ...config,
    plugin: [...plugins, PLUGIN_PACKAGE],
  };

  if (!dryRun) {
    writeFileSync(path, JSON.stringify(updated, null, 2) + "\n", "utf8");
  }

  return {
    target: "opencode",
    status: "installed",
    detail: dryRun ? "dry-run — no files written" : path,
  };
}
