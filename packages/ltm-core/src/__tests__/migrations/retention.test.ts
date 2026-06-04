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
    const result = await enforceRetention(1, { dbPath: join(tmpDir, "ltm.db") });
    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps all files when under max", async () => {
    const a = makeBak("ltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const b = makeBak("ltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    const result = await enforceRetention(5, { dbPath: join(tmpDir, "ltm.db") });
    expect(result.deleted).toEqual([]);
    expect(result.kept.sort()).toEqual([a, b].sort());
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });

  it("deletes oldest when over max", async () => {
    const f1 = makeBak("ltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const f2 = makeBak("ltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    const f3 = makeBak("ltm.db.bak-2026-01-03T00-00-00-000Z", 200);
    const f4 = makeBak("ltm.db.bak-2026-01-04T00-00-00-000Z", 200);
    const f5 = makeBak("ltm.db.bak-2026-01-05T00-00-00-000Z", 200);
    const result = await enforceRetention(2, { dbPath: join(tmpDir, "ltm.db") });
    expect(result.deleted.sort()).toEqual([f1, f2, f3].sort());
    expect(result.kept.sort()).toEqual([f4, f5].sort());
    expect(existsSync(f1)).toBe(false);
    expect(existsSync(f5)).toBe(true);
  });

  it("never deletes the currentBackupPath", async () => {
    const f1 = makeBak("ltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const f2 = makeBak("ltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    const f3 = makeBak("ltm.db.bak-2026-01-03T00-00-00-000Z", 200);
    const result = await enforceRetention(1, {
      dbPath: join(tmpDir, "ltm.db"),
      currentBackupPath: f2,
    });
    expect(result.deleted).not.toContain(f2);
    expect(result.kept).toContain(f2);
  });

  it("skips files newer than gracePeriodMs", async () => {
    const old = makeBak("ltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const fresh = makeBak("ltm.db.bak-2026-06-03T16-00-00-000Z", 0);
    const result = await enforceRetention(0, {
      dbPath: join(tmpDir, "ltm.db"),
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
    writeFileSync(join(tmpDir, "ltm.db"), "active");
    writeFileSync(join(tmpDir, "ltm.db-shm"), "shm");
    writeFileSync(join(tmpDir, "ltm.db-wal"), "wal");
    const bak = makeBak("ltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const result = await enforceRetention(0, { dbPath: join(tmpDir, "ltm.db") });
    expect(result.deleted).toEqual([bak]);
    expect(existsSync(join(tmpDir, "ltm.db"))).toBe(true);
    expect(existsSync(join(tmpDir, "ltm.db-shm"))).toBe(true);
    expect(existsSync(join(tmpDir, "ltm.db-wal"))).toBe(true);
  });

  it("is idempotent and silent when files disappear before the call", async () => {
    const f1 = makeBak("ltm.db.bak-2026-01-01T00-00-00-000Z", 200);
    const f2 = makeBak("ltm.db.bak-2026-01-02T00-00-00-000Z", 200);
    rmSync(f1);
    const result = await enforceRetention(0, { dbPath: join(tmpDir, "ltm.db") });
    expect(result.deleted).toEqual([f2]);
    expect(result.warnings).toEqual([]);
    expect(result.kept).toEqual([]);
  });
});
