/**
 * cli/index.ts — Public barrel for the @rohirik/openltm-core/cli sub-path export.
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
export { INSTALL_TARGETS, getInstallTarget } from "./targets.js";
export {
  JANITOR_EXIT,
  LTM_BIN_PATH,
  parseJanitorArgs,
  runJanitorCli,
  runJanitorCommand,
  spawnJanitorDetached,
} from "./janitor.js";
export type { ParsedJanitorArgs, JanitorCommandResult, SpawnJanitorResult } from "./janitor.js";
export type { InstallTargetDefinition } from "./targets.js";
