/**
 * Migration 031: every stored project scope is lowercased, so "SummonOS" and
 * "summonos" become one scope — including when both casings already hold rows.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../../migrations.js";

const CORE_SCHEMA = join(import.meta.dir, "..", "..", "schema.sql");

/** A database with versions 1..30 recorded (031 pending). */
async function v30Db(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(CORE_SCHEMA, "utf-8"));
  ensureMigrationsTable(db);
  for (const f of await getMigrationFiles()) {
    if (f.version > 30) continue;
    db.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)",
      [f.version, f.name, computeChecksum(f.content)]);
  }
  return db;
}

function mem(db: Database, content: string, scope: string | null): number {
  return Number(db.run(
    "INSERT INTO memories (content, category, project_scope, dedup_key) VALUES (?, 'pattern', ?, ?)",
    [content, scope, `k-${content}`],
  ).lastInsertRowid);
}

describe("migration 031 — lowercase project scopes", () => {
  it("merges two casings of one scope without losing rows; globals untouched; re-run is a no-op", async () => {
    const db = await v30Db();
    const a = mem(db, "upper", "SummonOS");
    const b = mem(db, "lower", "summonos");
    const g = mem(db, "global", null);
    // Same anchor path under both casings: memory_files is keyed (memory_id, path), so no collision.
    db.run("INSERT INTO memory_files (memory_id, path, project_scope) VALUES (?, 'src/a.ts', 'SummonOS'), (?, 'src/a.ts', 'summonos')", [a, b]);
    db.run("INSERT INTO context_items (project_name, type, content, permanent) VALUES ('SummonOS', 'decision', 'same', 1), ('summonos', 'decision', 'same', 1)");

    const res = await runPendingMigrations(db);
    expect(res.map((r) => r.version)).toContain(31);

    const scopes = db.query<{ id: number; project_scope: string | null }, []>("SELECT id, project_scope FROM memories ORDER BY id").all();
    expect(scopes).toEqual([{ id: a, project_scope: "summonos" }, { id: b, project_scope: "summonos" }, { id: g, project_scope: null }]);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM memory_files WHERE project_scope = 'summonos'").get()!.n).toBe(2);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM context_items WHERE project_name = 'summonos'").get()!.n).toBe(2);
    expect(await runPendingMigrations(db)).toEqual([]);
  });
});
