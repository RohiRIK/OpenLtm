/** Managed field indexes (collections/indexes.ts). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-collections-idx-${process.pid}-${Date.now()}.db`;
let core: typeof import("../index.js");
let db: Database;

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

beforeEach(() => {
  db.exec("DELETE FROM records; DELETE FROM collections; DELETE FROM settings WHERE key LIKE 'collections.%';");
  const stmt = db.prepare<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_rec_%'");
  const names = stmt.all().map((r) => r.name);
  stmt.finalize();
  for (const name of names) db.run(`DROP INDEX ${name}`);
});

afterAll(() => {
  db.close();
  try { unlinkSync(dbPath); } catch { /* gone */ }
});

const FIELDS = [
  { name: "host", type: "string", required: true },
  { name: "port", type: "integer" },
  { name: "role", type: "enum", values: ["db", "web"] },
  { name: "os", type: "string" },
  { name: "rack", type: "string" },
  { name: "tags", type: "string[]" },
];

function setup(records: number, minRecords: number) {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('collections.index_min_records', ?)", [String(minRecords)]);
  const c = core.defineCollection({ name: "hosts", description: "Machines", key_field: "host", fields: FIELDS });
  for (let i = 0; i < records; i++) core.putRecord({ collection: "hosts", data: { host: `h${i}`, port: 8000 + i, role: i % 2 ? "db" : "web", os: "linux", rack: `r${i % 3}` } });
  return c;
}

describe("managed indexes", () => {
  it("indexes a filtered field once the collection is large enough, and the planner uses it", () => {
    const c = setup(5, 3);
    const res = core.queryRecords({ collection: "hosts", where: [{ field: "port", op: "gt", value: 8002 }] });
    expect(res.records.map((r) => r.key).sort()).toEqual(["h3", "h4"]);
    expect(core.managedIndexes(db, c.id)).toEqual(["port"]);
    // prepare + finalize: a cached EXPLAIN statement stays active and locks the schema for later DDL.
    const stmt = db.prepare<{ detail: string }, []>(
      `EXPLAIN QUERY PLAN SELECT r.* FROM records r WHERE r.collection_id = ${c.id} AND r.status='active' AND json_extract(r.data, '$.port') > 8002`,
    );
    const plan = stmt.all().map((p) => p.detail).join(" | ");
    stmt.finalize();
    expect(plan).toContain(`idx_rec_${c.id}_port`);
  });

  it("does nothing below the threshold, skips list fields, and caps at three", () => {
    const c = setup(2, 3);
    core.queryRecords({ collection: "hosts", where: [{ field: "port", op: "eq", value: 8000 }] });
    expect(core.managedIndexes(db, c.id)).toEqual([]);
    for (let i = 2; i < 5; i++) core.putRecord({ collection: "hosts", data: { host: `h${i}` } });
    core.queryRecords({ collection: "hosts", where: [{ field: "tags", op: "contains", value: "x" }] });
    expect(core.managedIndexes(db, c.id)).toEqual([]);
    for (const field of ["port", "role", "os", "rack"]) core.queryRecords({ collection: "hosts", where: [{ field, op: "exists" }], order_by: field });
    expect(core.managedIndexes(db, c.id).sort()).toEqual(["os", "port", "role"]);
    // Indexed and unindexed fields give the same answers.
    const a = core.queryRecords({ collection: "hosts", where: [{ field: "role", op: "eq", value: "db" }, { field: "rack", op: "eq", value: "r1" }], order_by: "port", order: "asc" });
    expect(a.records.map((r) => r.key)).toEqual(["h1"]);
  });

  it("a breaking evolve that retypes a field drops its index", () => {
    const c = setup(4, 1);
    core.queryRecords({ collection: "hosts", where: [{ field: "os", op: "eq", value: "linux" }] });
    expect(core.managedIndexes(db, c.id)).toEqual(["os"]);
    core.evolveCollection({ name: "hosts", fields: FIELDS.map((f) => (f.name === "os" ? { ...f, type: "text" } : f)), allowBreaking: true });
    expect(core.managedIndexes(db, c.id)).toEqual([]);
  });
});
