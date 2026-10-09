/**
 * lock.test.ts — cross-process single-instance lock for standalone janitor runs.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { acquireJanitorLock, isJanitorLockStale, janitorLockPath } from "../../janitor/lock.js";

describe("janitor lock", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ltm-janitor-lock-"));
    dbPath = join(dir, "ltm.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("acquires, records owner, and releases", () => {
    const lock = acquireJanitorLock(dbPath);
    expect(lock.acquired).toBe(true);
    if (!lock.acquired) return;
    expect(lock.path).toBe(janitorLockPath(dbPath));
    const info = JSON.parse(readFileSync(lock.path, "utf-8"));
    expect(info.pid).toBe(process.pid);
    expect(info.host).toBe(hostname());
    lock.release();
    expect(existsSync(lock.path)).toBe(false);
  });

  it("second acquire fails closed while the first is held, with holder info", () => {
    const first = acquireJanitorLock(dbPath);
    expect(first.acquired).toBe(true);
    const second = acquireJanitorLock(dbPath);
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    expect(second.holder?.pid).toBe(process.pid);
    if (first.acquired) first.release();
    const third = acquireJanitorLock(dbPath);
    expect(third.acquired).toBe(true);
    if (third.acquired) third.release();
  });

  it("reclaims a lock whose owner pid is dead on this host", () => {
    const path = janitorLockPath(dbPath);
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), startedAt: "2020-01-01T00:00:00Z" }));
    expect(isJanitorLockStale(path)).toBe(true);
    const lock = acquireJanitorLock(dbPath);
    expect(lock.acquired).toBe(true);
    if (lock.acquired) lock.release();
  });

  it("does not reclaim a fresh lock held by a live pid", () => {
    const path = janitorLockPath(dbPath);
    writeFileSync(path, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
    expect(isJanitorLockStale(path)).toBe(false);
    expect(acquireJanitorLock(dbPath).acquired).toBe(false);
  });

  it("reclaims a lock older than maxAgeMs even if the pid is alive", () => {
    const path = janitorLockPath(dbPath);
    writeFileSync(path, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: "old" }));
    const old = (Date.now() - 10 * 60_000) / 1000;
    utimesSync(path, old, old);
    const lock = acquireJanitorLock(dbPath, { maxAgeMs: 60_000 });
    expect(lock.acquired).toBe(true);
    if (lock.acquired) lock.release();
  });

  it("release does not delete a lock that was re-taken by someone else", () => {
    const lock = acquireJanitorLock(dbPath);
    if (!lock.acquired) throw new Error("expected lock");
    writeFileSync(lock.path, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: "someone-else" }));
    lock.release();
    expect(existsSync(lock.path)).toBe(true);
  });
});

describe("runJanitorExclusive — every in-process janitor path takes the file lock", () => {
  it("returns null without running while another process holds <db>.janitor.lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ltm-janitor-excl-"));
    try {
      const core = await import("../../index.js");
      const dbPath = join(dir, "ltm.db");
      core.configure({ dbPath });
      // Stand-in for another process (graph-server, the CLI, the SessionEnd trigger).
      writeFileSync(janitorLockPath(dbPath), JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
      expect(await core.runJanitorExclusive()).toBeNull();
      expect(core.getJanitorStatus().running).toBe(false);
      expect(existsSync(janitorLockPath(dbPath))).toBe(true); // someone else's lock is left alone
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
