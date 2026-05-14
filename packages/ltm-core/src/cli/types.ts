/**
 * cli/types.ts — Shared type definitions for the LTM CLI installer.
 *
 * The CLI is a thin layer that orchestrates installing LTM into one or more
 * host environments (Claude Code, OpenCode, Pi). This module defines the
 * contracts shared between the top-level bin entrypoint and the per-target
 * install strategies.
 */

// ── Agent detection ───────────────────────────────────────────────────────────

/** Result of the auto-detect probe: which AI coding agents are installed. */
export interface DetectResult {
  claude: boolean;
  opencode: boolean;
  pi: boolean;
}

// ── Install result (per-target installer) ─────────────────────────────────────

/** Returned by per-target install functions (claude.ts, opencode.ts, pi.ts). */
export interface InstallResult {
  target: string;
  status: "installed" | "skipped" | "error";
  detail?: string;
}

// ── Install targets ────────────────────────────────────────────────────────────

/** Canonical string identifiers for supported host environments. */
export const InstallTarget = {
  claudeCode: "claude-code",
  openCode: "open-code",
  pi: "pi",
} as const;

export type InstallTargetId = (typeof InstallTarget)[keyof typeof InstallTarget];

// ── Options ───────────────────────────────────────────────────────────────────

/** Options passed into the install orchestrator. */
export interface CliInstallOptions {
  /** Which host to install into. */
  target: InstallTargetId;
  /**
   * When true, skip all interactive prompts and use inferred defaults.
   * Required in CI / headless environments.
   */
  nonInteractive?: boolean;
  /**
   * When true, print what would be done without writing any files.
   * Implies nonInteractive.
   */
  dryRun?: boolean;
  /**
   * Override the data directory (defaults to CLAUDE_PLUGIN_DATA env var or
   * the platform-standard location for the chosen target).
   */
  pluginDataDir?: string;
}

// ── Result ────────────────────────────────────────────────────────────────────

/** A single recorded action taken (or skipped) during installation. */
export interface InstallStep {
  label: string;
  status: "done" | "skipped" | "error";
  detail?: string;
}

/** Returned by runInstall and every per-target strategy. */
export interface CliInstallResult {
  success: boolean;
  /** Human-readable summary line (used in terminal output). */
  message: string;
  /** Ordered list of steps executed during the run. */
  steps: InstallStep[];
}
