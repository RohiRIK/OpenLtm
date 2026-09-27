import type { InstallResult } from "./types.js";
import { installClaude } from "./claude.js";
import { installOpenCode } from "./opencode.js";
import { installPi } from "./pi.js";
import { existsSync } from "fs";
import { join } from "path";

export interface InstallTargetDefinition {
  id: "claude" | "opencode" | "pi";
  label: string;
  detect: (homedir: string) => boolean;
  install: (opts: { homedir?: string; dryRun?: boolean }) => Promise<InstallResult>;
}

function detectClaude(homedir: string): boolean {
  return existsSync(join(homedir, ".claude"));
}

function detectOpenCode(homedir: string): boolean {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg && existsSync(join(xdg, "opencode"))) return true;
  if (existsSync(join(homedir, ".config", "opencode"))) return true;
  if (process.platform === "darwin") {
    if (existsSync(join(homedir, "Library", "Application Support", "opencode"))) return true;
  }
  return false;
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
    install: ({ dryRun }) => installPi({ dryRun }),
  },
] as const;

export function getInstallTarget(id: InstallTargetDefinition["id"]): InstallTargetDefinition {
  const target = INSTALL_TARGETS.find((entry) => entry.id === id);
  if (!target) throw new Error(`Unknown install target: ${id}`);
  return target;
}
