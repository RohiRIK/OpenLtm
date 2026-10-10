/**
 * cli/pi.ts — Installer for Pi coding agent.
 *
 * Delegates to `pi install npm:@rohirik/pi-ltm` — Pi's own package manager
 * writes the entry into ~/.pi/agent/settings.json. This is the only reliable
 * install path; writing to config.toml does not register extensions in Pi.
 *
 * Idempotent: checks `pi list` output before installing.
 *
 * Pi keeps its own config, which a `homedir` override cannot redirect, so the
 * Pi on PATH only runs for the process's own home; for any other home the step
 * is skipped unless the caller supplies the CLI (`_piCmd`). Every call is
 * time-bounded so a wrapper or a stuck network install cannot hang the installer.
 */
import { execSync } from "child_process";
import type { InstallResult } from "./types.js";
import { isProcessHome } from "./configHome.js";

const PACKAGE_SOURCE = "npm:@rohirik/pi-ltm";
const PACKAGE_NAME = "@rohirik/pi-ltm";
const LIST_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 300_000;

function findPiCli(): string | null {
  try {
    execSync("which pi", { stdio: "pipe" });
    return "pi";
  } catch {
    return null;
  }
}

function isAlreadyInstalled(piCmd: string): boolean {
  try {
    const out = execSync(`${piCmd} list`, { encoding: "utf8", stdio: "pipe", timeout: LIST_TIMEOUT_MS });
    return out.includes(PACKAGE_NAME);
  } catch {
    return false;
  }
}

export async function installPi(opts: {
  dryRun?: boolean;
  /** Home being installed into (default: the process home). */
  homedir?: string;
  /** Inject a custom pi command path — used in tests. */
  _piCmd?: string;
}): Promise<InstallResult> {
  const dryRun = opts.dryRun ?? false;
  if (!opts._piCmd && opts.homedir !== undefined && !isProcessHome(opts.homedir)) {
    return {
      target: "pi",
      status: "skipped",
      detail: `not run for another home (${opts.homedir}) — Pi keeps its own config; run \`pi install ${PACKAGE_SOURCE}\` as that user`,
    };
  }
  const piCmd = opts._piCmd ?? findPiCli();

  if (piCmd && !/^[a-zA-Z0-9/_.-]+$/.test(piCmd)) {
    throw new Error(`Invalid piCmd — unexpected characters: ${piCmd}`);
  }

  if (!piCmd) {
    return {
      target: "pi",
      status: "skipped",
      detail: "pi CLI not found — install Pi first from https://pi.ai",
    };
  }

  const alreadyInstalled = isAlreadyInstalled(piCmd);

  if (alreadyInstalled) {
    return { target: "pi", status: "skipped", detail: "extension already registered" };
  }

  if (dryRun) {
    return { target: "pi", status: "installed", detail: "dry-run — no files written" };
  }

  try {
    execSync(`${piCmd} install ${PACKAGE_SOURCE}`, { stdio: "pipe", timeout: INSTALL_TIMEOUT_MS });
    return { target: "pi", status: "installed", detail: `${piCmd} install ${PACKAGE_SOURCE}` };
  } catch (err) {
    return {
      target: "pi",
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
