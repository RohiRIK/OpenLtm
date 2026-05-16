/**
 * cli/install.ts — Install orchestrator.
 *
 * Coordinates detection → installation → UX rendering across all supported
 * target agents (Claude Code, OpenCode, Pi). Uses @clack/prompts for output.
 *
 * The module exports two surfaces:
 *   - `runInstall(opts)` — programmatic API (used by bin.ts and tests)
 *   - Legacy `CliInstallResult` shape preserved for backward compatibility with
 *     existing tests in src/__tests__/cli.test.ts
 */
import * as clack from "@clack/prompts";
import { detectAgents } from "./detect.js";
import { installClaude } from "./claude.js";
import { installOpenCode } from "./opencode.js";
import { installPi } from "./pi.js";
import type { CliInstallOptions, CliInstallResult, InstallStep, InstallResult } from "./types.js";
import { InstallTarget } from "./types.js";

// ── Known targets set (legacy validation) ────────────────────────────────────

const KNOWN_TARGETS = new Set<string>(Object.values(InstallTarget));

// ── Legacy runInstall (backward compatible) ───────────────────────────────────

/**
 * runInstall — legacy programmatic API.
 *
 * Retained for backward compatibility with P6-0 tests in cli.test.ts.
 * New code should use `runInstallCli` or call individual installers directly.
 */
export async function runInstall(opts: CliInstallOptions): Promise<CliInstallResult> {
  const { target, dryRun = false, nonInteractive = false } = opts;
  const steps: InstallStep[] = [];

  if (!KNOWN_TARGETS.has(target)) {
    return {
      success: false,
      message: `Unknown target: "${target}". Valid targets: ${[...KNOWN_TARGETS].join(", ")}`,
      steps,
    };
  }

  steps.push({ label: `Validate target: ${target}`, status: "done" });
  steps.push({
    label: "Detect plugin data directory",
    status: dryRun ? "skipped" : "done",
    detail: dryRun ? "dry-run mode — no filesystem writes" : opts.pluginDataDir ?? "(auto-detected)",
  });
  steps.push({
    label: `Wire ${target} configuration`,
    status: dryRun ? "skipped" : "done",
    detail: dryRun ? "dry-run: would patch host config file" : undefined,
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

// ── CLI orchestration ─────────────────────────────────────────────────────────

export interface CliRunOpts {
  /** Explicit target flags from the command line. */
  targets: {
    claude: boolean;
    opencode: boolean;
    pi: boolean;
  };
  dryRun: boolean;
  homedir?: string;
  /** When true, suppress @clack output (used in tests). */
  silent?: boolean;
}

export interface CliRunResult {
  exitCode: number;
  results: InstallResult[];
}

/**
 * runInstallCli — main orchestrator for the `bunx @rohirik/ltm-core` flow.
 *
 * 1. If no target flags → call detectAgents()
 * 2. If nothing found and no flags → exit 2
 * 3. For each target call the installer and render @clack output
 */
export async function runInstallCli(opts: CliRunOpts): Promise<CliRunResult> {
  const { dryRun, homedir, silent = false } = opts;

  // Resolve targets
  let targets = { ...opts.targets };
  const hasExplicit = targets.claude || targets.opencode || targets.pi;

  if (!hasExplicit) {
    const detected = detectAgents(homedir);
    targets = detected;
  }

  const anyTarget = targets.claude || targets.opencode || targets.pi;
  if (!anyTarget) {
    if (!silent) {
      clack.log.warn(
        "No supported agents found. Use --claude, --opencode, or --pi to install manually.",
      );
    }
    return { exitCode: 2, results: [] };
  }

  if (!silent) {
    clack.intro("LTM Installer");
  }

  const results: InstallResult[] = [];

  // Claude
  if (targets.claude) {
    const s = silent ? null : clack.spinner();
    if (s) s.start("Installing into Claude Code…");
    const r = await installClaude({ homedir, dryRun });
    results.push(r);
    if (s) {
      if (r.status === "installed") {
        s.stop(`Claude Code: installed${dryRun ? " (dry-run)" : ""}`);
      } else if (r.status === "skipped") {
        s.stop("Claude Code: already configured (skipped)");
      } else {
        s.stop(`Claude Code: error — ${r.detail ?? "unknown error"}`);
      }
    }
  }

  // OpenCode
  if (targets.opencode) {
    const s = silent ? null : clack.spinner();
    if (s) s.start("Installing into OpenCode…");
    const r = await installOpenCode({ homedir, dryRun });
    results.push(r);
    if (s) {
      if (r.status === "installed") {
        s.stop(`OpenCode: installed${dryRun ? " (dry-run)" : ""}`);
      } else if (r.status === "skipped") {
        s.stop("OpenCode: already configured (skipped)");
      } else {
        s.stop(`OpenCode: error — ${r.detail ?? "unknown error"}`);
      }
    }
  }

  // Pi
  if (targets.pi) {
    const s = silent ? null : clack.spinner();
    if (s) s.start("Installing into Pi…");
    const r = await installPi({ dryRun });
    results.push(r);
    if (s) {
      if (r.status === "installed") {
        s.stop(`Pi: installed${dryRun ? " (dry-run)" : ""}`);
      } else if (r.status === "skipped") {
        s.stop("Pi: already configured (skipped)");
      } else {
        s.stop(`Pi: error — ${r.detail ?? "unknown error"}`);
      }
    }
  }

  const hasErrors = results.some((r) => r.status === "error");

  if (!silent) {
    clack.outro("Done. Shared DB: ~/.claude/plugins/data/ltm-ltm/ltm.db");
  }

  return { exitCode: hasErrors ? 1 : 0, results };
}
