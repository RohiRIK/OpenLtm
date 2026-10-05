/**
 * cli/janitor.ts — `ltm janitor <run|status|schedule|daemon>`.
 *
 * Curates the LTM SQLite database without graph-server and without Honker.
 * `run` calls the same `runJanitor()` pipeline the server uses:
 *   embed backfill → decay → archive → promote → dedup *suggestions* (pending
 *   rows for review; nothing is auto-merged or superseded).
 *
 * DB path: --db > LTM_DB_PATH > CLAUDE_PLUGIN_DATA/openltm.db > dev fallback
 * (paths.ts — the same resolution `ltm memory` and the adapters use).
 * No HTTP to graph-server anywhere in this file.
 *
 * Exit codes:
 *   0 success (including "skipped: not due")
 *   1 usage error
 *   2 runtime error, or the run finished with step errors
 *   3 database not found (fail closed — the janitor never creates a DB)
 *   4 another janitor run holds the lock (fail closed — never waits)
 */
import { spawn } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { getDbPath } from "../paths.js";
import { configure, getDb, getSetting, waitForInit } from "../shared-db.js";
import { SETTING_KEYS } from "../janitor/providers/types.js";
import { acquireJanitorLock, janitorLockPath, readJanitorLock, isJanitorLockStale } from "../janitor/lock.js";
import {
  DEFAULT_JANITOR_CHECK_MINUTES,
  defaultScheduleKind,
  isJanitorDue,
  nextJanitorDueAt,
  renderSchedule,
  resolveRunIntervalMinutes,
  type ScheduleKind,
} from "../janitor/schedule.js";

export const JANITOR_EXIT = { OK: 0, USAGE: 1, RUNTIME: 2, NO_DB: 3, LOCKED: 4 } as const;

export type JanitorCommand = "run" | "status" | "schedule" | "daemon";

export interface ParsedJanitorArgs {
  ok: true;
  command: JanitorCommand;
  dbPath?: string;
  json: boolean;
  quiet: boolean;
  ifDue: boolean;
  intervalMinutes?: number;
  maxMinutes: number;
  checkMinutes: number;
  scheduleKind?: ScheduleKind;
  write: boolean;
  runtime?: string;
  bin?: string;
}

export interface JanitorArgsError {
  ok: false;
  error: string;
}

export interface JanitorCommandResult {
  exitCode: number;
  output: string;
}

/** Absolute path of the CLI entrypoint, used for detached spawns and rendered units. */
export const LTM_BIN_PATH = join(import.meta.dir, "bin.ts");

const DEFAULT_MAX_MINUTES = 60;
const COMMANDS: readonly JanitorCommand[] = ["run", "status", "schedule", "daemon"];
const SCHEDULE_KINDS: readonly ScheduleKind[] = ["systemd", "launchd", "cron"];

// ── Parsing ───────────────────────────────────────────────────────────────────

function scanFlags(argv: string[]): { flags: Record<string, string | true>; positionals: string[] } {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && VALUE_FLAGS.has(name)) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { flags, positionals };
}

const VALUE_FLAGS = new Set(["db", "interval-minutes", "max-minutes", "check-minutes", "runtime", "bin"]);
const BOOL_FLAGS = new Set(["json", "quiet", "if-due", "write"]);

function positiveIntFlag(flags: Record<string, string | true>, name: string): number | undefined | "invalid" {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (v === true) return "invalid";
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 && String(n) === v.trim() ? n : "invalid";
}

/** Pure parser for argv after `janitor`. Never exits the process. */
export function parseJanitorArgs(argv: string[]): ParsedJanitorArgs | JanitorArgsError {
  const command = argv[0];
  if (!command || command.startsWith("--")) {
    return { ok: false, error: `missing subcommand — expected one of: ${COMMANDS.join(", ")}` };
  }
  if (!COMMANDS.includes(command as JanitorCommand)) {
    return { ok: false, error: `unknown janitor subcommand '${command}' — expected one of: ${COMMANDS.join(", ")}` };
  }

  const { flags, positionals } = scanFlags(argv.slice(1));
  for (const name of Object.keys(flags)) {
    if (!VALUE_FLAGS.has(name) && !BOOL_FLAGS.has(name)) return { ok: false, error: `unknown flag --${name}` };
    if (VALUE_FLAGS.has(name) && flags[name] === true) return { ok: false, error: `--${name} needs a value` };
  }

  const intervalMinutes = positiveIntFlag(flags, "interval-minutes");
  if (intervalMinutes === "invalid") return { ok: false, error: "--interval-minutes must be a positive integer" };
  const maxMinutes = positiveIntFlag(flags, "max-minutes");
  if (maxMinutes === "invalid") return { ok: false, error: "--max-minutes must be a positive integer" };
  const checkMinutes = positiveIntFlag(flags, "check-minutes");
  if (checkMinutes === "invalid") return { ok: false, error: "--check-minutes must be a positive integer" };

  let scheduleKind: ScheduleKind | undefined;
  if (command === "schedule") {
    const kind = positionals[0];
    if (kind !== undefined) {
      if (!SCHEDULE_KINDS.includes(kind as ScheduleKind)) {
        return { ok: false, error: `schedule: unknown kind '${kind}' — expected one of: ${SCHEDULE_KINDS.join(", ")}` };
      }
      scheduleKind = kind as ScheduleKind;
    } else {
      scheduleKind = defaultScheduleKind();
    }
    if (positionals.length > 1) return { ok: false, error: `unexpected argument '${positionals[1]}'` };
  } else if (positionals.length > 0) {
    return { ok: false, error: `unexpected argument '${positionals[0]}'` };
  }

  return {
    ok: true,
    command: command as JanitorCommand,
    dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
    json: flags["json"] === true,
    quiet: flags["quiet"] === true,
    ifDue: flags["if-due"] === true,
    intervalMinutes,
    maxMinutes: maxMinutes ?? DEFAULT_MAX_MINUTES,
    checkMinutes: checkMinutes ?? DEFAULT_JANITOR_CHECK_MINUTES,
    scheduleKind,
    write: flags["write"] === true,
    runtime: typeof flags["runtime"] === "string" ? flags["runtime"] : undefined,
    bin: typeof flags["bin"] === "string" ? flags["bin"] : undefined,
  };
}

// ── DB access ─────────────────────────────────────────────────────────────────

export function resolveJanitorDbPath(flag?: string): string {
  return resolve(flag ?? getDbPath());
}

let _openedPath: string | null = null;

/** Point the shared DB singleton at `dbPath` and wait for migrations. */
async function openJanitorDb(dbPath: string): Promise<void> {
  if (_openedPath === dbPath) return;
  if (_openedPath !== null) throw new Error(`janitor already opened ${_openedPath}; cannot switch to ${dbPath}`);
  configure({ dbPath });
  await waitForInit();
  _openedPath = dbPath;
}

function noDb(dbPath: string, json: boolean, cmd: string): JanitorCommandResult {
  const msg = `database not found at ${dbPath} — set LTM_DB_PATH or pass --db <path> (the janitor never creates a database)`;
  return { exitCode: JANITOR_EXIT.NO_DB, output: json ? JSON.stringify({ ok: false, error: "no-db", dbPath, message: msg }) : `  ltm janitor ${cmd}: ${msg}` };
}

function intervalFor(parsed: ParsedJanitorArgs): number {
  let setting: string | null = null;
  try { setting = getSetting(SETTING_KEYS.JANITOR_INTERVAL_MINUTES); } catch { /* DB not open */ }
  return resolveRunIntervalMinutes({ flag: parsed.intervalMinutes, env: process.env["LTM_JANITOR_INTERVAL_MINUTES"], setting });
}

// ── run ───────────────────────────────────────────────────────────────────────

async function runOnce(parsed: ParsedJanitorArgs): Promise<JanitorCommandResult> {
  const dbPath = resolveJanitorDbPath(parsed.dbPath);
  if (!existsSync(dbPath)) return noDb(dbPath, parsed.json, "run");

  const lock = acquireJanitorLock(dbPath);
  if (!lock.acquired) {
    const h = lock.holder;
    const who = h ? `pid ${h.pid}${h.host ? ` on ${h.host}` : ""} since ${h.startedAt}` : "unknown holder";
    const msg = `another janitor run holds ${lock.path} (${who})`;
    return {
      exitCode: JANITOR_EXIT.LOCKED,
      output: parsed.json ? JSON.stringify({ ok: false, error: "locked", lockPath: lock.path, holder: h }) : `  ltm janitor run: ${msg}`,
    };
  }
  const onExit = (): void => lock.release();
  process.once("exit", onExit);

  let watchdog: ReturnType<typeof setTimeout> | null = null;
  try {
    await openJanitorDb(dbPath);

    if (parsed.ifDue) {
      const interval = intervalFor(parsed);
      const lastRunAt = getSetting(SETTING_KEYS.JANITOR_LAST_RUN_AT) || null;
      if (!isJanitorDue(lastRunAt, interval)) {
        const nextDueAt = nextJanitorDueAt(lastRunAt, interval);
        return {
          exitCode: JANITOR_EXIT.OK,
          output: parsed.json
            ? JSON.stringify({ ok: true, skipped: true, reason: "not-due", dbPath, lastRunAt, nextDueAt, intervalMinutes: interval })
            : parsed.quiet
              ? `[${new Date().toISOString()}] janitor skipped: not due until ${nextDueAt}`
              : `  ltm janitor run: skipped — last run ${lastRunAt}, next due ${nextDueAt} (interval ${interval} min)`,
        };
      }
    }

    // Unattended runs must not hang forever on a stuck provider (e.g. an
    // Ollama chat call with no timeout). Release the lock and bail.
    watchdog = setTimeout(() => {
      lock.release();
      process.stderr.write(`  ltm janitor run: exceeded --max-minutes ${parsed.maxMinutes}; aborting\n`);
      process.exit(JANITOR_EXIT.RUNTIME);
    }, parsed.maxMinutes * 60_000);
    watchdog.unref?.();

    const { runJanitor } = await import("../janitor/index.js");
    const r = await runJanitor();
    const exitCode = r.errors.length > 0 ? JANITOR_EXIT.RUNTIME : JANITOR_EXIT.OK;

    if (parsed.json) return { exitCode, output: JSON.stringify({ ok: exitCode === 0, dbPath, ...r }) };
    if (parsed.quiet) {
      return {
        exitCode,
        output: `[${r.timestamp}] janitor ${exitCode === 0 ? "ok" : "errors"} embed=${r.embed.embedded} decay=${r.decay.refreshed}/${r.decay.deprecated} archive=${r.archive.archived} promote=${r.promote.promoted} dedup=${r.dedup.candidatesFound} (${r.durationMs}ms)${r.errors.length ? ` errors=${JSON.stringify(r.errors)}` : ""}`,
      };
    }
    const lines = [
      `  janitor run ${exitCode === 0 ? "complete" : "finished with errors"} in ${r.durationMs}ms (db: ${dbPath})`,
      `    embed:   ${r.embed.embedded} new vectors`,
      `    decay:   ${r.decay.refreshed} refreshed, ${r.decay.deprecated} deprecated`,
      `    archive: ${r.archive.archived} archived`,
      `    promote: ${r.promote.promoted} promoted of ${r.promote.scanned} scanned`,
      `    dedup:   ${r.dedup.pairsCompared} pairs compared, ${r.dedup.candidatesFound} suggestions (pending review — nothing merged)`,
      ...r.errors.map((e) => `    error:   ${e}`),
    ];
    return { exitCode, output: lines.join("\n") };
  } catch (err) {
    return {
      exitCode: JANITOR_EXIT.RUNTIME,
      output: parsed.json ? JSON.stringify({ ok: false, error: "runtime", message: String(err) }) : `  ltm janitor run: ${String(err)}`,
    };
  } finally {
    if (watchdog) clearTimeout(watchdog);
    process.removeListener("exit", onExit);
    lock.release();
  }
}

// ── status ────────────────────────────────────────────────────────────────────

async function status(parsed: ParsedJanitorArgs): Promise<JanitorCommandResult> {
  const dbPath = resolveJanitorDbPath(parsed.dbPath);
  if (!existsSync(dbPath)) return noDb(dbPath, parsed.json, "status");
  try {
    await openJanitorDb(dbPath);
    const lockPath = janitorLockPath(dbPath);
    const holder = existsSync(lockPath) ? readJanitorLock(lockPath) : null;
    const lockHeld = existsSync(lockPath) && !isJanitorLockStale(lockPath);
    const interval = intervalFor(parsed);
    const lastRunAt = getSetting(SETTING_KEYS.JANITOR_LAST_RUN_AT) || null;
    const num = (k: string): number => Number.parseInt(getSetting(k) ?? "0", 10) || 0;
    const pendingDedup = getDb()
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM memories WHERE status = 'pending' AND source LIKE 'dedup:%'")
      .get()?.n ?? 0;
    const s = {
      ok: true,
      dbPath,
      lastRunAt,
      due: isJanitorDue(lastRunAt, interval),
      nextDueAt: nextJanitorDueAt(lastRunAt, interval),
      intervalMinutes: interval,
      last: {
        decayRefreshed: num(SETTING_KEYS.JANITOR_LAST_DECAY_REFRESHED),
        deprecated: num(SETTING_KEYS.JANITOR_LAST_DEPRECATED),
        archived: num(SETTING_KEYS.JANITOR_LAST_ARCHIVED),
      },
      pendingDedupSuggestions: pendingDedup,
      lock: { path: lockPath, held: lockHeld, holder: lockHeld ? holder : null },
    };
    if (parsed.json) return { exitCode: JANITOR_EXIT.OK, output: JSON.stringify(s) };
    return {
      exitCode: JANITOR_EXIT.OK,
      output: [
        `  db:        ${dbPath}`,
        `  last run:  ${lastRunAt ?? "never"}`,
        `  interval:  ${interval} min — ${s.due ? "due now" : `next due ${s.nextDueAt}`}`,
        `  last pass: ${s.last.decayRefreshed} decay-refreshed, ${s.last.deprecated} deprecated, ${s.last.archived} archived`,
        `  dedup:     ${pendingDedup} suggestions pending review`,
        `  lock:      ${lockHeld && holder ? `held by pid ${holder.pid} since ${holder.startedAt}` : "free"}`,
      ].join("\n"),
    };
  } catch (err) {
    return { exitCode: JANITOR_EXIT.RUNTIME, output: `  ltm janitor status: ${String(err)}` };
  }
}

// ── schedule ──────────────────────────────────────────────────────────────────

function looksEphemeral(p: string): boolean {
  return /[\\/]bunx-|[\\/]\.bun[\\/]install[\\/]cache[\\/]|[\\/]_npx[\\/]/.test(p);
}

function schedule(parsed: ParsedJanitorArgs): JanitorCommandResult {
  const dbPath = resolveJanitorDbPath(parsed.dbPath);
  if (!existsSync(dbPath)) return noDb(dbPath, parsed.json, "schedule");
  const kind = parsed.scheduleKind ?? defaultScheduleKind();
  const runtime = parsed.runtime ?? (typeof Bun !== "undefined" ? process.execPath : "bun");
  const bin = resolve(parsed.bin ?? LTM_BIN_PATH);
  const runIntervalMinutes = resolveRunIntervalMinutes({ flag: parsed.intervalMinutes, env: process.env["LTM_JANITOR_INTERVAL_MINUTES"] });
  const rendered = renderSchedule(kind, {
    runtime, bin, dbPath, runIntervalMinutes, checkMinutes: parsed.checkMinutes, pathEnv: process.env["PATH"],
  });

  const warnings: string[] = [];
  if (looksEphemeral(bin)) {
    warnings.push(`bin ${bin} looks like a bunx/npx cache path that may be cleaned up; install the package (e.g. \`bun add -g @rohirik/openltm-core\`) or pass --bin <stable path to cli/bin.ts>`);
  }

  if (parsed.write) {
    if (rendered.files.length === 0) {
      return { exitCode: JANITOR_EXIT.USAGE, output: `  ltm janitor schedule: --write is not supported for ${kind}; add the printed line with \`crontab -e\`\n${rendered.activate.join("\n")}` };
    }
    try {
      for (const f of rendered.files) {
        mkdirSync(dirname(f.path), { recursive: true });
        writeFileSync(f.path, f.content, "utf-8");
      }
    } catch (err) {
      return { exitCode: JANITOR_EXIT.RUNTIME, output: `  ltm janitor schedule: ${String(err)}` };
    }
  }

  if (parsed.json) {
    return { exitCode: JANITOR_EXIT.OK, output: JSON.stringify({ ok: true, written: parsed.write, warnings, ...rendered }) };
  }
  const out: string[] = [];
  for (const w of warnings) out.push(`  warning: ${w}`);
  for (const f of rendered.files) {
    out.push(parsed.write ? `  wrote ${f.path}` : `# ── ${f.path} ──`);
    if (!parsed.write) out.push(f.content);
  }
  out.push(parsed.write || rendered.files.length === 0 ? "  next:" : "# write these files with --write, then:");
  out.push(...rendered.activate.map((c) => `    ${c}`));
  out.push("  undo:");
  out.push(...rendered.deactivate.map((c) => `    ${c}`));
  return { exitCode: JANITOR_EXIT.OK, output: out.join("\n") };
}

// ── daemon ────────────────────────────────────────────────────────────────────

/**
 * Foreground loop for hosts with neither systemd nor launchd (containers, tmux).
 * Every --check-minutes it does a `run --if-due`. Missing DB is fatal; a held
 * lock is logged and retried next tick.
 */
async function daemon(parsed: ParsedJanitorArgs): Promise<number> {
  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = (): void => { stopping = true; wake?.(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const tick: ParsedJanitorArgs = { ...parsed, ifDue: true, quiet: !parsed.json };
  process.stdout.write(`  ltm janitor daemon: checking every ${parsed.checkMinutes} min (Ctrl-C to stop)\n`);
  while (!stopping) {
    const r = await runOnce(tick);
    (r.exitCode === 0 ? process.stdout : process.stderr).write(r.output + "\n");
    if (r.exitCode === JANITOR_EXIT.NO_DB) return r.exitCode;
    if (stopping) break;
    await new Promise<void>((res) => {
      const t = setTimeout(res, parsed.checkMinutes * 60_000);
      wake = () => { clearTimeout(t); res(); };
    });
  }
  return JANITOR_EXIT.OK;
}

// ── Detached spawn (hooks) ────────────────────────────────────────────────────

export interface SpawnJanitorResult {
  spawned: boolean;
  reason?: "disabled" | "no-db" | "error";
  pid?: number;
  logPath?: string;
}

/**
 * Fire-and-forget `ltm janitor run --if-due --quiet` for lifecycle hooks
 * (SessionEnd). Returns immediately; the child is detached so the hook host
 * can exit. Output appends to `<db dir>/janitor.log`.
 * Opt out with LTM_JANITOR_ON_SESSION_END=0.
 */
export function spawnJanitorDetached(opts: { dbPath?: string; env?: NodeJS.ProcessEnv } = {}): SpawnJanitorResult {
  const env = opts.env ?? process.env;
  const flag = (env["LTM_JANITOR_ON_SESSION_END"] ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return { spawned: false, reason: "disabled" };

  const dbPath = resolve(opts.dbPath ?? env["LTM_DB_PATH"] ?? getDbPath());
  if (!existsSync(dbPath)) return { spawned: false, reason: "no-db" };

  const logPath = join(dirname(dbPath), "janitor.log");
  const runtime = typeof Bun !== "undefined" ? process.execPath : "bun";
  let fd: number | null = null;
  try {
    fd = openSync(logPath, "a");
    const child = spawn(runtime, [LTM_BIN_PATH, "janitor", "run", "--if-due", "--quiet", "--db", dbPath], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...env, LTM_DB_PATH: dbPath },
    });
    child.on("error", () => { /* best-effort: never fail the hook */ });
    child.unref();
    return { spawned: true, pid: child.pid, logPath };
  } catch {
    return { spawned: false, reason: "error", logPath };
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

// ── Entrypoint glue ───────────────────────────────────────────────────────────

/** Execute a parsed janitor command (run/status/schedule). `daemon` goes through runJanitorCli. */
export async function runJanitorCommand(parsed: ParsedJanitorArgs): Promise<JanitorCommandResult> {
  switch (parsed.command) {
    case "run": return runOnce(parsed);
    case "status": return status(parsed);
    case "schedule": return schedule(parsed);
    case "daemon": return { exitCode: JANITOR_EXIT.USAGE, output: "  use runJanitorCli for daemon" };
  }
}

export function printJanitorHelp(): string {
  return [
    "",
    "  ltm janitor <command> [options]",
    "",
    "  Curates the memory DB without graph-server or Honker:",
    "  embed backfill → decay → archive → promote → dedup suggestions (review only).",
    "",
    "  Commands:",
    "    run       [--if-due] [--interval-minutes N] [--max-minutes N] [--json|--quiet]",
    "    status    [--json]",
    "    schedule  [systemd|launchd|cron] [--write] [--check-minutes N] [--interval-minutes N]",
    "              [--runtime <bun>] [--bin <cli/bin.ts>]   print (or write) a background unit",
    "    daemon    [--check-minutes N] [--interval-minutes N]  foreground loop, no systemd/launchd",
    "",
    "  Common: --db <path>  (default: LTM_DB_PATH > CLAUDE_PLUGIN_DATA/openltm.db)",
    "  Interval: --interval-minutes > LTM_JANITOR_INTERVAL_MINUTES > ltm.janitor.intervalMinutes > 360",
    "",
    "  Exit codes: 0 ok/skipped · 1 usage · 2 runtime or step errors · 3 DB not found · 4 lock held",
    "",
  ].join("\n");
}

/** Top-level handler invoked by bin.ts. Handles I/O + exit code. */
export async function runJanitorCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(printJanitorHelp());
    return argv.length === 0 ? JANITOR_EXIT.USAGE : JANITOR_EXIT.OK;
  }
  const parsed = parseJanitorArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`  ltm janitor: ${parsed.error}\n`);
    process.stderr.write(printJanitorHelp());
    return JANITOR_EXIT.USAGE;
  }
  if (parsed.command === "daemon") return daemon(parsed);
  const result = await runJanitorCommand(parsed);
  (result.exitCode === 0 ? process.stdout : process.stderr).write(result.output + "\n");
  return result.exitCode;
}
