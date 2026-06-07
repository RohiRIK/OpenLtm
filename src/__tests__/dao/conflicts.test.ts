import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-conflicts-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let getRecentConflicts: typeof import("@rohirik/openltm-core").getRecentConflicts;
let db: Database;

beforeAll(async () => {
  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  const { _setDbForTesting } = await import("@rohirik/openltm-core");

  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(readFileSync(schemaPath, "utf-8"));
  await runPendingMigrations(db);
  _setDbForTesting(db);

  ({ getRecentConflicts } = await import("@rohirik/openltm-core"));
}, 30_000);

afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

function insertMemory(content: string, project: string | null = "test-proj"): number {
  db.run(
    `INSERT INTO memories (content, category, importance, project_scope, created_at, last_confirmed_at, last_used_at)
     VALUES (?, 'pattern', 3, ?, datetime('now'), datetime('now'), datetime('now'))`,
    [content, project],
  );
  return (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
}

function markSuperseded(oldId: number, newId: number, daysAgo = 1): void {
  db.run(
    `UPDATE memories SET superseded_by=?, superseded_at=datetime('now', ?), status='superseded'
     WHERE id=?`,
    [newId, `-${daysAgo} days`, oldId],
  );
}

describe("getRecentConflicts", () => {
  it("returns empty array when no conflicts", () => {
    const rows = getRecentConflicts(db, "no-conflict-proj", 10);
    expect(rows).toEqual([]);
  });

  it("returns a conflict within 7-day window", () => {
    const oldId = insertMemory("old pattern");
    const newId = insertMemory("new pattern");
    markSuperseded(oldId, newId, 1); // 1 day ago — within window

    const rows = getRecentConflicts(db, "test-proj", 10);
    const found = rows.find(r => r.olderId === oldId);
    expect(found).toBeDefined();
    expect(found!.newerId).toBe(newId);
    expect(found!.olderContent).toBe("old pattern");
    expect(found!.newerContent).toBe("new pattern");
  });

  it("excludes conflicts older than 7 days", () => {
    const oldId = insertMemory("stale pattern");
    const newId = insertMemory("stale replacement");
    markSuperseded(oldId, newId, 10); // 10 days ago — outside window

    const rows = getRecentConflicts(db, "test-proj", 10);
    expect(rows.find(r => r.olderId === oldId)).toBeUndefined();
  });

  it("respects limit parameter", () => {
    const project = "limit-test-proj";
    for (let i = 0; i < 5; i++) {
      const o = insertMemory(`old-${i}`, project);
      const n = insertMemory(`new-${i}`, project);
      markSuperseded(o, n, 1);
    }
    const rows = getRecentConflicts(db, project, 3);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it("scopes results to the given project", () => {
    const oldId = insertMemory("other-proj content", "other-proj");
    const newId = insertMemory("other-proj replacement", "other-proj");
    markSuperseded(oldId, newId, 1);

    const rows = getRecentConflicts(db, "scoped-test-proj", 10);
    expect(rows.find(r => r.olderId === oldId)).toBeUndefined();
  });
});
