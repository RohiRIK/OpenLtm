import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-supersede-ux-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

let core: typeof import("../index.js");
let db: Database;

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("supersede UX resolve", () => {
  it("acceptStagedConflict applies supersede and marks accepted", () => {
    const older = Number(db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
       VALUES ('use npm', 'architecture', 3, 1, 'active', 'ux-old-${Date.now()}')`,
    ).lastInsertRowid);
    const newer = Number(db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
       VALUES ('use bun', 'architecture', 3, 1, 'active', 'ux-new-${Date.now()}')`,
    ).lastInsertRowid);
    core.stageContradictions([{
      olderId: older, olderContent: "npm", newerId: newer, newerContent: "bun", term: "npm vs bun",
    }]);
    const staged = core.listStagedConflicts(5).find((s) => s.olderId === older)!;
    expect(core.acceptStagedConflict(staged.id)).toBe(true);
    const row = db.query<{ status: string; superseded_by: number }, [number]>(
      "SELECT status, superseded_by FROM memories WHERE id=?",
    ).get(older)!;
    expect(row.status).toBe("superseded");
    expect(row.superseded_by).toBe(newer);
  });

  it("rejectStagedConflict leaves memories active", () => {
    const older = Number(db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
       VALUES ('rest api', 'architecture', 3, 1, 'active', 'ux-r-old-${Date.now()}')`,
    ).lastInsertRowid);
    const newer = Number(db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
       VALUES ('graphql api', 'architecture', 3, 1, 'active', 'ux-r-new-${Date.now()}')`,
    ).lastInsertRowid);
    core.stageContradictions([{
      olderId: older, olderContent: "rest", newerId: newer, newerContent: "graphql", term: "rest vs graphql",
    }]);
    const staged = core.listStagedConflicts(5).find((s) => s.olderId === older)!;
    expect(core.rejectStagedConflict(staged.id)).toBe(true);
    const row = db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id=?").get(older)!;
    expect(row.status).toBe("active");
  });

  // The SessionStart banner is asserted on real hook output in src/__tests__/hooks/sessionstart-compact.test.ts.
});
