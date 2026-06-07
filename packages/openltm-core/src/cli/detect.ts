/**
 * cli/detect.ts — Agent detection for the LTM installer.
 *
 * Probes the filesystem for known AI coding agent installations so the
 * installer can auto-select targets without requiring explicit --claude /
 * --opencode / --pi flags.
 *
 * Pure function — accepts a homedir argument so tests can supply a tmp dir.
 */
import { existsSync } from "fs";
import { join } from "path";
import os from "os";
import type { DetectResult } from "./types.js";

/**
 * Probe for an OpenCode config directory using the standard path resolution
 * order: $XDG_CONFIG_HOME/opencode → ~/.config/opencode → (darwin only)
 * ~/Library/Application Support/opencode.
 */
function probeOpenCode(homedir: string): boolean {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg && existsSync(join(xdg, "opencode"))) return true;
  if (existsSync(join(homedir, ".config", "opencode"))) return true;
  if (process.platform === "darwin") {
    if (existsSync(join(homedir, "Library", "Application Support", "opencode"))) return true;
  }
  return false;
}

/**
 * Probe for a Pi config using the three known locations:
 * ~/.pi/ | ~/pi.toml | ~/.pi/config.toml
 */
function probePi(homedir: string): boolean {
  return (
    existsSync(join(homedir, ".pi")) ||
    existsSync(join(homedir, "pi.toml")) ||
    existsSync(join(homedir, ".pi", "config.toml"))
  );
}

/**
 * detectAgents — inspect the filesystem to determine which AI coding agents
 * are installed in the given home directory.
 *
 * @param homedir - Defaults to `os.homedir()`. Override in tests.
 * @returns DetectResult with boolean flags for each supported agent.
 */
export function detectAgents(homedir: string = os.homedir()): DetectResult {
  return {
    claude: existsSync(join(homedir, ".claude")),
    opencode: probeOpenCode(homedir),
    pi: probePi(homedir),
  };
}
