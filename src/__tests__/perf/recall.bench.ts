/**
 * Recall performance benchmark — verifies p95 < 50ms with 10k memories.
 * Seeds an in-memory DB, inserts 10k rows, then runs recall() 100 times.
 * Run with: bun test src/__tests__/perf/recall.bench.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "fs";

const dbPath = `/tmp/test-ltm-perf-${Date.now()}.db`;
process.env.LTM_DB_PATH = dbPath;

let recall: (input: { query?: string; limit?: number; project?: string }) => Promise<unknown[]>;

const CATEGORIES = ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"] as const;
const QUERIES = [
  "typescript error handling",
  "database migration",
  "hook logging",
  "recall performance",
  "bun sqlite",
  "session start",
  "context update",
  "memory decay",
  "DAO layer",
  "write queue",
];

beforeAll(async () => {
  const { getDb, waitForInit } = await import("@rohirik/openltm-core");
  // Ensure all migrations have applied before seeding or calling recall().
  await waitForInit();
  const db = getDb();

  // Seed 10k rows directly (bypass learn() to avoid LLM calls)
  const insert = db.prepare(
    `INSERT INTO memories (content, category, importance, confidence, status, source, dedup_key)
     VALUES (?, ?, ?, ?, 'active', 'bench', ?)`
  );
  const insertFts = db.prepare(
    `INSERT INTO memories_fts (rowid, content) VALUES (?, ?)`
  );

  const batchInsert = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      const cat = CATEGORIES[i % CATEGORIES.length]!;
      const content = `Memory ${i}: ${cat} pattern for ${QUERIES[i % QUERIES.length]} with detail level ${i}`;
      const key = `bench-key-${i}`;
      insert.run(content, cat, (i % 5) + 1, 0.5 + (i % 5) * 0.1, key);
      const lastId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      insertFts.run(lastId, content);
    }
  });

  batchInsert(10_000);

  const { recall: recallFn } = await import("@rohirik/openltm-core");
  recall = recallFn as typeof recall;
}, 60_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe("recall() performance with 10k memories", () => {
  it("p95 latency < 50ms over 100 calls", async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const query = QUERIES[i % QUERIES.length]!;
      const start = performance.now();
      await recall({ query, limit: 10 });
      latencies.push(performance.now() - start);
    }

    const p95ms = p95(latencies);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log(`  avg=${avg.toFixed(2)}ms  p95=${p95ms.toFixed(2)}ms  max=${Math.max(...latencies).toFixed(2)}ms`);

    expect(p95ms).toBeLessThan(50);
  }, 30_000);

  it("returns results (not empty) for common queries", async () => {
    const results = await recall({ query: "typescript error handling", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("excludes embedding blob from returned rows", async () => {
    const results = await recall({ query: "bun sqlite", limit: 1 }) as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).not.toHaveProperty("embedding");
  });
});
