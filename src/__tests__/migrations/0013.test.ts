/**
 * Migration test for 013_add_created_by.
 * Verifies: column added, backfill logic from memory_provenance, NULL when no provenance.
 *
 * Note: memory_provenance is created by migration 008 (not in schema.sql), so test data
 * is seeded after runPendingMigrations, then the backfill UPDATE is run manually.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-migration013-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  const { _setDbForTesting } = await import("../../shared-db.js");
  _setDbForTesting(db);

  // Run all migrations (008 creates memory_provenance, 013 adds created_by)
  const { runPendingMigrations } = await import("../../migrations.js");
  await runPendingMigrations(db);

  // Seed memories AFTER migrations (memory_provenance now exists)
  db.run(
    `INSERT INTO memories (id, content, category, importance, confidence, dedup_key)
     VALUES (1, 'memory with provenance', 'pattern', 3, 1.0, 'dedup-013-a')`,
  );
  db.run(`INSERT INTO memories_fts (rowid, content) VALUES (1, 'memory with provenance')`);
  db.run(
    `INSERT INTO memory_provenance (memory_id, source_type, actor) VALUES (1, 'learn', 'mcp:ltm_learn')`,
  );

  db.run(
    `INSERT INTO memories (id, content, category, importance, confidence, dedup_key)
     VALUES (2, 'memory no provenance', 'pattern', 3, 1.0, 'dedup-013-b')`,
  );
  db.run(`INSERT INTO memories_fts (rowid, content) VALUES (2, 'memory no provenance')`);

  // Run backfill manually — mirrors what migration 013 does on pre-existing data
  db.exec(`
    UPDATE memories
    SET created_by = (
      SELECT actor
      FROM memory_provenance
      WHERE memory_provenance.memory_id = memories.id
      ORDER BY created_at ASC
      LIMIT 1
    )
    WHERE created_by IS NULL
  `);
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("migration 013 — created_by column", () => {
  it("created_by column exists on memories table", () => {
    const cols = db
      .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('memories')`)
      .all()
      .map((r) => r.name);
    expect(cols).toContain("created_by");
  });

  it("backfill sets created_by from earliest memory_provenance actor", () => {
    const row = db
      .query<{ created_by: string | null }, [number]>(
        `SELECT created_by FROM memories WHERE id=?`,
      )
      .get(1);
    expect(row?.created_by).toBe("mcp:ltm_learn");
  });

  it("leaves created_by NULL when no provenance row exists", () => {
    const row = db
      .query<{ created_by: string | null }, [number]>(
        `SELECT created_by FROM memories WHERE id=?`,
      )
      .get(2);
    expect(row?.created_by).toBeNull();
  });
});
