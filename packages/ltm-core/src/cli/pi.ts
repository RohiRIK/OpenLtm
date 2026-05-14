/**
 * cli/pi.ts — Installer for Pi coding agent.
 *
 * Patches (or creates) the Pi TOML config file to add the LTM extension.
 * Uses a simple text-based append strategy to avoid reformatting the user's
 * existing TOML (preserves comments and formatting).
 * Idempotent — safe to run multiple times.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";
import type { InstallResult } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PACKAGE_NAME = "@rohirik/pi-ltm";
const EXTENSION_BLOCK = `\n[[extensions]]\npackage = "${PACKAGE_NAME}"\n`;

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the Pi config file path using the priority order:
 *   1. ~/.pi/config.toml (preferred)
 *   2. ~/pi.toml
 *
 * If neither exists, returns the default creation path (~/.pi/config.toml).
 */
function resolveConfigPath(homedir: string): { path: string; exists: boolean } {
  const candidates: string[] = [
    join(homedir, ".pi", "config.toml"),
    join(homedir, "pi.toml"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return { path: p, exists: true };
  }

  return { path: join(homedir, ".pi", "config.toml"), exists: false };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * installPi — patch or create the Pi config file.
 *
 * @param opts.homedir - Override home directory (useful for tests).
 * @param opts.dryRun  - Compute result without writing any files.
 * @returns InstallResult describing what happened.
 */
export async function installPi(opts: {
  homedir?: string;
  dryRun?: boolean;
}): Promise<InstallResult> {
  const homedir = opts.homedir ?? os.homedir();
  const dryRun = opts.dryRun ?? false;

  const { path, exists } = resolveConfigPath(homedir);

  if (!exists) {
    if (!dryRun) {
      mkdirSync(join(homedir, ".pi"), { recursive: true });
      writeFileSync(path, EXTENSION_BLOCK.trimStart(), "utf8");
    }
    return {
      target: "pi",
      status: "installed",
      detail: dryRun ? "dry-run — no files written" : path,
    };
  }

  // Read existing file for idempotency check
  const existing = readFileSync(path, "utf8");
  if (existing.includes(PACKAGE_NAME)) {
    return { target: "pi", status: "skipped", detail: "extension already registered" };
  }

  if (!dryRun) {
    writeFileSync(path, existing + EXTENSION_BLOCK, "utf8");
  }

  return {
    target: "pi",
    status: "installed",
    detail: dryRun ? "dry-run — no files written" : path,
  };
}
