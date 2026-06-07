/**
 * Phase 3 integration tests — Embedding Provider Abstraction (v1.8.0)
 *
 * Covers:
 *   - recall() always attaches explainer to results
 *   - explainer has valid temperature + score fields
 *   - learn() + recall() round-trip: explainer present
 *   - memory_embeddings table is separate from memories table
 *   - categorise() produces valid categories
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-phase3-int-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let learn: typeof import("@rohirik/openltm-core").learn;
let recall: typeof import("@rohirik/openltm-core").recall;
let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  const { _setDbForTesting } = await import("@rohirik/openltm-core");
  _setDbForTesting(db);

  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  await runPendingMigrations(db);

  const dbMod = await import("@rohirik/openltm-core");
  learn = dbMod.learn;
  recall = dbMod.recall;
}, 30_000);

afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("memory_embeddings table (migration 010)", () => {
  it("memories table has no embedding column", () => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(memories)").all();
    const names = cols.map(c => c.name);
    expect(names).not.toContain("embedding");
  });

  it("memory_embeddings table exists with correct schema", () => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(memory_embeddings)").all();
    const names = cols.map(c => c.name);
    expect(names).toContain("memory_id");
    expect(names).toContain("embedding");
    expect(names).toContain("model");
    expect(names).toContain("dim");
  });

  it("FK cascade: deleting memory removes its embedding row", () => {
    db.run(`INSERT INTO memories (id, content, category, importance, confidence, status, dedup_key)
            VALUES (9901, 'temp memory', 'pattern', 3, 1.0, 'active', 'phase3-cascade-test')`);
    db.run(`INSERT INTO memories_fts (rowid, content) VALUES (9901, 'temp memory')`);
    const blob = Buffer.alloc(16);
    db.run(`INSERT INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (9901, ?, 'test-model', 4)`, [blob]);

    expect(db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM memory_embeddings WHERE memory_id=9901").get()!.c).toBe(1);
    db.run("DELETE FROM memories WHERE id=9901");
    expect(db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM memory_embeddings WHERE memory_id=9901").get()!.c).toBe(0);
  });
});

describe("recall() explainer", () => {
  let memId: number;

  beforeAll(() => {
    const r = learn({ content: "Phase 3 test: use bun for all builds not npm", category: "preference", importance: 3 });
    memId = r.id;
  });

  it("recall() without query attaches explainer", async () => {
    const results = await recall({ limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const m of results) {
      expect(m.explainer).toBeDefined();
      expect(["hot", "warm", "cool", "cold"]).toContain(m.explainer!.temperature);
      expect(typeof m.explainer!.totalScore).toBe("number");
      expect(m.explainer!.totalScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("recall() with query sets non-null ftsRank on matching results", async () => {
    const results = await recall({ query: "bun builds npm", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const match = results.find(m => m.id === memId);
    if (match) {
      expect(match.explainer).toBeDefined();
      expect(match.explainer!.ftsRank).not.toBeNull();
      expect(match.explainer!.ftsRank).toBeGreaterThan(0);
    }
  });

  it("recall() explainer.importanceBoost is importance/5", async () => {
    learn({ content: "Phase 3 high-importance pattern for architecture design", category: "architecture", importance: 5 });
    const results = await recall({ limit: 20 });
    const high = results.find(m => m.importance === 5 && m.explainer);
    if (high) {
      expect(high.explainer!.importanceBoost).toBeCloseTo(1.0, 2);
    }
  });

  it("recall() result rows have no embedding field", async () => {
    const results = await recall({ limit: 5 }) as unknown as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    for (const m of results) {
      expect(m).not.toHaveProperty("embedding");
    }
  });

  it("recall() temperature is 'cold' for a fresh memory with recall_count=0", async () => {
    const r = learn({ content: "Fresh memory never recalled: phase3 integration cold test", category: "gotcha", importance: 2 });
    const results = await recall({ limit: 20 });
    const fresh = results.find(m => m.id === r.id);
    if (fresh) {
      expect(fresh.explainer!.temperature).toBe("cold");
    }
  });
});

describe("categorise() integration", () => {
  it("classifies gotcha content without LLM (no API key in test env)", async () => {
    const { categorise } = await import("@rohirik/openltm-core");
    const r = await categorise("⚠ Warning: never mutate objects directly — always use spread", 0.4);
    expect(r.category).toBe("gotcha");
    expect(r.source).toBe("heuristic");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("categorise falls back gracefully with ambiguous content", async () => {
    const { categorise } = await import("@rohirik/openltm-core");
    const r = await categorise("something", 0.99);
    expect(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]).toContain(r.category);
    expect(r.source).toBe("heuristic");
  });
});
