import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { enforceRetention, getRetentionDefault } from "../../migrations.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ltm-retention-"));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function makeBak(name: string, ageSeconds: number = 120): string {
  const path = join(tmpDir, name);
  writeFileSync(path, "x".repeat(100));
  const past = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(path, past, past);
  return path;
}

describe("enforceRetention", () => {
  it("returns empty result on empty directory", async () => {
    const result = await enforceRetention(1, { dbPath: join(tmpDir, "openltm.db") });
    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps all files when under max", async () => {
    const a = makeBak("openltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const b = makeBak("openltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    const result = await enforceRetention(5, { dbPath: join(tmpDir, "openltm.db") });
    expect(result.deleted).toEqual([]);
    expect(result.kept.sort()).toEqual([a, b].sort());
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });

  it("deletes oldest when over max", async () => {
    const f1 = makeBak("openltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const f2 = makeBak("openltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    const f3 = makeBak("openltm.db.bak-2026-01-03T00-00-00-000Z", 200);
    const f4 = makeBak("openltm.db.bak-2026-01-04T00-00-00-000Z", 200);
    const f5 = makeBak("openltm.db.bak-2026-01-05T00-00-00-000Z", 200);
    const result = await enforceRetention(2, { dbPath: join(tmpDir, "openltm.db") });
    expect(result.deleted.sort()).toEqual([f1, f2, f3].sort());
    expect(result.kept.sort()).toEqual([f4, f5].sort());
    expect(existsSync(f1)).toBe(false);
    expect(existsSync(f5)).toBe(true);
  });

  it("never deletes the currentBackupPath", async () => {
    const f1 = makeBak("openltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const f2 = makeBak("openltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    const f3 = makeBak("openltm.db.bak-2026-01-03T00-00-00-000Z", 200);
    const result = await enforceRetention(1, {
      dbPath: join(tmpDir, "openltm.db"),
      currentBackupPath: f2,
    });
    expect(result.deleted).not.toContain(f2);
    expect(result.kept).toContain(f2);
  });

  it("skips files newer than gracePeriodMs", async () => {
    const old = makeBak("openltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const fresh = makeBak("openltm.db.bak-2026-06-03T16-00-00-000Z", 0);
    const result = await enforceRetention(0, {
      dbPath: join(tmpDir, "openltm.db"),
      gracePeriodMs: 60_000,
    });
    expect(result.deleted).toEqual([old]);
    expect(result.kept).toEqual([fresh]);
    expect(existsSync(fresh)).toBe(true);
  });

  it("reads LTM_BACKUP_RETENTION env var as default", () => {
    const original = process.env["LTM_BACKUP_RETENTION"];
    try {
      process.env["LTM_BACKUP_RETENTION"] = "5";
      expect(getRetentionDefault()).toBe(5);
      process.env["LTM_BACKUP_RETENTION"] = "invalid";
      expect(getRetentionDefault()).toBe(1);
      process.env["LTM_BACKUP_RETENTION"] = "-1";
      expect(getRetentionDefault()).toBe(1);
      delete process.env["LTM_BACKUP_RETENTION"];
      expect(getRetentionDefault()).toBe(1);
    } finally {
      if (original === undefined) delete process.env["LTM_BACKUP_RETENTION"];
      else process.env["LTM_BACKUP_RETENTION"] = original;
    }
  });

  it("does not touch non-.bak files", async () => {
    writeFileSync(join(tmpDir, "openltm.db"), "active");
    writeFileSync(join(tmpDir, "openltm.db-shm"), "shm");
    writeFileSync(join(tmpDir, "openltm.db-wal"), "wal");
    const bak = makeBak("openltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const result = await enforceRetention(0, { dbPath: join(tmpDir, "openltm.db") });
    expect(result.deleted).toEqual([bak]);
    expect(existsSync(join(tmpDir, "openltm.db"))).toBe(true);
    expect(existsSync(join(tmpDir, "openltm.db-shm"))).toBe(true);
    expect(existsSync(join(tmpDir, "openltm.db-wal"))).toBe(true);
  });

  it("is idempotent and silent when files disappear before the call", async () => {
    const f1 = makeBak("openltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const f2 = makeBak("openltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    rmSync(f1);
    const result = await enforceRetention(0, { dbPath: join(tmpDir, "openltm.db") });
    expect(result.deleted).toEqual([f2]);
    expect(result.warnings).toEqual([]);
    expect(result.kept).toEqual([]);
  });
});

describe("enforceRetention — only backupDb-named regular files", () => {
  it("leaves user files, symlinks and dirs untouched and uncounted", async () => {
    const { mkdirSync, symlinkSync, lstatSync } = await import("fs");
    const dbPath = join(tmpDir, "x.db");
    const real1 = makeBak("x.db.bak-2026-01-01T00-00-00-000Z", 200);
    const real2 = makeBak("x.db.bak-2026-01-02T00-00-00-000Z", 200);
    const notes = makeBak("x.db.bak-notes", 200);
    const almost = makeBak("x.db.bak-2026-01-01T00-00-00-000Z.old", 200);
    const otherDb = makeBak("xxdb.bak-2026-01-01T00-00-00-000Z", 200); // '.' must be literal
    const target = makeBak("keep-me.txt", 200);
    const link = join(tmpDir, "x.db.bak-2025-01-01T00-00-00-000Z");
    symlinkSync(target, link);
    const dir = join(tmpDir, "x.db.bak-2024-01-01T00-00-00-000Z");
    mkdirSync(dir);

    const result = await enforceRetention(1, { dbPath });
    expect(result.deleted).toEqual([real1]);
    expect(result.kept).toEqual([real2]);
    for (const p of [notes, almost, otherDb, target]) expect(existsSync(p)).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(lstatSync(dir).isDirectory()).toBe(true);
    expect(existsSync(real2)).toBe(true);
  });

  it("orders by timestamp, then numeric suffix (-10 after -9, bare before -1)", async () => {
    const dbPath = join(tmpDir, "openltm.db");
    const ts = "openltm.db.bak-2026-03-01T00-00-00-000Z";
    const bare = makeBak(ts, 200);
    const s1 = makeBak(`${ts}-1`, 200);
    const s2 = makeBak(`${ts}-2`, 200);
    const s9 = makeBak(`${ts}-9`, 200);
    const s10 = makeBak(`${ts}-10`, 200);
    const older = makeBak("openltm.db.bak-2026-02-28T23-59-59-999Z-5", 200);
    const newer = makeBak("openltm.db.bak-2026-03-02T00-00-00-000Z", 200);

    const result = await enforceRetention(2, { dbPath });
    expect(result.deleted).toEqual([older, bare, s1, s2, s9]);
    expect(result.kept).toEqual([s10, newer]);
  });
});
