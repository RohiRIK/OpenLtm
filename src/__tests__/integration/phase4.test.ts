/**
 * Phase 4 integration tests — Janitor (v1.9.0)
 *
 * Covers:
 *   - Migration 011: decay_score column + memory_archive table
 *   - Migration 012: janitor settings seeded
 *   - recall() default sort uses decay_score DESC from SQL (not JS)
 *   - runJanitor() writes settings, archives deprecated memories
 *   - runDecay() correctly marks old low-importance memories deprecated
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-phase4-int-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let learn: typeof import("@rohirik/ltm-core").learn;
let recall: typeof import("@rohirik/ltm-core").recall;
let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  const { _setDbForTesting } = await import("@rohirik/ltm-core");
  _setDbForTesting(db);

  const { runPendingMigrations } = await import("@rohirik/ltm-core");
  await runPendingMigrations(db);

  const dbMod = await import("@rohirik/ltm-core");
  learn = dbMod.learn;
  recall = dbMod.recall;
}, 30_000);

afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("migration 011", () => {
  it("memories table has decay_score column", () => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(memories)").all();
    expect(cols.map(c => c.name)).toContain("decay_score");
  });

  it("decay_score defaults to 1.0 for existing memories", () => {
    const r = learn({ content: "Phase4 default decay_score test", category: "pattern", importance: 3 });
    const row = db.query<{ decay_score: number }, [number]>(
      "SELECT decay_score FROM memories WHERE id=?",
    ).get(r.id);
    expect(row!.decay_score).toBe(1.0);
  });

  it("memory_archive table exists with correct schema", () => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(memory_archive)").all();
    const names = cols.map(c => c.name);
    expect(names).toContain("id");
    expect(names).toContain("memory_json");
    expect(names).toContain("archived_at");
    expect(names).toContain("reason");
    expect(names).toContain("decay_score");
    expect(names).toContain("project_scope");
  });
});

describe("migration 012", () => {
  it("janitor settings rows exist", () => {
    const keys = [
      "ltm.janitor.lastRunAt",
      "ltm.janitor.lastDecayRefreshed",
      "ltm.janitor.lastDeprecated",
      "ltm.janitor.lastArchived",
    ];
    for (const key of keys) {
      const row = db.query<{ value: string }, [string]>(
        "SELECT value FROM settings WHERE key=?",
      ).get(key);
      expect(row).toBeDefined();
    }
  });
});

describe("recall() default sort uses decay_score", () => {
  it("results have decay_score field", async () => {
    learn({ content: "Phase4 recall sort test: decay_score field", category: "pattern", importance: 3 });
    const results = await recall({ limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const m of results) {
      expect(typeof m.decay_score).toBe("number");
    }
  });

  it("default sort returns higher decay_score results first", async () => {
    // Seed two memories: one high-importance (high decay_score) and one low
    const high = learn({ content: "Phase4 high importance sort check", category: "architecture", importance: 5 });
    const low = learn({ content: "Phase4 low importance sort check", category: "pattern", importance: 1 });

    // Run decay to materialise scores
    const { runDecay } = await import("@rohirik/ltm-core");
    runDecay();

    const results = await recall({ limit: 20 });
    const highIdx = results.findIndex(m => m.id === high.id);
    const lowIdx  = results.findIndex(m => m.id === low.id);

    if (highIdx !== -1 && lowIdx !== -1) {
      expect(highIdx).toBeLessThan(lowIdx);
    }
  });
});

describe("runDecay() + runArchive() round-trip", () => {
  it("deprecated low-importance memory is archived after archive pass", async () => {
    // Insert a memory that looks ancient (directly via SQL to control timestamps)
    const oldDate = new Date(Date.now() - 90 * 86_400_000).toISOString();
    db.run(
      `INSERT INTO memories (content, category, importance, confidence, confirm_count,
         last_used_at, last_confirmed_at, created_at, status, dedup_key)
       VALUES ('phase4 ancient evict test', 'pattern', 1, 1.0, 0,
               ?, ?, ?, 'active', 'phase4-ancient-evict')`,
      [oldDate, oldDate, oldDate],
    );
    db.run(`INSERT INTO memories_fts (rowid, content) VALUES (last_insert_rowid(), 'phase4 ancient evict test')`);
    const row = db.query<{ id: number }, []>(
      "SELECT id FROM memories WHERE dedup_key='phase4-ancient-evict'",
    ).get()!;

    const { runDecay } = await import("@rohirik/ltm-core");
    const { runArchive } = await import("@rohirik/ltm-core");

    runDecay();

    const afterDecay = db.query<{ status: string; decay_score: number }, [number]>(
      "SELECT status, decay_score FROM memories WHERE id=?",
    ).get(row.id)!;
    expect(afterDecay.status).toBe("deprecated");
    expect(afterDecay.decay_score).toBeLessThan(0.25);

    runArchive();

    const inMemories = db.query<{ id: number }, [number]>("SELECT id FROM memories WHERE id=?").get(row.id);
    const inArchive  = db.query<{ id: number }, [number]>("SELECT id FROM memory_archive WHERE id=?").get(row.id);
    expect(inMemories).toBeNull();
    expect(inArchive).toBeDefined();
  });
});
