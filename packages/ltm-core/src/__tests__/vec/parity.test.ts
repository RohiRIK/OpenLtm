/**
 * parity.test.ts — proves the sqlite-vec vec0 KNN ranking agrees with the
 * brute-force JS-cosine ranking that getSimilarMemories falls back to. These
 * are the two code paths the read path switches between, so their top-K order
 * over identical data must match.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureCustomSqlite, loadExtensions, getCapabilities } from "../../extensions.js";
import { ensureVecTable, upsertVec, knnVec } from "../../vec/index.js";

const DIM = 8;
const blob = (a: number[]) => new Uint8Array(new Float32Array(a).buffer);

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

describe("vec/brute-force recall parity", () => {
  let db: Database;
  let vecOn: boolean;
  const vectors = new Map<number, Float32Array>();

  beforeAll(() => {
    ensureCustomSqlite();
    db = new Database(":memory:");
    loadExtensions(db);
    vecOn = getCapabilities().vec;
    if (!vecOn) return;
    ensureVecTable(db, DIM);
    for (let id = 1; id <= 200; id++) {
      const v = Array.from({ length: DIM }, () => Math.random());
      vectors.set(id, new Float32Array(v));
      upsertVec(db, id, blob(v));
    }
  });

  it("top-5 KNN ids match the top-5 by JS cosine", () => {
    if (!vecOn) return;
    const query = Array.from({ length: DIM }, () => Math.random());
    const qVec = new Float32Array(query);

    const knnIds = knnVec(db, blob(query), 5).map((h) => h.id);

    const bruteIds = [...vectors.entries()]
      .map(([id, v]) => ({ id, sim: cosine(qVec, v) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5)
      .map((r) => r.id);

    expect(knnIds).toEqual(bruteIds);
  });

  it("KNN similarity equals JS cosine for each returned hit", () => {
    if (!vecOn) return;
    const query = Array.from({ length: DIM }, () => Math.random());
    const qVec = new Float32Array(query);
    const hits = knnVec(db, blob(query), 5);
    for (const h of hits) {
      expect(h.similarity).toBeCloseTo(cosine(qVec, vectors.get(h.id)!), 4);
    }
  });
});
