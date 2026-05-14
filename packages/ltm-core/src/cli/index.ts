/**
 * cli/index.ts — Public barrel for the @rohirik/ltm-core/cli sub-path export.
 *
 * Consumers that want to build on top of the LTM CLI primitives (e.g. a
 * wrapper script or an e2e test harness) import from here instead of reaching
 * into internal modules.
 */
export { runInstall } from "./install.js";
export type { CliInstallOptions, CliInstallResult, InstallStep, InstallTargetId } from "./types.js";
export { InstallTarget } from "./types.js";
