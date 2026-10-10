/**
 * cli/claude.ts — Installer for Claude Code (the `bunx @rohirik/openltm-core --claude` path).
 *
 * Writes what Claude Code actually reads:
 *   - the MCP server into ~/.claude.json (user scope — Claude Code does not load
 *     `mcpServers` from settings.json);
 *   - SessionStart (prefill) and SessionEnd (janitor if due) hooks into
 *     ~/.claude/settings.json in Claude Code's hook format
 *     `{ matcher, hooks: [{ type: "command", command }] }`.
 * Both point at one absolute DB (LTM_DB_PATH), shared with the Claude Code plugin.
 * Earlier versions wrote shapes Claude Code ignored (0 hooks, no MCP server);
 * those entries are removed. Idempotent — safe to run multiple times.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import os from "os";
import type { InstallResult } from "./types.js";

const MCP_NAME = "openltm";
const PACKAGE = "@rohirik/openltm-core";

type HookCommand = { type: "command"; command: string; timeout?: number };
type HookEntry = { matcher?: string; hooks?: HookCommand[]; command?: string; args?: unknown[] };
type Json = Record<string, unknown>;

/** Lifecycle events with a real portable handler (cli/hook.ts); others are no-ops. */
const HOOK_EVENTS: Array<{ event: string; timeout: number }> = [
  { event: "SessionStart", timeout: 15 },
  { event: "SessionEnd", timeout: 10 },
];

/** POSIX single-quote for shell command strings (paths may contain spaces). */
function shQuote(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * bunx by absolute path when we can find it: hook and MCP processes are spawned
 * with a stripped PATH (the reason the plugin ships hooks/bin/run-hook.sh).
 */
function resolveBunx(): string {
  const beside = join(dirname(process.execPath), "bunx");
  return existsSync(beside) ? beside : "bunx";
}

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Json) : {};
  } catch {
    throw new Error(`${path} is not valid JSON — fix or move it aside, then re-run (nothing was changed)`);
  }
}

/** An LTM hook entry from this installer, current or legacy (the shape Claude Code ignored). */
function isLtmEntry(e: HookEntry): boolean {
  if (e.command === "bunx" && Array.isArray(e.args) && e.args[0] === PACKAGE) return true; // legacy
  return Array.isArray(e.hooks) && e.hooks.length > 0
    && e.hooks.every((h) => typeof h?.command === "string" && h.command.includes(`${PACKAGE} hook --name `));
}

export function claudeDbPath(homedir: string): string {
  return join(homedir, ".claude", "plugins", "data", "OpenLtm-openltm", "openltm.db");
}

function desiredHookEntries(dbPath: string, bunx: string): Record<string, HookEntry> {
  const out: Record<string, HookEntry> = {};
  for (const { event, timeout } of HOOK_EVENTS) {
    out[event] = {
      matcher: "",
      hooks: [{ type: "command", command: `LTM_DB_PATH=${shQuote(dbPath)} ${shQuote(bunx)} ${PACKAGE} hook --name ${event}`, timeout }],
    };
  }
  return out;
}

/**
 * installClaude — write or patch ~/.claude.json (MCP) and ~/.claude/settings.json (hooks).
 *
 * @param opts.homedir - Override home directory (useful for tests).
 * @param opts.dryRun  - Compute result without writing any files.
 */
export async function installClaude(opts: { homedir?: string; dryRun?: boolean }): Promise<InstallResult> {
  const homedir = opts.homedir ?? os.homedir();
  const dryRun = opts.dryRun ?? false;
  const settingsPath = join(homedir, ".claude", "settings.json");
  const claudeJsonPath = join(homedir, ".claude.json");
  const dbPath = claudeDbPath(homedir);
  const bunx = resolveBunx();

  let settings: Json;
  let claudeJson: Json;
  try {
    settings = readJson(settingsPath);
    claudeJson = readJson(claudeJsonPath);
  } catch (err) {
    return { target: "claude", status: "error", detail: err instanceof Error ? err.message : String(err) };
  }
  const before = JSON.stringify([settings, claudeJson]);

  // MCP server — user scope in ~/.claude.json.
  const mcpServers = { ...((claudeJson.mcpServers as Json | undefined) ?? {}) };
  mcpServers[MCP_NAME] = { type: "stdio", command: bunx, args: [PACKAGE, "mcp-serve"], env: { LTM_DB_PATH: dbPath } };
  claudeJson = { ...claudeJson, mcpServers };

  // Drop the settings.json MCP entry older versions wrote (never loaded).
  const settingsMcp = settings.mcpServers as Json | undefined;
  if (settingsMcp && MCP_NAME in settingsMcp) {
    const { [MCP_NAME]: _legacy, ...rest } = settingsMcp;
    settings = Object.keys(rest).length > 0 ? { ...settings, mcpServers: rest } : (({ mcpServers: _m, ...s }) => s)(settings);
  }

  // Hooks — remove every LTM entry (current or legacy, any event), then add ours once.
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, list] of Object.entries((settings.hooks as Record<string, HookEntry[]> | undefined) ?? {})) {
    const kept = Array.isArray(list) ? list.filter((e) => !isLtmEntry(e)) : list;
    if (!Array.isArray(kept) || kept.length > 0) hooks[event] = kept;
  }
  for (const [event, entry] of Object.entries(desiredHookEntries(dbPath, bunx))) {
    hooks[event] = [...(hooks[event] ?? []), entry];
  }
  settings = { ...settings, hooks };

  if (JSON.stringify([settings, claudeJson]) === before) {
    return { target: "claude", status: "skipped", detail: "already configured" };
  }
  if (!dryRun) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2) + "\n", "utf8");
  }
  return {
    target: "claude",
    status: "installed",
    detail: dryRun ? "dry-run — no files written" : `${claudeJsonPath} (MCP), ${settingsPath} (hooks)`,
  };
}
