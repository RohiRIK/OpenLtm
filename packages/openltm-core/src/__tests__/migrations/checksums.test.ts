/**
 * Recorded-checksum gate: an exact match or a known earlier text of the same
 * migration (SUPERSEDED_CHECKSUMS) passes and is re-stamped; any other
 * mismatch fails closed until `acceptChecksumMismatches` re-records it.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import {
  SUPERSEDED_CHECKSUMS, acceptChecksumMismatches, computeChecksum, ensureMigrationsTable,
  findChecksumMismatches, getMigrationFiles, runPendingMigrations,
} from "../../migrations.js";

const CORE_SCHEMA = join(import.meta.dir, "..", "..", "schema.sql");

/** A fully migrated database with every version recorded at its current checksum. */
async function migratedDb(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec(readFileSync(CORE_SCHEMA, "utf-8"));
  ensureMigrationsTable(db);
  for (const f of await getMigrationFiles()) {
    db.run("INSERT INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)",
      [f.version, f.name, computeChecksum(f.content)]);
  }
  return db;
}

function recorded(db: Database, version: number): string {
  return db.query<{ checksum: string }, [number]>(
    "SELECT checksum FROM _schema_version WHERE version = ?").get(version)!.checksum;
}

describe("recorded migration checksums", () => {
  it("accepts and re-stamps a superseded checksum for every listed version", async () => {
    const db = await migratedDb();
    const files = new Map((await getMigrationFiles()).map((f) => [f.version, f]));
    for (const [version, olds] of SUPERSEDED_CHECKSUMS) {
      expect(olds).not.toContain(computeChecksum(files.get(version)!.content));
      db.run("UPDATE _schema_version SET checksum = ? WHERE version = ?", [olds[0]!, version]);
    }

    expect(await runPendingMigrations(db)).toEqual([]);
    for (const version of SUPERSEDED_CHECKSUMS.keys()) {
      expect(recorded(db, version)).toBe(computeChecksum(files.get(version)!.content));
    }
  });

  it("still fails closed on an unknown checksum and names the way out", async () => {
    const db = await migratedDb();
    db.run("UPDATE _schema_version SET checksum = 'deadbeef' WHERE version = 29");

    await expect(runPendingMigrations(db)).rejects.toThrow(/checksum mismatch for applied version 29.*--accept-checksums/);
    expect(recorded(db, 29)).toBe("deadbeef");
  });

  it("acceptChecksumMismatches re-records only the mismatched versions", async () => {
    const db = await migratedDb();
    db.run("UPDATE _schema_version SET checksum = 'deadbeef' WHERE version = 28");
    const before = db.query("SELECT version, checksum FROM _schema_version WHERE version != 28").all();

    const { accepted } = await acceptChecksumMismatches(db);

    expect(accepted.map((m) => m.version)).toEqual([28]);
    expect(findChecksumMismatches(db, await getMigrationFiles())).toEqual([]);
    expect(db.query("SELECT version, checksum FROM _schema_version WHERE version != 28").all()).toEqual(before);
    expect(await runPendingMigrations(db)).toEqual([]);
  });

  it("acceptChecksumMismatches is a no-op when nothing mismatches", async () => {
    const db = await migratedDb();
    expect(await acceptChecksumMismatches(db)).toEqual({ accepted: [], backupPath: null });
  });
});
