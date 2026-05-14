/**
 * cli/claude.ts — Installer for Claude Code.
 *
 * Writes (or patches) ~/.claude/settings.json to add the LTM MCP server
 * entry and three lifecycle hooks. Idempotent — safe to run multiple times.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import os from "os";
import { mergeMcpEntry, wireHooks } from "./_shared.js";
import type { ClaudeSettings, McpServerEntry } from "./_shared.js";
import type { InstallResult } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MCP_NAME = "ltm";
const MCP_ENTRY: McpServerEntry = {
  command: "bunx",
  args: ["@rohirik/ltm-core", "mcp-serve"],
  env: { LTM_DB_PATH: "~/.claude/plugins/data/ltm-ltm/ltm.db" },
};

const HOOKS: Array<{ event: string; args: string[] }> = [
  {
    event: "SessionStart",
    args: ["@rohirik/ltm-core", "hook", "--name", "SessionStart"],
  },
  {
    event: "PreCompact",
    args: ["@rohirik/ltm-core", "hook", "--name", "PreCompact"],
  },
  {
    event: "PostEditCheck",
    args: ["@rohirik/ltm-core", "hook", "--name", "PostEditCheck"],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function settingsPath(homedir: string): string {
  return join(homedir, ".claude", "settings.json");
}

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
  } catch {
    // Malformed JSON → start fresh
    return {};
  }
}

/**
 * Check if the settings already have the LTM MCP entry AND all 3 hooks wired.
 * Used for early-exit idempotency.
 */
function isAlreadyInstalled(settings: ClaudeSettings): boolean {
  // Check MCP entry
  const entry = settings.mcpServers?.[MCP_NAME];
  if (!entry || entry.command !== MCP_ENTRY.command) return false;

  // Check each hook
  for (const hook of HOOKS) {
    const hookList = (settings.hooks as Record<string, unknown> | undefined)?.[hook.event];
    if (!Array.isArray(hookList)) return false;
    const present = hookList.some(
      (h): boolean =>
        typeof h === "object" &&
        h !== null &&
        (h as { command?: string }).command === "bunx" &&
        Array.isArray((h as { args?: unknown[] }).args) &&
        (h as { args: unknown[] }).args[0] === hook.args[0],
    );
    if (!present) return false;
  }
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * installClaude — write or patch ~/.claude/settings.json.
 *
 * @param opts.homedir - Override home directory (useful for tests).
 * @param opts.dryRun  - Compute result without writing any files.
 * @returns InstallResult describing what happened.
 */
export async function installClaude(opts: {
  homedir?: string;
  dryRun?: boolean;
}): Promise<InstallResult> {
  const homedir = opts.homedir ?? os.homedir();
  const dryRun = opts.dryRun ?? false;
  const path = settingsPath(homedir);

  const original = readSettings(path);

  if (isAlreadyInstalled(original)) {
    return { target: "claude", status: "skipped", detail: "already configured" };
  }

  // Apply MCP entry
  let settings = mergeMcpEntry(original, MCP_NAME, MCP_ENTRY);

  // Apply all 3 hooks
  for (const hook of HOOKS) {
    settings = wireHooks(settings, hook.event, "bunx", hook.args);
  }

  if (!dryRun) {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }

  return {
    target: "claude",
    status: "installed",
    detail: dryRun ? "dry-run — no files written" : path,
  };
}
