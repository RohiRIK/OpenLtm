/**
 * Tests for dao/embeddings.ts — getEmbedding, setEmbedding, deleteEmbedding,
 * listMemoryIdsMissingEmbedding.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-dao-embeddings-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");
const mig010Path = join(import.meta.dir, "..", "..", "..", "migrations", "010_memory_embeddings_split.sql");

let db: Database;
let mem1Id: number;
let mem2Id: number;
let mem3Id: number;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  // Insert memories (schema still has embedding col at this point)
  const r1 = db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key)
     VALUES ('Alpha memory', 'pattern', 3, 1.0, 'emb-1')`,
  );
  mem1Id = Number(r1.lastInsertRowid);

  const r2 = db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key)
     VALUES ('Beta memory', 'gotcha', 4, 1.0, 'emb-2')`,
  );
  mem2Id = Number(r2.lastInsertRowid);

  const r3 = db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key)
     VALUES ('Gamma memory', 'architecture', 5, 1.0, 'emb-3')`,
  );
  mem3Id = Number(r3.lastInsertRowid);

  // Run migration 010 to create memory_embeddings + drop embedding column
  const { _setDbForTesting, waitForInit } = await import("@rohirik/openltm-core");
  _setDbForTesting(db);
  await waitForInit();
  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  await runPendingMigrations(db);
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("getEmbedding", () => {
  it("returns null when no embedding stored", async () => {
    const { getEmbedding } = await import("@rohirik/openltm-core");
    expect(getEmbedding(db, mem1Id)).toBeNull();
  });

  it("returns the blob after setEmbedding", async () => {
    const { getEmbedding, setEmbedding } = await import("@rohirik/openltm-core");
    const blob = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    await setEmbedding(db, mem1Id, blob, "test-model", 3);
    const result = getEmbedding(db, mem1Id);
    expect(result).not.toBeNull();
    expect(Buffer.compare(result!, blob)).toBe(0);
  });
});

describe("setEmbedding", () => {
  it("upserts — second call updates the blob", async () => {
    const { getEmbedding, setEmbedding } = await import("@rohirik/openltm-core");
    const blob1 = Buffer.from(new Float32Array([1, 0, 0]).buffer);
    const blob2 = Buffer.from(new Float32Array([0, 1, 0]).buffer);
    await setEmbedding(db, mem2Id, blob1, "m1", 3);
    await setEmbedding(db, mem2Id, blob2, "m2", 3);
    const result = getEmbedding(db, mem2Id);
    expect(Buffer.compare(result!, blob2)).toBe(0);
  });

  it("stores model and dim correctly", async () => {
    const { setEmbedding } = await import("@rohirik/openltm-core");
    const blob = Buffer.from(new Float32Array([0.5]).buffer);
    await setEmbedding(db, mem3Id, blob, "gemini-embedding-004", 768);
    const row = db.query<{ model: string; dim: number }, [number]>(
      `SELECT model, dim FROM memory_embeddings WHERE memory_id=?`
    ).get(mem3Id)!;
    expect(row.model).toBe("gemini-embedding-004");
    expect(row.dim).toBe(768);
  });
});

describe("deleteEmbedding", () => {
  it("removes the embedding row", async () => {
    const { getEmbedding, setEmbedding, deleteEmbedding } = await import("@rohirik/openltm-core");
    const blob = Buffer.from(new Float32Array([9, 9, 9]).buffer);
    await setEmbedding(db, mem1Id, blob, "test", 3);
    await deleteEmbedding(db, mem1Id);
    expect(getEmbedding(db, mem1Id)).toBeNull();
  });

  it("is idempotent — deleting a non-existent row does not throw", async () => {
    const { deleteEmbedding } = await import("@rohirik/openltm-core");
    await expect(deleteEmbedding(db, 9999)).resolves.toBeUndefined();
  });
});

describe("listMemoryIdsMissingEmbedding", () => {
  it("returns only IDs without embeddings", async () => {
    const { listMemoryIdsMissingEmbedding, setEmbedding } = await import("@rohirik/openltm-core");
    // mem1 has no embedding (deleted above), mem2 has one, mem3 has one
    const blob = Buffer.from(new Float32Array([0.1]).buffer);
    await setEmbedding(db, mem2Id, blob, "m", 1);
    await setEmbedding(db, mem3Id, blob, "m", 1);

    const missing = listMemoryIdsMissingEmbedding(db);
    expect(missing).toContain(mem1Id);
    expect(missing).not.toContain(mem2Id);
    expect(missing).not.toContain(mem3Id);
  });

  it("respects the limit parameter", async () => {
    const { listMemoryIdsMissingEmbedding } = await import("@rohirik/openltm-core");
    const missing = listMemoryIdsMissingEmbedding(db, 1);
    expect(missing.length).toBeLessThanOrEqual(1);
  });
});
