/**
 * cli/install.ts — Install orchestrator stub.
 *
 * This module is the top-level entry point for the `ltm install` command.
 * Phase 6-0 ships this as a documented stub; subsequent phases will add
 * per-target strategies (Claude Code settings.json wiring, OpenCode TOML
 * patching, Pi config injection).
 *
 * Design contract (enforced by tests):
 *   - runInstall always resolves (never throws) and returns a CliInstallResult
 *   - dryRun=true performs no filesystem writes
 *   - Unknown target values return { success: false, message: "Unknown target …" }
 */
import type { CliInstallOptions, CliInstallResult, InstallStep } from "./types.js";
import { InstallTarget } from "./types.js";

/** Known target ids set — used for validation. */
const KNOWN_TARGETS = new Set<string>(Object.values(InstallTarget));

/**
 * runInstall — orchestrates the installation of LTM into a host environment.
 *
 * @param opts - Install options (target, dryRun, nonInteractive, …)
 * @returns A CliInstallResult describing what happened.
 */
export async function runInstall(opts: CliInstallOptions): Promise<CliInstallResult> {
  const { target, dryRun = false, nonInteractive = false } = opts;
  const steps: InstallStep[] = [];

  // ── Validate target ────────────────────────────────────────────────────────
  if (!KNOWN_TARGETS.has(target)) {
    return {
      success: false,
      message: `Unknown target: "${target}". Valid targets: ${[...KNOWN_TARGETS].join(", ")}`,
      steps,
    };
  }

  // ── Stub: record the planned steps ────────────────────────────────────────
  // Real per-target strategies will be implemented in Phase 6-1 (Claude Code),
  // Phase 6-2 (OpenCode), and Phase 6-3 (Pi). For now we record what would
  // happen and return success so the CLI wiring can be tested end-to-end.
  steps.push({
    label: `Validate target: ${target}`,
    status: "done",
  });

  steps.push({
    label: "Detect plugin data directory",
    status: dryRun ? "skipped" : "done",
    detail: dryRun ? "dry-run mode — no filesystem writes" : opts.pluginDataDir ?? "(auto-detected)",
  });

  steps.push({
    label: `Wire ${target} configuration`,
    status: dryRun ? "skipped" : "done",
    detail: dryRun
      ? "dry-run: would patch host config file"
      : `[stub] Phase 6-1/6-2/6-3 will implement ${target} wiring`,
  });

  if (!nonInteractive && !dryRun) {
    steps.push({
      label: "Run onboarding wizard",
      status: "skipped",
      detail: "interactive mode — wizard deferred to ltm onboard",
    });
  }

  const mode = dryRun ? " (dry-run)" : "";
  return {
    success: true,
    message: `LTM install for "${target}" completed${mode}. Run "ltm onboard" to finish setup.`,
    steps,
  };
}
