/**
 * G0 — Schema-sync test harness for Phase 7 (migrations 015-021).
 * Verifies:
 *   1. Fresh DB + runPendingMigrations() produces all Phase 7 columns/tables.
 *   2. src/schema.sql and packages/ltm-core/src/schema.sql are byte-identical.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC_SCHEMA = join(ROOT, "src", "schema.sql");
const CORE_SCHEMA = join(ROOT, "packages", "ltm-core", "src", "schema.sql");
const dbPath = `/tmp/test-schema-sync-${process.pid}-${Date.now()}.db`;

let db: Database;

function cols(table: string): string[] {
  return db
    .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .map(r => r.name);
}

function tableExists(table: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      `SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name=?`
    )
    .get(table);
  return (row?.n ?? 0) > 0;
}

function vtableExists(table: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      `SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name=?`
    )
    .get(table);
  return (row?.n ?? 0) > 0;
}

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SRC_SCHEMA, "utf-8"));

  const { _setDbForTesting } = await import("@rohirik/ltm-core");
  _setDbForTesting(db);

  const { runPendingMigrations } = await import("@rohirik/ltm-core");
  await runPendingMigrations(db);
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("schema-sync — dual schema.sql files are identical", () => {
  it("src/schema.sql matches packages/ltm-core/src/schema.sql byte-for-byte", () => {
    const src = readFileSync(SRC_SCHEMA, "utf-8");
    const core = readFileSync(CORE_SCHEMA, "utf-8");
    expect(src).toBe(core);
  });
});

describe("migration 015 — title columns", () => {
  it("memories.title exists", () => expect(cols("memories")).toContain("title"));
  it("context_items.title exists", () => expect(cols("context_items")).toContain("title"));
});

describe("migration 016 — memory_layout table", () => {
  it("memory_layout table exists", () => expect(tableExists("memory_layout")).toBe(true));

  it("memory_layout has expected columns", () => {
    const c = cols("memory_layout");
    expect(c).toContain("memory_id");
    expect(c).toContain("view");
    expect(c).toContain("x");
    expect(c).toContain("y");
    expect(c).toContain("pinned");
  });
});

describe("migration 017 — node UI state columns", () => {
  it("memories.hidden exists", () => expect(cols("memories")).toContain("hidden"));
  it("memories.color exists", () => expect(cols("memories")).toContain("color"));
  it("memories.icon exists", () => expect(cols("memories")).toContain("icon"));
});

describe("migration 018 — relation semantics columns", () => {
  it("memory_relations.note exists", () => expect(cols("memory_relations")).toContain("note"));
  it("memory_relations.weight exists", () => expect(cols("memory_relations")).toContain("weight"));
});

describe("migration 019 — user_note column", () => {
  it("memories.user_note exists", () => expect(cols("memories")).toContain("user_note"));
});

describe("migration 020 — FTS coverage", () => {
  it("memories_fts virtual table exists", () => expect(vtableExists("memories_fts")).toBe(true));
  it("context_items_fts virtual table exists", () => expect(vtableExists("context_items_fts")).toBe(true));

  it("memories_fts includes title in its content", () => {
    // Insert a memory with a distinct title and verify FTS can find it
    db.run(
      `INSERT INTO memories (id, content, title, category, importance, confidence, dedup_key)
       VALUES (9001, 'some fts test content', 'UniqueFtsTitle9001', 'pattern', 3, 1.0, 'dedup-fts-9001')`
    );
    const hit = db
      .query<{ rowid: number }, [string]>(
        `SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?`
      )
      .get("UniqueFtsTitle9001");
    expect(hit).not.toBeNull();
  });

  it("context_items_fts is populated via trigger on insert", () => {
    db.run(
      `INSERT INTO context_items (id, project_name, type, content, title, permanent)
       VALUES (9001, 'test-proj', 'goal', 'ctx fts content', 'UniqueFtsCtxTitle9001', 0)`
    );
    const hit = db
      .query<{ rowid: number }, [string]>(
        `SELECT rowid FROM context_items_fts WHERE context_items_fts MATCH ?`
      )
      .get("UniqueFtsCtxTitle9001");
    expect(hit).not.toBeNull();
  });
});

describe("migration 021 — cluster manual_label column", () => {
  it("memory_clusters.manual_label exists", () => {
    expect(cols("memory_clusters")).toContain("manual_label");
  });

  it("manual_label defaults to 0", () => {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO memory_clusters (id, label, color, node_ids, created_at, updated_at)
       VALUES ('test-cluster-9001', 'Test', '#ccc', '[]', ?, ?)`,
      [now, now]
    );
    const row = db
      .query<{ manual_label: number }, [string]>(
        `SELECT manual_label FROM memory_clusters WHERE id=?`
      )
      .get("test-cluster-9001");
    expect(row?.manual_label).toBe(0);
  });
});
