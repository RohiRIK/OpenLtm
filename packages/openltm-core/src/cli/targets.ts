import type { InstallResult } from "./types.js";
import { installClaude } from "./claude.js";
import { installOpenCode, openCodeConfigDirs } from "./opencode.js";
import { installPi } from "./pi.js";
import { existsSync } from "fs";
import { join } from "path";

export interface InstallTargetDefinition {
  id: "claude" | "opencode" | "pi";
  label: string;
  detect: (homedir: string) => boolean;
  /** `piCmd`: run this Pi CLI instead of the one on PATH (tests, scripted installs). */
  install: (opts: { homedir?: string; dryRun?: boolean; piCmd?: string }) => Promise<InstallResult>;
}

function detectClaude(homedir: string): boolean {
  return existsSync(join(homedir, ".claude"));
}

function detectOpenCode(homedir: string): boolean {
  return openCodeConfigDirs(homedir).some((dir) => existsSync(dir));
}

function detectPi(homedir: string): boolean {
  return (
    existsSync(join(homedir, ".pi")) ||
    existsSync(join(homedir, "pi.toml")) ||
    existsSync(join(homedir, ".pi", "config.toml"))
  );
}

export const INSTALL_TARGETS: readonly InstallTargetDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    detect: detectClaude,
    install: ({ homedir, dryRun }) => installClaude({ homedir, dryRun }),
  },
  {
    id: "opencode",
    label: "OpenCode",
    detect: detectOpenCode,
    install: ({ homedir, dryRun }) => installOpenCode({ homedir, dryRun }),
  },
  {
    id: "pi",
    label: "Pi",
    detect: detectPi,
    install: ({ homedir, dryRun, piCmd }) => installPi({ homedir, dryRun, _piCmd: piCmd }),
  },
] as const;

export function getInstallTarget(id: InstallTargetDefinition["id"]): InstallTargetDefinition {
  const target = INSTALL_TARGETS.find((entry) => entry.id === id);
  if (!target) throw new Error(`Unknown install target: ${id}`);
  return target;
}
