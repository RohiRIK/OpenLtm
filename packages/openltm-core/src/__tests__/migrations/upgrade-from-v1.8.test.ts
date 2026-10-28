/**
 * Upgrading a database created by an old release. fixtures/schema-v1.8.0.sql is
 * `git show v1.8.0:src/schema.sql` — the earliest tagged schema, frozen so later
 * schema edits cannot hide an upgrade break. After the migrations run, every
 * table, column, index and trigger must match a fresh database.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { runPendingMigrations } from "../../migrations.js";

const OLD_SCHEMA = readFileSync(join(import.meta.dir, "fixtures", "schema-v1.8.0.sql"), "utf-8");
const CURRENT_SCHEMA = readFileSync(join(import.meta.dir, "..", "..", "schema.sql"), "utf-8");

/** name → column list (tables) or object type (index, trigger, view). */
function shape(db: Database): Record<string, string> {
  const objects = db.query<{ name: string; type: string }, []>(
    "SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
  return Object.fromEntries(objects.map(({ name, type }) => [
    name,
    type !== "table" ? type : db.query<{ name: string; type: string; notnull: number; pk: number }, []>(`PRAGMA table_info("${name}")`)
      .all().map((c) => `${c.name}:${c.type}:${c.notnull}:${c.pk}`).sort().join(","),
  ]));
}

function oldDb(): Database {
  const db = new Database(":memory:");
  db.exec(OLD_SCHEMA);
  db.run("INSERT INTO memories (content, category, importance) VALUES ('v1.8 row survives the upgrade', 'gotcha', 4)");
  return db;
}

describe("upgrade from the v1.8.0 schema", () => {
  it("runPendingMigrations brings it to the same schema as a fresh database, keeping rows", async () => {
    const fresh = new Database(":memory:");
    fresh.exec(CURRENT_SCHEMA);
    await runPendingMigrations(fresh);

    const db = oldDb();
    await runPendingMigrations(db);

    expect(shape(db)).toEqual(shape(fresh));
    const row = db.query<{ content: string; importance: number }, []>("SELECT content, importance FROM memories").get();
    expect(row).toEqual({ content: "v1.8 row survives the upgrade", importance: 4 });
    fresh.close();
    db.close();
  });

  // Known bug: initDb()/getDb() exec the current schema.sql BEFORE migrations,
  // and its CREATE INDEX on memories(stale_flagged_at) fails on a v1.8.0 table
  // ("no such column: stale_flagged_at"). Flip to `it` once fixed.
  it.failing("initDb's order (current schema.sql, then migrations) opens a v1.8.0 database", async () => {
    const db = oldDb();
    db.exec(CURRENT_SCHEMA);
    await runPendingMigrations(db);
    db.close();
  });
});
