/**
 * Migration test for 010_memory_embeddings_split.
 * Verifies: table created, index present, blobs migrated, embedding column dropped.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-migration010-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  // Seed 3 memories — 2 with blobs, 1 without
  const blob = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
  db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key, embedding)
     VALUES ('Memory with embedding A', 'pattern', 3, 1.0, 'dedup-blob-1', ?)`,
    [blob],
  );
  db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key, embedding)
     VALUES ('Memory with embedding B', 'gotcha', 4, 1.0, 'dedup-blob-2', ?)`,
    [blob],
  );
  db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key)
     VALUES ('Memory without embedding', 'pattern', 2, 1.0, 'dedup-no-blob')`,
  );

  const { _setDbForTesting, waitForInit } = await import("../../shared-db.js");
  _setDbForTesting(db);
  await waitForInit();

  const { runPendingMigrations } = await import("../../migrations.js");
  await runPendingMigrations(db);
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("migration 010 — memory_embeddings split", () => {
  it("memory_embeddings table exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'`
    ).get();
    expect(row?.name).toBe("memory_embeddings");
  });

  it("idx_embeddings_memory index exists", () => {
    const row = db.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_embeddings_memory'`
    ).get();
    expect(row?.name).toBe("idx_embeddings_memory");
  });

  it("only non-null blobs are copied (2 of 3)", () => {
    const count = db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM memory_embeddings`
    ).get()!.n;
    expect(count).toBe(2);
  });

  it("blob bytes are preserved exactly", () => {
    const rows = db.query<{ memory_id: number; embedding: Buffer }, []>(
      `SELECT memory_id, embedding FROM memory_embeddings ORDER BY memory_id`
    ).all();
    const expected = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    for (const row of rows) {
      expect(Buffer.compare(row.embedding, expected)).toBe(0);
    }
  });

  it("embedding column no longer exists on memories table", () => {
    const cols = db.query<{ name: string }, []>(
      `SELECT name FROM pragma_table_info('memories')`
    ).all().map(r => r.name);
    expect(cols).not.toContain("embedding");
  });

  it("memories table still has all 3 rows", () => {
    const count = db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM memories`
    ).get()!.n;
    expect(count).toBe(3);
  });

  it("memory_embeddings FK cascades on delete", () => {
    const id = db.query<{ id: number }, []>(
      `SELECT id FROM memories WHERE dedup_key='dedup-blob-1'`
    ).get()!.id;
    db.run(`DELETE FROM memories WHERE id=?`, [id]);
    const count = db.query<{ n: number }, [number]>(
      `SELECT COUNT(*) as n FROM memory_embeddings WHERE memory_id=?`
    ).get(id)!.n;
    expect(count).toBe(0);
  });
});
