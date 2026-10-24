import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-stats-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

let core: typeof import("../index.js");
let db: Database;

const insert = (content: string, extra: { project?: string; status?: string; stale?: boolean; importance?: number } = {}): number =>
  Number(db.run(
    `INSERT INTO memories (content, category, importance, status, project_scope, dedup_key, stale_flagged_at, stale_reason)
     VALUES (?, 'gotcha', ?, ?, ?, ?, ?, ?)`,
    [content, extra.importance ?? 3, extra.status ?? "active", extra.project ?? null, `stats-${content}`,
     extra.stale ? "2026-10-24 10:00:00" : null, extra.stale ? "files changed in abc123" : null],
  ).lastInsertRowid);

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);

  insert("global note", { importance: 5 });
  insert("alpha fresh", { project: "alpha" });
  insert("alpha stale", { project: "alpha", stale: true });
  insert("beta stale", { project: "beta", stale: true });
  insert("alpha old", { project: "alpha", status: "superseded", stale: true });
  const priv = insert("alpha private stale", { project: "alpha", stale: true });
  db.run(`INSERT INTO tags (name) VALUES ('private')`);
  db.run(`INSERT INTO memory_tags (memory_id, tag_id) SELECT ?, id FROM tags WHERE name = 'private'`, [priv]);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("listStaleMemories", () => {
  it("returns active stale memories only, without private ones by default", () => {
    const rows = core.listStaleMemories();
    expect(rows.map((r) => r.content).sort()).toEqual(["alpha stale", "beta stale"]);
    expect(rows[0]!.stale_reason).toBe("files changed in abc123");
  });

  it("scopes to a project and can include private memories", () => {
    expect(core.listStaleMemories({ project: "alpha" }).map((r) => r.content)).toEqual(["alpha stale"]);
    expect(core.listStaleMemories({ project: "alpha", includePrivate: true }).map((r) => r.content).sort())
      .toEqual(["alpha private stale", "alpha stale"]);
  });
});

describe("memoryStats", () => {
  it("counts the whole store", () => {
    const s = core.memoryStats();
    expect(s.active).toBe(5);
    expect(s.byStatus).toEqual({ active: 5, superseded: 1 });
    expect(s.byCategory).toEqual({ gotcha: 5 });
    expect(s.byImportance).toEqual({ "3": 4, "5": 1 });
    expect(s.stale).toBe(3);
    expect(s.private).toBe(1);
    expect(s.embedded).toBe(0);
  });

  it("scopes to a project plus global memories", () => {
    const s = core.memoryStats("alpha");
    expect(s.project).toBe("alpha");
    expect(s.active).toBe(4);
    expect(s.stale).toBe(2);
  });
});
