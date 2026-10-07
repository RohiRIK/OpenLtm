import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-near-dedup-${process.pid}-${Date.now()}.db`;
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

describe("learn near-dedup #16", () => {
  it("exact match reinforces with matched_by exact", () => {
    const a = core.learn({
      content: "Always prefer Bun over npm for scripts in this repo",
      category: "preference",
      importance: 4,
      skipExport: true,
    });
    const b = core.learn({
      content: "Always prefer Bun over npm for scripts in this repo",
      category: "preference",
      importance: 4,
      skipExport: true,
    });
    expect(b.action).toBe("reinforced");
    expect(b.id).toBe(a.id);
    expect(b.matched_by).toBe("exact");
  });

  it("containment elaboration reinforces", () => {
    const a = core.learn({
      content: "docker hub rate limits unauthenticated pulls",
      category: "gotcha",
      importance: 3,
      skipExport: true,
    });
    const b = core.learn({
      content: "docker hub rate limits unauthenticated pulls at 100 per 6 hours",
      category: "gotcha",
      importance: 3,
      skipExport: true,
    });
    expect(b.action).toBe("reinforced");
    expect(b.id).toBe(a.id);
    expect(b.matched_by === "containment" || b.matched_by === "jaccard").toBe(true);
  });

  it("does not silently merge deliberate siblings", () => {
    const a = core.learn({
      content: "Phase4 high importance sort check marker",
      category: "pattern",
      importance: 3,
      skipExport: true,
    });
    const b = core.learn({
      content: "Phase4 low importance sort check marker",
      category: "pattern",
      importance: 3,
      skipExport: true,
    });
    // Must not reinforce into one memory
    expect(b.action).toBe("created");
    expect(b.id).not.toBe(a.id);
  });
});
