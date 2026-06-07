import { describe, it, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureCustomSqlite, loadExtensions, getCapabilities } from "../../extensions.js";
import {
  ensureVecTable,
  upsertVec,
  deleteVec,
  knnVec,
  rebuildVecIndex,
  getActiveEmbedDim,
  isVecAvailable,
  DEFAULT_EMBED_DIM,
} from "../../vec/index.js";

const DIM = 4;
const blob = (a: number[]) => new Uint8Array(new Float32Array(a).buffer);

function seedEmbeddingsTable(db: Database): void {
  db.exec(`CREATE TABLE memory_embeddings (
    memory_id INTEGER PRIMARY KEY, embedding BLOB NOT NULL,
    model TEXT NOT NULL DEFAULT 'unknown', dim INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`);
}

describe("vec module", () => {
  let db: Database;
  let vecOn: boolean;

  beforeAll(() => {
    ensureCustomSqlite();
    db = new Database(":memory:");
    loadExtensions(db);
    vecOn = getCapabilities().vec;
    seedEmbeddingsTable(db);
  });

  it("getActiveEmbedDim defaults to 768 with no settings row", () => {
    expect(getActiveEmbedDim(db)).toBe(DEFAULT_EMBED_DIM);
  });

  it("getActiveEmbedDim reads the ltm.embed.dim setting", () => {
    db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('ltm.embed.dim','512')");
    expect(getActiveEmbedDim(db)).toBe(512);
    db.run("DELETE FROM settings WHERE key='ltm.embed.dim'");
  });

  it("isVecAvailable mirrors getCapabilities().vec", () => {
    expect(isVecAvailable()).toBe(vecOn);
  });

  it("all ops are graceful no-ops when vec is unavailable", () => {
    if (vecOn) return; // covered by the active-path tests below
    expect(ensureVecTable(db, DIM)).toBe(false);
    expect(upsertVec(db, 1, blob([1, 0, 0, 0]))).toBe(false);
    expect(deleteVec(db, 1)).toBe(false);
    expect(knnVec(db, blob([1, 0, 0, 0]), 3)).toEqual([]);
    expect(rebuildVecIndex(db, { dim: DIM })).toBe(-1);
  });

  it("ensure + upsert + KNN returns nearest by cosine similarity", () => {
    if (!vecOn) return;
    expect(ensureVecTable(db, DIM)).toBe(true);
    expect(upsertVec(db, 10, blob([1, 0, 0, 0]))).toBe(true);
    expect(upsertVec(db, 20, blob([0, 1, 0, 0]))).toBe(true);
    expect(upsertVec(db, 30, blob([1, 1, 0, 0]))).toBe(true);

    const hits = knnVec(db, blob([1, 0, 0, 0]), 3);
    expect(hits[0]?.id).toBe(10);
    expect(hits[0]?.similarity).toBeCloseTo(1, 5);
    // orthogonal vector ranks last
    expect(hits[hits.length - 1]?.id).toBe(20);
  });

  it("upsert overwrites an existing vector (update path)", () => {
    if (!vecOn) return;
    upsertVec(db, 20, blob([1, 0, 0, 0])); // was orthogonal, now identical
    const hits = knnVec(db, blob([1, 0, 0, 0]), 1);
    expect(hits[0]?.similarity).toBeCloseTo(1, 5);
  });

  it("deleteVec removes a row from the index", () => {
    if (!vecOn) return;
    expect(deleteVec(db, 30)).toBe(true);
    const hits = knnVec(db, blob([1, 1, 0, 0]), 5);
    expect(hits.some((h) => h.id === 30)).toBe(false);
  });

  it("rebuildVecIndex repopulates from memory_embeddings for the active dim", () => {
    if (!vecOn) return;
    db.exec("DELETE FROM memory_embeddings");
    for (let i = 1; i <= 5; i++) {
      db.run("INSERT INTO memory_embeddings(memory_id, embedding, model, dim) VALUES (?,?,?,?)", [
        i,
        blob([i, 0, 0, 0]),
        "nomic-embed-text",
        DIM,
      ]);
    }
    // a stray row at a different dim must be excluded
    db.run("INSERT INTO memory_embeddings(memory_id, embedding, model, dim) VALUES (?,?,?,?)", [
      99,
      new Uint8Array(new Float32Array([1, 2]).buffer),
      "nomic-embed-text",
      2,
    ]);
    const n = rebuildVecIndex(db, { dim: DIM, model: "nomic-embed-text" });
    expect(n).toBe(5);
    const hits = knnVec(db, blob([5, 0, 0, 0]), 1);
    expect(hits[0]?.id).toBe(5);
  });

  it("scales to 1k vectors and returns the exact nearest", () => {
    if (!vecOn) return;
    rebuildVecIndex(db, { dim: DIM }); // clear
    ensureVecTable(db, DIM);
    db.transaction(() => {
      for (let i = 1; i <= 1000; i++) {
        upsertVec(db, i, blob([Math.random(), Math.random(), Math.random(), Math.random()]));
      }
    })();
    const target = blob([0.123, 0.456, 0.789, 0.321]);
    upsertVec(db, 7777, target);
    const t0 = performance.now();
    const hits = knnVec(db, target, 5);
    const ms = performance.now() - t0;
    expect(hits[0]?.id).toBe(7777);
    expect(ms).toBeLessThan(500); // generous bound — ANN over 1k must be fast
  });
});
