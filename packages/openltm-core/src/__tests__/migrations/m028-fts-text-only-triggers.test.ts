/**
 * Migration 028 on a populated 2.18.1 database: the AFTER UPDATE FTS triggers
 * are rebuilt to fire only on title/content, and every row indexed under the
 * old triggers is still found by MATCH afterwards.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../../migrations.js";

const CORE_SCHEMA = join(import.meta.dir, "..", "..", "schema.sql");

/** A 2.18.1 (v27) database: pre-028 triggers, versions 1..27 recorded. */
async function v27Db(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const schema = readFileSync(CORE_SCHEMA, "utf-8")
    .replace("AFTER UPDATE OF title, content ON memories", "AFTER UPDATE ON memories")
    .replace("AFTER UPDATE OF title, content ON context_items", "AFTER UPDATE ON context_items");
  expect(schema).not.toContain("UPDATE OF title, content");
  db.exec(schema);
  ensureMigrationsTable(db);
  for (const f of await getMigrationFiles()) {
    if (f.version > 27) continue;
    db.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)",
      [f.version, f.name, computeChecksum(f.content)]);
  }
  return db;
}

const triggerSql = (db: Database, name: string) =>
  db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)!.sql;
const memHits = (db: Database, q: string) =>
  db.query<{ rowid: number }, [string]>("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rowid").all(q).map((r) => r.rowid);
const ctxHits = (db: Database, q: string) =>
  db.query<{ rowid: number }, [string]>("SELECT rowid FROM context_items_fts WHERE context_items_fts MATCH ? ORDER BY rowid").all(q).map((r) => r.rowid);
const ftsDataRows = (db: Database) => db.query<{ c: number }, []>("SELECT count(*) c FROM memories_fts_data").get()!.c;

describe("migration 028 upgrade of a populated 2.18.1 DB", () => {
  it("rebuilds the triggers and keeps every row searchable", async () => {
    const db = await v27Db();
    expect(triggerSql(db, "memories_au")).not.toContain("UPDATE OF");

    const ids: number[] = [];
    for (let i = 0; i < 40; i++) {
      ids.push(Number(db.run(
        `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
         VALUES (?, 'workflow', 3, 1, 'active', ?)`,
        [`Gannet pipeline step ${i} ${i % 2 ? "nightly" : "hourly"}`, `m028-${i}`],
      ).lastInsertRowid));
    }
    const titled = Number(db.run(
      `INSERT INTO memories (title, content, category, importance, confidence, status, dedup_key)
       VALUES ('Puffin title', 'Body text only', 'workflow', 3, 1, 'active', 'm028-titled')`,
    ).lastInsertRowid);
    // Pre-028 triggers re-index on every metadata update (fragments the index).
    db.run("UPDATE memories SET recall_count = recall_count + 1");
    db.run("UPDATE memories SET content = 'Gannet pipeline step 0 rewritten' WHERE id = ?", [ids[0]!]);
    const ctx = Number(db.run(
      "INSERT INTO context_items (project_name, type, content) VALUES ('p', 'goal', 'Skua migration goal')",
    ).lastInsertRowid);
    db.run("UPDATE context_items SET status = 'promoted' WHERE id = ?", [ctx]);

    const res = await runPendingMigrations(db);
    expect(res.map((r) => r.version)).toContain(28);
    for (const name of ["memories_au", "context_items_au"]) {
      expect(triggerSql(db, name)).toContain("AFTER UPDATE OF title, content ON");
    }

    expect(memHits(db, '"gannet"')).toEqual(ids);
    expect(memHits(db, '"nightly"')).toEqual(ids.filter((_, i) => i % 2 === 1));
    expect(memHits(db, '"rewritten"')).toEqual([ids[0]!]);
    expect(memHits(db, '"hourly"')).not.toContain(ids[0]!);
    expect(memHits(db, '"puffin"')).toEqual([titled]);
    expect(ctxHits(db, '"skua"')).toEqual([ctx]);

    // After 028: metadata updates leave the index alone, text updates re-index.
    const before = ftsDataRows(db);
    db.run("UPDATE memories SET recall_count = recall_count + 1, importance = 4");
    expect(ftsDataRows(db)).toBe(before);
    db.run("UPDATE memories SET content = 'Tern pipeline' WHERE id = ?", [ids[1]!]);
    expect(memHits(db, '"tern"')).toEqual([ids[1]!]);
    expect(memHits(db, '"gannet"')).not.toContain(ids[1]!);
    db.run("UPDATE context_items SET content = 'Shearwater goal' WHERE id = ?", [ctx]);
    expect(ctxHits(db, '"skua"')).toEqual([]);
    expect(ctxHits(db, '"shearwater"')).toEqual([ctx]);
    db.run("INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)"); // throws if index ≠ content

    // Re-run is a no-op.
    expect(await runPendingMigrations(db)).toEqual([]);
  });
});
