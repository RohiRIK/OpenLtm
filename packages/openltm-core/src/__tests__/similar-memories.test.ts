import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, rmSync } from "fs";
import { join } from "path";

// SessionStart's semantic branch calls getSimilarMemories(db, vec, …). It used to
// select memories.embedding, which migration 010 dropped — so on every migrated DB
// it threw and SessionStart injected no memories whenever a provider was up.
const dbPath = `/tmp/test-openltm-similar-${process.pid}-${Date.now()}.db`;
let core: typeof import("../index.js");
let db: Database;

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
});

function vec(values: number[]): Float32Array {
  const v = new Float32Array(values);
  const n = Math.hypot(...values) || 1;
  return v.map((x) => x / n);
}

function withEmbedding(content: string, v: Float32Array, opts: { project?: string; importance?: number } = {}): number {
  const { id } = core.learn({ content, category: "pattern", importance: opts.importance ?? 4, project_scope: opts.project, skipExport: true });
  db.run("INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (?, ?, 'test', ?)",
    [id, Buffer.from(v.buffer), v.length]);
  return id;
}

describe("getSimilarMemories (db, vec) — reads memory_embeddings", () => {
  it("ranks by cosine similarity on a fully migrated DB", () => {
    const near = withEmbedding("Payments retry with idempotency keys", vec([1, 0, 0, 0]));
    const far = withEmbedding("Prefer tabs in Makefiles", vec([0, 0, 1, 0]));
    const hits = core.getSimilarMemories(db, vec([0.9, 0.1, 0, 0]), { minImportance: 4, limit: 5 });
    expect(hits.map((m) => m.id)).toEqual([near, far]);
  });

  it("filters by project scope and importance, and skips other dimensions", () => {
    const scoped = withEmbedding("Shop API caches prices for sixty seconds", vec([0, 1, 0, 0]), { project: "shop-api", importance: 3 });
    withEmbedding("Other project memory", vec([0, 1, 0, 0]), { project: "other", importance: 3 });
    const wrongDim = core.learn({ content: "Embedded with another model", category: "pattern", importance: 3, project_scope: "shop-api", skipExport: true }).id;
    db.run("INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (?, ?, 'other', 2)",
      [wrongDim, Buffer.from(new Float32Array([1, 0]).buffer)]);
    const hits = core.getSimilarMemories(db, vec([0, 1, 0, 0]), { projectScope: "shop-api", minImportance: 2, limit: 5 });
    expect(hits.map((m) => m.id)).toEqual([scoped]);
  });
});
