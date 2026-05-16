/**
 * cli/pi.ts — Installer for Pi coding agent.
 *
 * Delegates to `pi install npm:@rohirik/pi-ltm` — Pi's own package manager
 * writes the entry into ~/.pi/agent/settings.json. This is the only reliable
 * install path; writing to config.toml does not register extensions in Pi.
 *
 * Idempotent: checks `pi list` output before installing.
 */
import { execSync } from "child_process";
import type { InstallResult } from "./types.js";

const PACKAGE_SOURCE = "npm:@rohirik/pi-ltm";
const PACKAGE_NAME = "@rohirik/pi-ltm";

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
    const out = execSync(`${piCmd} list`, { encoding: "utf8", stdio: "pipe" });
    return out.includes(PACKAGE_NAME);
  } catch {
    return false;
  }
}

export async function installPi(opts: {
  dryRun?: boolean;
  /** Inject a custom pi command path — used in tests. */
  _piCmd?: string;
}): Promise<InstallResult> {
  const dryRun = opts.dryRun ?? false;
  const piCmd = opts._piCmd ?? findPiCli();

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
    execSync(`${piCmd} install ${PACKAGE_SOURCE}`, { stdio: "pipe" });
    return { target: "pi", status: "installed", detail: `${piCmd} install ${PACKAGE_SOURCE}` };
  } catch (err) {
    return {
      target: "pi",
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
