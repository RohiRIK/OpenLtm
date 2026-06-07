/**
 * Unit tests for janitor/decay.ts — SQL batch decay refresh (Phase 4).
 *
 * Verifies:
 *   - decay_score refreshed correctly per importance level
 *   - importance=5 never decays
 *   - confirm_count>=10 protected from decay
 *   - memories below threshold deprecated
 *   - importance>=5 never deprecated
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-decay-unit-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let db: Database;
let runDecay: typeof import("@rohirik/openltm-core").runDecay;

function daysAgoSql(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function seedMemory(overrides: {
  id: number;
  importance?: number;
  confidence?: number;
  confirm_count?: number;
  last_used_at?: string;
  status?: string;
}): void {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO memories (id, content, category, importance, confidence, confirm_count, last_used_at, last_confirmed_at, created_at, status, dedup_key)
     VALUES (?, ?, 'pattern', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      overrides.id,
      `test memory ${overrides.id}`,
      overrides.importance ?? 3,
      overrides.confidence ?? 1.0,
      overrides.confirm_count ?? 1,
      overrides.last_used_at ?? now,
      now,
      now,
      overrides.status ?? "active",
      `dedup-${overrides.id}`,
    ],
  );
  db.run(`INSERT INTO memories_fts (rowid, content) VALUES (?, ?)`, [overrides.id, `test memory ${overrides.id}`]);
}

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  const { _setDbForTesting } = await import("@rohirik/openltm-core");
  _setDbForTesting(db);

  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  await runPendingMigrations(db);

  const mod = await import("@rohirik/openltm-core");
  runDecay = mod.runDecay;
}, 30_000);

afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("runDecay() SQL batch", () => {
  it("refreshes decay_score for active memories", () => {
    seedMemory({ id: 1001, importance: 3, confidence: 1.0 });
    const { refreshed } = runDecay();
    expect(refreshed).toBeGreaterThan(0);
    const row = db.query<{ decay_score: number }, [number]>(
      "SELECT decay_score FROM memories WHERE id=?",
    ).get(1001);
    expect(row).toBeDefined();
    expect(row!.decay_score).toBeGreaterThan(0);
  });

  it("importance=5 always has decay_score = importance × confidence (no time decay)", () => {
    seedMemory({ id: 1002, importance: 5, confidence: 0.8, last_used_at: daysAgoSql(500) });
    runDecay();
    const row = db.query<{ decay_score: number }, [number]>(
      "SELECT decay_score FROM memories WHERE id=?",
    ).get(1002);
    expect(row!.decay_score).toBeCloseTo(5 * 0.8, 4);
  });

  it("confirm_count>=10 protected: decay_score = importance × confidence", () => {
    seedMemory({ id: 1003, importance: 2, confidence: 1.0, confirm_count: 10, last_used_at: daysAgoSql(300) });
    runDecay();
    const row = db.query<{ decay_score: number }, [number]>(
      "SELECT decay_score FROM memories WHERE id=?",
    ).get(1003);
    expect(row!.decay_score).toBeCloseTo(2 * 1.0, 4);
  });

  it("importance=1 memory 60 days old has decay_score well below 0.25", () => {
    const old = daysAgoSql(60);
    db.run(
      `INSERT INTO memories (id, content, category, importance, confidence, confirm_count, last_used_at, last_confirmed_at, created_at, status, dedup_key)
       VALUES (1004, 'old memory', 'pattern', 1, 1.0, 1, ?, ?, ?, 'active', 'dedup-1004')`,
      [old, old, old],
    );
    db.run(`INSERT INTO memories_fts (rowid, content) VALUES (1004, 'old memory')`);
    runDecay();
    const row = db.query<{ decay_score: number; status: string }, [number]>(
      "SELECT decay_score, status FROM memories WHERE id=?",
    ).get(1004);
    // imp=1 half-life=14d → score at 60d ≈ 1×1×0.5^(60/14) ≈ 0.051
    expect(row!.decay_score).toBeLessThan(0.25);
    expect(row!.status).toBe("deprecated");
  });

  it("importance=5 memory is never deprecated regardless of age", () => {
    const old = daysAgoSql(1000);
    db.run(
      `INSERT INTO memories (id, content, category, importance, confidence, confirm_count, last_used_at, last_confirmed_at, created_at, status, dedup_key)
       VALUES (1005, 'immortal', 'pattern', 5, 1.0, 1, ?, ?, ?, 'active', 'dedup-1005')`,
      [old, old, old],
    );
    db.run(`INSERT INTO memories_fts (rowid, content) VALUES (1005, 'immortal')`);
    runDecay();
    const row = db.query<{ status: string }, [number]>(
      "SELECT status FROM memories WHERE id=?",
    ).get(1005);
    expect(row!.status).toBe("active");
  });

  it("deprecated and refreshed fields are non-negative", () => {
    const result = runDecay();
    expect(result.deprecated).toBeGreaterThanOrEqual(0);
    expect(result.refreshed).toBeGreaterThanOrEqual(0);
  });
});

describe("touchMemory()", () => {
  it("updates last_used_at to a more recent value", async () => {
    const { touchMemory } = await import("@rohirik/openltm-core");
    // Insert with an explicit old SQLite-format timestamp so comparison is unambiguous
    const oldTs = "2020-01-01 00:00:00";
    db.run(
      `INSERT INTO memories (id, content, category, importance, confidence, confirm_count,
         last_used_at, last_confirmed_at, created_at, status, dedup_key)
       VALUES (2001, 'touch test', 'pattern', 3, 1.0, 1, ?, ?, ?, 'active', 'touch-2001')`,
      [oldTs, oldTs, oldTs],
    );
    db.run(`INSERT INTO memories_fts (rowid, content) VALUES (2001, 'touch test')`);

    touchMemory(2001);

    const after = db.query<{ last_used_at: string }, [number]>(
      "SELECT last_used_at FROM memories WHERE id=?",
    ).get(2001)!.last_used_at;

    expect(after > oldTs).toBe(true);
  });
});
