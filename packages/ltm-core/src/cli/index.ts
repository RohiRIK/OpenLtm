/**
 * cli/index.ts — Public barrel for the @rohirik/ltm-core/cli sub-path export.
 *
 * Consumers that want to build on top of the LTM CLI primitives (e.g. a
 * wrapper script or an e2e test harness) import from here instead of reaching
 * into internal modules.
 */
export { runInstall, runInstallCli } from "./install.js";
export type { CliRunOpts, CliRunResult } from "./install.js";
export type {
  CliInstallOptions,
  CliInstallResult,
  InstallStep,
  InstallTargetId,
  InstallResult,
  DetectResult,
} from "./types.js";
export { InstallTarget } from "./types.js";
export { detectAgents } from "./detect.js";
export { installClaude } from "./claude.js";
export { installOpenCode } from "./opencode.js";
export { installPi } from "./pi.js";
