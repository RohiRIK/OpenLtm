/** Migration 031: collections + records on a database that predates it. */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../../migrations.js";

const SCHEMA_PATH = join(import.meta.dir, "..", "..", "schema.sql");

describe("migration 031", () => {
  it("adds collections, records and the records FTS index to a v30 database", async () => {
    const v30 = new Database(":memory:");
    v30.exec("PRAGMA foreign_keys=ON;");
    v30.exec(readFileSync(SCHEMA_PATH, "utf-8").split(/\n-- =+\n-- collections \+ records/)[0]!);
    ensureMigrationsTable(v30);
    for (const f of await getMigrationFiles()) {
      if (f.version > 30) continue;
      v30.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)", [f.version, f.name, computeChecksum(f.content)]);
    }
    expect(v30.query("SELECT 1 FROM sqlite_master WHERE name='collections'").get()).toBeNull();

    const results = await runPendingMigrations(v30);
    expect(results.map((r) => r.version)[0]).toBe(31);
    for (const name of ["collections", "records", "records_fts", "records_ai", "records_ad", "records_au", "idx_collections_name_scope"]) {
      expect(v30.query("SELECT 1 FROM sqlite_master WHERE name=?").get(name)).not.toBeNull();
    }
    // The FTS triggers follow search_text.
    v30.run("INSERT INTO collections (name, description, fields) VALUES ('hosts', 'h', '[]')");
    v30.run("INSERT INTO records (collection_id, data, schema_version, search_text) VALUES (1, '{}', 1, 'quokka host')");
    expect(v30.query("SELECT rowid FROM records_fts WHERE records_fts MATCH 'quokka'").all()).toHaveLength(1);
    v30.run("UPDATE records SET search_text='wombat host' WHERE id=1");
    expect(v30.query("SELECT rowid FROM records_fts WHERE records_fts MATCH 'quokka'").all()).toHaveLength(0);
    expect(v30.query("SELECT rowid FROM records_fts WHERE records_fts MATCH 'wombat'").all()).toHaveLength(1);
  });

  it("is a no-op on a fresh database whose schema.sql already has the tables", async () => {
    const fresh = new Database(":memory:");
    fresh.exec(readFileSync(SCHEMA_PATH, "utf-8"));
    await runPendingMigrations(fresh);
    expect(fresh.query<{ n: number }, []>("SELECT COUNT(*) n FROM _schema_version WHERE version=31").get()!.n).toBe(1);
  });
});
