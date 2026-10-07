import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-mcp-get-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

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

describe("getMemoryById + MCP get progressive fetch", () => {
  it("returns full memory by id", () => {
    const learned = core.learn({
      content: "Progressive fetch full body decision about using Bun",
      category: "architecture",
      importance: 4,
      title: "Use Bun",
      skipExport: true,
    });
    const mem = core.getMemoryById(learned.id);
    expect(mem).toBeTruthy();
    expect(mem!.content).toContain("Bun");
    expect(mem!.title).toBe("Use Bun");
  });

  it("returns null for missing id", () => {
    expect(core.getMemoryById(99999999)).toBeNull();
  });

  it("egress scrub on get payload (plant secret)", () => {
    const id = Number(
      db.run(
        `INSERT INTO memories (content, category, importance, confidence, status, dedup_key, title)
         VALUES (?, 'gotcha', 3, 1.0, 'active', ?, 'secret row')`,
        [`legacy secret AKIAIOSFODNN7EXAMPLE in db`, `get-secret-${Date.now()}`],
      ).lastInsertRowid,
    );
    const mem = core.getMemoryById(id)!;
    const scrubbed = core.scrubForEgress(mem.content);
    expect(scrubbed).not.toContain(AWS_KEY);
  });
});
