/**
 * cli/detect.ts — Agent detection for the LTM installer.
 *
 * Probes the filesystem for known AI coding agent installations so the
 * installer can auto-select targets without requiring explicit --claude /
 * --opencode / --pi flags.
 *
 * Pure function — accepts a homedir argument so tests can supply a tmp dir.
 */
import os from "os";
import type { DetectResult } from "./types.js";
import { INSTALL_TARGETS } from "./targets.js";

/**
 * detectAgents — inspect the filesystem to determine which AI coding agents
 * are installed in the given home directory.
 *
 * @param homedir - Defaults to `os.homedir()`. Override in tests.
 * @returns DetectResult with boolean flags for each supported agent.
 */
export function detectAgents(homedir: string = os.homedir()): DetectResult {
  return INSTALL_TARGETS.reduce<DetectResult>((acc, target) => {
    acc[target.id] = target.detect(homedir);
    return acc;
  }, { claude: false, opencode: false, pi: false });
}
