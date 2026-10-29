#!/usr/bin/env bun
/**
 * ensure-deps.ts — install the plugin's packages when Claude Code didn't.
 *
 * Claude Code installs a plugin's packages only when its bun.lock lists the
 * plugin as the only workspace. This repo is a monorepo (root + packages/*), so a
 * marketplace install lands without node_modules ("The packages it lists were
 * not installed, because its bun.lock does not list the plugin as its only
 * workspace") and every hook and the MCP server fail with
 * "Cannot find module '@rohirik/openltm-core'".
 *
 * The first launcher that notices (hooks/bin/run-hook.sh, src/mcp-server.ts)
 * runs `bun install --frozen-lockfile` in the plugin root, the same install
 * Claude Code would run. It runs detached and holds a lock directory, so a hook
 * killed at its timeout doesn't kill the install half-way and concurrent
 * launchers don't start a second one; they wait for it instead.
 *
 * Imports node builtins only: this runs before node_modules exists. Never
 * writes to stdout — hook stdout is injected into the session and the MCP
 * server's stdout is its protocol channel.
 *
 * CLI: bun scripts/ensure-deps.ts <plugin-root> [--wait-ms N]
 *      exit 0 when the packages are ready, 1 when not (yet).
 */
import { existsSync, mkdirSync, openSync, rmSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { spawn } from "child_process";

/** Packages the hooks and the MCP server import at startup. */
const SENTINELS = [["@rohirik", "openltm-core"], ["@modelcontextprotocol", "sdk"], ["zod"]];
export const DEPS_LOCK = ".deps-install.lock";
/** A lock older than this belongs to an install that died (e.g. a reboot). */
const STALE_LOCK_MS = 10 * 60_000;

/** True when the packages are installed and no install is still running. */
export function pluginDepsReady(root: string): boolean {
  return (
    !existsSync(join(root, DEPS_LOCK)) &&
    SENTINELS.every((p) => existsSync(join(root, "node_modules", ...p, "package.json")))
  );
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Take the lock and start a detached install. False when another one holds the lock. */
function startInstall(root: string, bun: string, logPath: string, env: NodeJS.ProcessEnv): boolean {
  const lock = join(root, DEPS_LOCK);
  try {
    mkdirSync(lock);
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs < STALE_LOCK_MS) return false;
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock);
    } catch {
      return false;
    }
  }
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = openSync(logPath, "a");
    // The install releases the lock itself when it ends, success or not.
    const child = spawn("/bin/sh", ["-c", '"$0" install --frozen-lockfile; rmdir "$1"', bun, lock], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
      env,
    });
    child.unref();
    return true;
  } catch (err) {
    rmSync(lock, { recursive: true, force: true });
    process.stderr.write(`openltm: could not start bun install in ${root}: ${(err as Error).message}\n`);
    return false;
  }
}

export interface EnsureDepsOptions {
  /** How long to wait for the install to finish (default 0: start it and return). */
  waitMs?: number;
  /** The bun binary to install with (default: the running one). */
  bun?: string;
  /** Install log (default: $CLAUDE_PLUGIN_DATA/deps-install.log, else in the plugin root). */
  logPath?: string;
  /** Environment for the installer and its lifecycle scripts. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Make sure the plugin's packages are installed: start the install when they
 * are missing and nobody else is installing, then wait up to `waitMs` for it.
 * Returns whether they are ready.
 */
export function ensurePluginDeps(root: string, opts: EnsureDepsOptions = {}): boolean {
  if (pluginDepsReady(root)) return true;
  const logPath = opts.logPath ?? join(process.env.CLAUDE_PLUGIN_DATA || root, "deps-install.log");
  if (startInstall(root, opts.bun ?? process.execPath, logPath, opts.env ?? process.env)) {
    process.stderr.write(
      `openltm: installing the plugin's packages (bun install --frozen-lockfile in ${root}); log: ${logPath}\n`,
    );
  }
  const deadline = Date.now() + (opts.waitMs ?? 0);
  while (!pluginDepsReady(root) && Date.now() < deadline) sleep(200);
  return pluginDepsReady(root);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = resolve(args[0] ?? join(import.meta.dir, ".."));
  const i = args.indexOf("--wait-ms");
  const waitMs = i >= 0 ? Number(args[i + 1]) || 0 : 0;
  process.exit(ensurePluginDeps(root, { waitMs }) ? 0 : 1);
}
