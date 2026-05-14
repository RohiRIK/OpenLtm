/**
 * Migration test for 008_add_memory_provenance + 009_add_memory_audit.
 * Verifies: tables created, indexes present, legacy backfill applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-migrations-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  // Seed 3 memories before migration runs
  for (let i = 1; i <= 3; i++) {
    db.run(
      `INSERT INTO memories (content, category, importance, confidence, source, project_scope, dedup_key)
       VALUES (?, 'pattern', 3, 1.0, NULL, NULL, ?)`,
      [`Migration test memory ${i}`, `bench-dedup-${i}`]
    );
  }

  const { _setDbForTesting, waitForInit } = await import("@rohirik/ltm-core");
  _setDbForTesting(db);
  await waitForInit();

  const { runPendingMigrations } = await import("@rohirik/ltm-core");
  await runPendingMigrations(db);
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("migration 008 — memory_provenance", () => {
  it("table exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_provenance'`
    ).get();
    expect(row?.name).toBe("memory_provenance");
  });

  it("idx_provenance_memory index exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_provenance_memory'`
    ).get();
    expect(row?.name).toBe("idx_provenance_memory");
  });

  it("idx_provenance_source_type index exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_provenance_source_type'`
    ).get();
    expect(row?.name).toBe("idx_provenance_source_type");
  });

  it("backfills exactly 3 legacy provenance rows (one per pre-existing memory)", () => {
    const count = db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM memory_provenance WHERE source_type='legacy'`
    ).get()!.n;
    expect(count).toBe(3);
  });

  it("every pre-existing memory has exactly one provenance row", () => {
    const rows = db.query<{ memory_id: number; cnt: number }, []>(
      `SELECT memory_id, COUNT(*) as cnt FROM memory_provenance GROUP BY memory_id`
    ).all();
    expect(rows.length).toBe(3);
    expect(rows.every(r => r.cnt === 1)).toBe(true);
  });

  it("backfill actor is migration-008", () => {
    const rows = db.query<{ actor: string }, []>(
      `SELECT actor FROM memory_provenance WHERE source_type='legacy'`
    ).all();
    expect(rows.every(r => r.actor === "migration-008")).toBe(true);
  });
});

describe("migration 009 — memory_audit", () => {
  it("table exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_audit'`
    ).get();
    expect(row?.name).toBe("memory_audit");
  });

  it("idx_audit_memory index exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_memory'`
    ).get();
    expect(row?.name).toBe("idx_audit_memory");
  });

  it("idx_audit_op index exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_op'`
    ).get();
    expect(row?.name).toBe("idx_audit_op");
  });

  it("idx_audit_session index exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_session'`
    ).get();
    expect(row?.name).toBe("idx_audit_session");
  });

  it("audit table starts empty (no backfill)", () => {
    const count = db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM memory_audit`
    ).get()!.n;
    expect(count).toBe(0);
  });
});
