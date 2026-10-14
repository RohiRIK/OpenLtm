/**
 * Migration 027 (memory_conflict_staging rebuild to allow 'stale') and the
 * per-statement runner: a bad row must make the run throw, roll back, leave
 * the table and rows intact, and not record v27.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { computeChecksum, ensureMigrationsTable, getMigrationFiles, runPendingMigrations } from "../../migrations.js";

const CORE_SCHEMA = join(import.meta.dir, "..", "..", "schema.sql");

/** A v26 database: pre-027 schema (no 'stale') with versions 1..26 recorded. */
async function v26Db(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const schema = readFileSync(CORE_SCHEMA, "utf-8").replace(
    "CHECK(status IN ('pending', 'accepted', 'rejected', 'coexist', 'stale'))",
    "CHECK(status IN ('pending', 'accepted', 'rejected', 'coexist'))",
  );
  expect(schema).not.toContain("'coexist', 'stale'");
  db.exec(schema);
  ensureMigrationsTable(db);
  for (const f of await getMigrationFiles()) {
    if (f.version > 26) continue;
    db.run("INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)",
      [f.version, f.name, computeChecksum(f.content)]);
  }
  return db;
}

function mem(db: Database, label: string): number {
  return Number(db.run(
    `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
     VALUES (?, 'architecture', 3, 1, 'active', ?)`, [label, `m027-${label}`],
  ).lastInsertRowid);
}

type Row = { id: number; older_id: number; newer_id: number; term: string | null; status: string; created_at: string };
const rows = (db: Database) =>
  db.query<Row, []>("SELECT id, older_id, newer_id, term, status, created_at FROM memory_conflict_staging ORDER BY id").all();
const recorded = (db: Database, v: number) =>
  (db.query<{ n: number }, [number]>("SELECT COUNT(*) n FROM _schema_version WHERE version=?").get(v)!).n;
const stagingDdl = (db: Database) =>
  db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name='memory_conflict_staging'").get()!.sql;

function seedValid(db: Database): void {
  const ids = ["a", "b", "c", "d", "e", "f"].map((l) => mem(db, l));
  const statuses = ["pending", "accepted", "rejected", "coexist", "pending"];
  statuses.forEach((s, i) => db.run(
    "INSERT INTO memory_conflict_staging (id, older_id, newer_id, term, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [100 + i * 7, ids[i]!, ids[i + 1]!, `term ${i}`, s, `2026-10-0${i + 1} 12:00:00`],
  ));
}

describe("migration 027 + per-statement runner", () => {
  it("happy path: every row preserved byte-for-byte, 'stale' allowed, v27 recorded", async () => {
    const db = await v26Db();
    seedValid(db);
    const before = rows(db);
    const res = await runPendingMigrations(db);
    expect(res.map((r) => r.version)).toContain(27);
    expect(rows(db)).toEqual(before);
    expect(stagingDdl(db)).toContain("'stale'");
    expect(recorded(db, 27)).toBe(1);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%_new' OR name LIKE '_m027%'").get()!.n).toBe(0);
    expect(db.query<{ c: number }, []>("SELECT COUNT(*) c FROM pragma_foreign_key_check").get()!.c).toBe(0);
    // Re-run is a no-op.
    expect(await runPendingMigrations(db)).toEqual([]);
    expect(rows(db)).toEqual(before);
    db.run("UPDATE memory_conflict_staging SET status='stale' WHERE id=100");
    expect(rows(db).find((r) => r.id === 100)!.status).toBe("stale");
  });

  it("orphan row: runner throws, table + rows intact, 027 not recorded", async () => {
    const db = await v26Db();
    seedValid(db);
    db.exec("PRAGMA foreign_keys=OFF;");
    db.run("INSERT INTO memory_conflict_staging (id, older_id, newer_id, term) VALUES (500, 99999, 99998, 'orphan')");
    db.exec("PRAGMA foreign_keys=ON;");
    const before = rows(db);
    expect(before.length).toBe(6);
    await expect(runPendingMigrations(db)).rejects.toThrow(/Migration 27/);
    expect(rows(db)).toEqual(before);
    expect(stagingDdl(db)).not.toContain("'stale'");
    expect(recorded(db, 27)).toBe(0);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM sqlite_master WHERE name='memory_conflict_staging_new'").get()!.n).toBe(0);
  });

  it("status the new CHECK rejects: runner throws, rows intact, 027 not recorded", async () => {
    const db = await v26Db();
    seedValid(db);
    db.exec("PRAGMA ignore_check_constraints=ON;");
    const [x, y] = [mem(db, "x"), mem(db, "y")];
    db.run("INSERT INTO memory_conflict_staging (id, older_id, newer_id, status) VALUES (600, ?, ?, 'dismissed')", [x, y]);
    db.exec("PRAGMA ignore_check_constraints=OFF;");
    const before = rows(db);
    await expect(runPendingMigrations(db)).rejects.toThrow(/Migration 27/);
    expect(rows(db)).toEqual(before);
    expect(recorded(db, 27)).toBe(0);
  });

  it("row-count guard in 027 aborts when the copy is short", async () => {
    const db = await v26Db();
    seedValid(db);
    const f = (await getMigrationFiles()).find((m) => m.version === 27)!;
    // Simulate a lossy copy: same SQL but the INSERT copies nothing.
    const lossy = f.content.replace(
      "SELECT id, older_id, newer_id, term, status, created_at FROM memory_conflict_staging;",
      "SELECT id, older_id, newer_id, term, status, created_at FROM memory_conflict_staging WHERE 0;",
    );
    expect(lossy).not.toBe(f.content);
    const { splitSqlStatements } = await import("../../migrations.js");
    const before = rows(db);
    expect(() => db.transaction(() => { for (const s of splitSqlStatements(lossy)) db.run(s); })()).toThrow(/CHECK/);
    expect(rows(db)).toEqual(before);
  });
});

describe("per-statement runner vs every shipped migration", () => {
  it("fresh DB: schema.sql + all migrations apply cleanly", async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec(readFileSync(CORE_SCHEMA, "utf-8"));
    const res = await runPendingMigrations(db);
    const files = await getMigrationFiles();
    expect(res.length).toBe(files.length);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM _schema_version").get()!.n).toBe(files.length);
  });
});

describe("backupDb snapshot", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("fs") as typeof import("fs");
  const { tmpdir } = require("os") as typeof import("os");
  const mod = join(import.meta.dir, "..", "..", "migrations.ts");

  /** Run a script in a subprocess whose LTM_DB_PATH is set before migrations.ts loads. */
  function runScript(dbFile: string, body: string): Record<string, unknown> {
    const dir = mkdtempSync(join(tmpdir(), "ltm-backup-script-"));
    const script = join(dir, "s.ts");
    writeFileSync(script, `
      import { Database } from "bun:sqlite";
      import { existsSync, readFileSync } from "fs";
      const m = await import(${JSON.stringify(mod)});
      const DB = ${JSON.stringify(dbFile)};
      ${body}
    `);
    try {
      const r = Bun.spawnSync([process.execPath, script], {
        env: { ...process.env, LTM_DB_PATH: dbFile }, stdout: "pipe", stderr: "pipe",
      });
      expect(r.exitCode).toBe(0);
      return JSON.parse(r.stdout.toString().trim().split("\n").pop()!);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const WAL_SETUP = `
    const db = new Database(DB, { create: true });
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(x); INSERT INTO t VALUES (1),(2),(3);");
    const rowsIn = (p) => (new Database(p, { readonly: true }).query("SELECT COUNT(*) c FROM t").get()).c;
  `;

  it("includes rows still only in the -wal file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ltm-backup-wal-"));
    try {
      const out = runScript(join(dir, "w.db"), WAL_SETUP + `
        const p = await m.backupDb();
        console.log(JSON.stringify({ rows: rowsIn(p), walExists: existsSync(DB + "-wal") }));
      `);
      expect(out.walExists).toBe(true);
      expect(out.rows).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collision: pre-existing file untouched; new backup at a suffixed path with WAL rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "ltm-backup-collide-"));
    try {
      const out = runScript(join(dir, "w.db"), WAL_SETUP + `
        const now = new Date("2026-10-14T05:00:00.000Z");
        const base = DB + ".bak-" + now.toISOString().replace(/[:.]/g, "-");
        await Bun.write(base, "PRE-EXISTING");
        const p1 = await m.backupDb(now);
        const p2 = await m.backupDb(now);
        console.log(JSON.stringify({
          base, p1, p2, untouched: readFileSync(base, "utf-8") === "PRE-EXISTING",
          rows1: rowsIn(p1), rows2: rowsIn(p2),
        }));
      `);
      expect(out.untouched).toBe(true);
      expect(out.p1).toBe(`${out.base}-1`);
      expect(out.p2).toBe(`${out.base}-2`);
      expect(out.rows1).toBe(3);
      expect(out.rows2).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("VACUUM INTO failure throws and aborts the migration run (nothing recorded)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ltm-backup-fail-"));
    const dbFile = join(dir, "w.db");
    try {
      // The live DB path holds bytes that are not a database: VACUUM INTO fails.
      writeFileSync(dbFile, "not a sqlite database ".repeat(200));
      const out = runScript(dbFile, `
        const mem = new Database(":memory:");
        let error = "";
        try { await m.runPendingMigrations(mem); } catch (e) { error = String(e.message ?? e); }
        const recorded = (mem.query("SELECT COUNT(*) c FROM _schema_version").get()).c;
        const { readdirSync } = await import("fs");
        const baks = readdirSync(${JSON.stringify(dir)}).filter((f) => f.includes(".bak-"));
        console.log(JSON.stringify({ error, recorded, baks: baks.length }));
      `);
      expect(String(out.error)).toContain("backup failed");
      expect(out.recorded).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
