/**
 * janitor/lock.ts — Cross-process single-instance lock for standalone janitor runs.
 *
 * The in-process `_running` flag in janitor/index.ts only guards one process.
 * The CLI, SessionEnd hook, systemd/launchd timers, and `janitor daemon` can
 * all fire at once, so standalone runs take an O_EXCL lock file that sits
 * next to the database: `<db>.janitor.lock`.
 *
 * Same atomic-create pattern as hooks/lib/resolveProject.ts. A lock is stale
 * (and reclaimed) when its owner PID is dead on this host, or when it is older
 * than `maxAgeMs`. Contention is reported, never waited on: callers fail
 * closed with a distinct exit code.
 */
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "fs";
import { hostname } from "os";

export interface JanitorLockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

export type JanitorLockResult =
  | { acquired: true; path: string; release: () => void }
  | { acquired: false; path: string; holder: JanitorLockInfo | null };

/** Default upper bound on a lock's age before it is considered abandoned. */
export const JANITOR_LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function janitorLockPath(dbPath: string): string {
  return `${dbPath}.janitor.lock`;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readJanitorLock(path: string): JanitorLockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<JanitorLockInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      host: typeof parsed.host === "string" ? parsed.host : "",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch {
    return null;
  }
}

/** True when the lock at `path` no longer protects a live run. */
export function isJanitorLockStale(path: string, maxAgeMs = JANITOR_LOCK_MAX_AGE_MS, now = Date.now()): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return false; // vanished — nothing to reclaim
  }
  if (now - mtimeMs > maxAgeMs) return true;
  const info = readJanitorLock(path);
  // Unreadable/partial content younger than maxAge: a writer may be mid-create.
  if (!info) return now - mtimeMs > 5_000;
  if (info.host === hostname() && !pidAlive(info.pid)) return true;
  return false;
}

/**
 * Try once to take the janitor lock for `dbPath`. Never blocks.
 * Reclaims a stale lock (dead owner / too old) before trying.
 */
export function acquireJanitorLock(dbPath: string, opts: { maxAgeMs?: number } = {}): JanitorLockResult {
  const path = janitorLockPath(dbPath);
  const maxAgeMs = opts.maxAgeMs ?? JANITOR_LOCK_MAX_AGE_MS;

  if (existsSync(path) && isJanitorLockStale(path, maxAgeMs)) {
    // Rename first so two reclaimers can't both delete a fresh lock.
    const graveyard = `${path}.stale-${process.pid}-${Date.now()}`;
    try {
      renameSync(path, graveyard);
      unlinkSync(graveyard);
    } catch { /* another process reclaimed it first */ }
  }

  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch {
    return { acquired: false, path, holder: readJanitorLock(path) };
  }

  const info: JanitorLockInfo = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  try {
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    // Only remove the lock if it is still ours.
    const current = readJanitorLock(path);
    if (current && (current.pid !== info.pid || current.startedAt !== info.startedAt)) return;
    try { unlinkSync(path); } catch { /* already gone */ }
  };
  return { acquired: true, path, release };
}
