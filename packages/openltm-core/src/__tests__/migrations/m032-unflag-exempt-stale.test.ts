/**
 * Migration 032: stale flags on preferences and owner statements are cleared
 * (a code change never invalidates them), so decay does not deprecate them.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../../migrations.js";

const CORE_SCHEMA = join(import.meta.dir, "..", "..", "schema.sql");

/** A database with versions 1..31 recorded (032 pending). */
async function v31Db(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(CORE_SCHEMA, "utf-8"));
  ensureMigrationsTable(db);
  for (const f of await getMigrationFiles()) {
    if (f.version > 31) continue;
    db.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)",
      [f.version, f.name, computeChecksum(f.content)]);
  }
  return db;
}

function flagged(db: Database, content: string, category: string, origin: string): number {
  return Number(db.run(
    `INSERT INTO memories (content, category, origin, dedup_key, stale_flagged_at, stale_reason)
     VALUES (?, ?, ?, ?, datetime('now', '-31 days'), 'old commit')`,
    [content, category, origin, `k-${content}`],
  ).lastInsertRowid);
}

describe("migration 032 — unflag exempt stale memories", () => {
  it("clears flags on preferences and owner statements only; re-run is a no-op", async () => {
    const db = await v31Db();
    const pref = flagged(db, "prefers tabs", "preference", "agent-observation");
    const said = flagged(db, "keep the panel minimal", "pattern", "owner-statement");
    const code = flagged(db, "uses the old api", "pattern", "agent-observation");

    const res = await runPendingMigrations(db);
    expect(res.map((r) => r.version)).toContain(32);

    const staleAt = (id: number) =>
      db.query<{ s: string | null }, [number]>("SELECT stale_flagged_at s FROM memories WHERE id = ?").get(id)!.s;
    expect(staleAt(pref)).toBeNull();
    expect(staleAt(said)).toBeNull();
    expect(staleAt(code)).not.toBeNull();
    expect(await runPendingMigrations(db)).toEqual([]);
  });
});
