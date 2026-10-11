/**
 * Core opening a DB the Hermes plugin created (shared memory via LTM_DB_PATH).
 *
 * The Hermes plugin builds its own schema (hermes/openltm_hermes/_db.py) with
 * columns core adds in later migrations, but not every index or table those
 * migrations add — so plain `db.exec(up)` collides part-way. The runner must
 * reconcile: skip only what is provably present, run the rest, record nothing
 * on any refusal.
 */
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import {
  getMigrationFiles,
  isDestructiveStatement,
  reconcileMigration,
  runPendingMigrations,
  splitSqlStatements,
} from "../../migrations.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const CORE_SCHEMA = join(import.meta.dir, "..", "..", "schema.sql");
const HERMES_DB_PY = readFileSync(join(ROOT, "hermes", "openltm_hermes", "_db.py"), "utf-8");
const HERMES_SCHEMA_SQL = readFileSync(join(ROOT, "hermes", "schema.sql"), "utf-8");

/** A triple-quoted SQL constant from the Hermes plugin source. */
function hermesSql(name: string): string {
  const m = new RegExp(`^${name} = """([\\s\\S]*?)"""`, "m").exec(HERMES_DB_PY);
  if (!m) throw new Error(`${name} not found in hermes/openltm_hermes/_db.py`);
  return m[1]!;
}

/** What the Hermes plugin's init_schema() leaves on disk. */
function hermesInitSchema(db: Database): void {
  db.exec(hermesSql("SCHEMA_SQL"));
  db.exec(hermesSql("FTS_SQL"));
  db.exec(hermesSql("FTS_TRIGGERS_SQL"));
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(memories)").all().map((c) => c.name);
  if (!cols.includes("decay_score")) {
    db.exec("ALTER TABLE memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_memories_decay_score ON memories (decay_score DESC)");
}

const VEC = new Uint8Array(new Float32Array([0.25, 0.5, 0.75, 1]).buffer);

/** Rows the way the Hermes plugin writes them (ISO timestamps, inline vector). */
function seedHermesRows(db: Database): void {
  const iso = "2026-10-11T07:34:14.934173+00:00";
  db.run(
    `INSERT INTO memories (content, title, category, importance, dedup_key, project_scope,
       created_at, last_confirmed_at, last_used_at, embedding)
     VALUES (?, ?, 'gotcha', 4, 'a1b2c3d4e5f60718', 'infra', ?, ?, ?, ?)`,
    ["Hermes canary: deploy env must set NODE_ENV before build", "Deploy env canary", iso, iso, iso, VEC],
  );
  db.run(
    `INSERT INTO memories (content, category, dedup_key, created_at, last_confirmed_at, last_used_at)
     VALUES ('Gateway restarts reload plugins only at startup', 'workflow', 'b1b2c3d4e5f60718', ?, ?, ?)`,
    [iso, iso, iso],
  );
  db.run("INSERT INTO tags (name) VALUES ('deploy')");
  db.run("INSERT INTO memory_tags (memory_id, tag_id) VALUES (1, 1)");
  db.run("INSERT INTO memory_relations (source_memory_id, target_memory_id, relationship_type) VALUES (1, 2, 'related_to')");
  db.run("INSERT INTO context_items (project_name, type, content, title) VALUES ('infra', 'decision', 'Use WAL for the shared DB', 'WAL decision')");
}

/** What core's initDb() does to an existing DB: schema.sql, then the runner. */
async function openWithCore(db: Database): Promise<void> {
  db.exec(readFileSync(CORE_SCHEMA, "utf-8"));
  await runPendingMigrations(db);
}

function names(db: Database, type: string): string[] {
  return db
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = ?")
    .all(type)
    .map((r) => r.name);
}

function cols(db: Database, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function newHermesDb(withCanonicalSchema: boolean): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  if (withCanonicalSchema) db.exec(HERMES_SCHEMA_SQL);
  hermesInitSchema(db);
  seedHermesRows(db);
  return db;
}

for (const [label, canonical] of [
  ["plugin init_schema", false],
  ["hermes/schema.sql + plugin init_schema", true],
] as const) {
  describe(`core opens a Hermes-created DB (${label})`, () => {
    it("records every migration and adds what the Hermes schema lacks", async () => {
      const db = newHermesDb(canonical);
      await openWithCore(db);

      const files = await getMigrationFiles();
      const recorded = db
        .query<{ version: number }, []>("SELECT version FROM _schema_version ORDER BY version")
        .all()
        .map((r) => r.version);
      expect(recorded).toEqual(files.map((f) => f.version));

      const indexes = names(db, "index");
      expect(indexes).toContain("idx_memories_workspace");
      expect(indexes).toContain("idx_memories_agent");
      expect(cols(db, "context_items")).toContain("agent_id");
      expect(names(db, "table")).toEqual(
        expect.arrayContaining(["memory_archive", "memory_provenance", "memory_audit", "memory_embeddings"]),
      );
      expect(await runPendingMigrations(db)).toEqual([]);
    });

    it("keeps the Hermes rows, their vector, tags, relations and context", async () => {
      const db = newHermesDb(canonical);
      await openWithCore(db);

      expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM memories").get()!.n).toBe(2);
      const emb = db
        .query<{ embedding: Uint8Array }, []>("SELECT embedding FROM memory_embeddings WHERE memory_id = 1")
        .get();
      expect(Buffer.from(emb!.embedding).equals(Buffer.from(VEC))).toBe(true);
      expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM memory_tags").get()!.n).toBe(1);
      expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM memory_relations").get()!.n).toBe(1);
      expect(db.query<{ title: string }, []>("SELECT title FROM context_items").get()!.title).toBe("WAL decision");
    });

    it("leaves both FTS indexes consistent and searchable once per row", async () => {
      const db = newHermesDb(canonical);
      await openWithCore(db);

      for (const t of ["memories_fts", "context_items_fts"]) {
        expect(() => db.run(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`)).not.toThrow();
      }
      const mem = db.query<{ rowid: number }, []>("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'canary'").all();
      expect(mem.map((r) => r.rowid)).toEqual([1]);
      const ctx = db.query<{ rowid: number }, []>("SELECT rowid FROM context_items_fts WHERE context_items_fts MATCH 'WAL'").all();
      expect(ctx.map((r) => r.rowid)).toEqual([1]);
    });
  });
}

describe("splitSqlStatements", () => {
  it("keeps a trigger body, quoted semicolons and commented semicolons inside one statement", () => {
    const sql = `
      CREATE TABLE t (a TEXT DEFAULT 'x;y'); -- trailing; comment
      CREATE TRIGGER IF NOT EXISTS t_ai AFTER INSERT ON t BEGIN
        INSERT INTO log VALUES (new.a);
        UPDATE t SET a = CASE WHEN a = 'z' THEN 'q' END;
      END;
      /* block; comment */ UPDATE t SET a = "b;c"`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toBe("CREATE TABLE t (a TEXT DEFAULT 'x;y')");
    expect(stmts[1]).toStartWith("CREATE TRIGGER IF NOT EXISTS t_ai");
    expect(stmts[1]).toEndWith("END");
    expect(stmts[2]).toBe('UPDATE t SET a = "b;c"');
  });
});

describe("isDestructiveStatement", () => {
  it("flags statements that remove schema or rows", () => {
    for (const s of [
      "DROP TABLE x",
      "drop index if exists i",
      "DELETE FROM memories",
      "ALTER TABLE memories DROP COLUMN embedding",
      "ALTER TABLE a RENAME TO b",
      "VACUUM",
    ]) {
      expect(isDestructiveStatement(s)).toBe(true);
    }
    for (const s of [
      "ALTER TABLE memories ADD COLUMN created_by TEXT",
      "ALTER TABLE memories ADD COLUMN reason TEXT DEFAULT 'drop'",
      "CREATE INDEX IF NOT EXISTS i ON t(a)",
      "UPDATE memories SET created_by = 'x' WHERE created_by IS NULL",
      "INSERT INTO t VALUES (1)",
    ]) {
      expect(isDestructiveStatement(s)).toBe(false);
    }
  });
});

describe("reconcileMigration", () => {
  function base(): Database {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT); INSERT INTO t (id) VALUES (1);");
    return db;
  }

  it("skips a present column, then runs the missing DDL and the backfill after it", () => {
    const db = base();
    db.transaction(() =>
      reconcileMigration(
        db,
        `ALTER TABLE t ADD COLUMN a TEXT;
         CREATE INDEX IF NOT EXISTS idx_t_a ON t(a);
         ALTER TABLE t ADD COLUMN c TEXT;
         UPDATE t SET a = 'filled' WHERE a IS NULL;`,
      ),
    )();
    expect(names(db, "index")).toContain("idx_t_a");
    expect(cols(db, "t")).toContain("c");
    expect(db.query<{ a: string }, []>("SELECT a FROM t").get()!.a).toBe("filled");
  });

  it("refuses a destructive statement and the transaction rolls everything back", () => {
    const db = base();
    expect(() =>
      db.transaction(() =>
        reconcileMigration(db, "ALTER TABLE t ADD COLUMN a TEXT; CREATE INDEX idx_t_b ON t(b); DROP TABLE t;"),
      )(),
    ).toThrow(/destructive/);
    expect(names(db, "index")).not.toContain("idx_t_b");
    expect(names(db, "table")).toContain("t");
  });

  it("propagates a failing statement and the transaction rolls everything back", () => {
    const db = base();
    expect(() =>
      db.transaction(() =>
        reconcileMigration(db, "CREATE INDEX idx_t_b ON t(b); INSERT INTO missing_table VALUES (1);"),
      )(),
    ).toThrow(/missing_table/);
    expect(names(db, "index")).not.toContain("idx_t_b");
  });

  it("never skips a non-DDL statement just because its table exists", () => {
    const db = base();
    db.transaction(() => reconcileMigration(db, "INSERT INTO t (id, a) VALUES (2, 'new');"))();
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM t").get()!.n).toBe(2);
  });
});
