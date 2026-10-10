import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-supersede-wire-${process.pid}-${Date.now()}.db`;
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

function insertMem(content: string): number {
  return Number(
    db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
       VALUES (?, 'architecture', 3, 1.0, 'active', ?)`,
      [content, `dedup-${content.slice(0, 40)}-${Math.random()}`],
    ).lastInsertRowid,
  );
}

describe("supersede wire — single SoT", () => {
  it("supersede() sets status + superseded_by/at + relation", () => {
    const older = insertMem("use npm for installs");
    const newer = insertMem("use bun for installs");
    core.supersede(newer, older);
    const row = db.query<{ status: string; superseded_by: number }, [number]>(
      "SELECT status, superseded_by FROM memories WHERE id=?",
    ).get(older)!;
    expect(row.status).toBe("superseded");
    expect(row.superseded_by).toBe(newer);
    const rel = db.query<{ c: number }, [number, number]>(
      `SELECT COUNT(*) as c FROM memory_relations
       WHERE source_memory_id=? AND target_memory_id=? AND relationship_type='supersedes'`,
    ).get(newer, older)!;
    expect(rel.c).toBe(1);
  });

  it("stageContradictions does not auto-apply supersede", () => {
    const older = insertMem("prefer rest apis here");
    const newer = insertMem("prefer graphql apis here");
    const n = core.stageContradictions([
      {
        olderId: older,
        olderContent: "prefer rest",
        newerId: newer,
        newerContent: "prefer graphql",
        term: "rest vs graphql",
      },
    ]);
    expect(n).toBe(1);
    const row = db.query<{ status: string; superseded_by: number | null }, [number]>(
      "SELECT status, superseded_by FROM memories WHERE id=?",
    ).get(older)!;
    expect(row.status).toBe("active");
    expect(row.superseded_by).toBeNull();
    const staged = core.listStagedConflicts(10);
    expect(staged.some((s) => s.olderId === older && s.newerId === newer)).toBe(true);
  });

  it("mergeMemories sets superseded_by columns", () => {
    const keep = insertMem("keep this memory body");
    const drop = insertMem("drop this duplicate body");
    core.mergeMemories(keep, drop);
    const row = db.query<{ status: string; superseded_by: number }, [number]>(
      "SELECT status, superseded_by FROM memories WHERE id=?",
    ).get(drop)!;
    expect(row.status).toBe("superseded");
    expect(row.superseded_by).toBe(keep);
  });
});

describe("stageContradictions term scrub", () => {
  it("known contradiction terms pass through unchanged", () => {
    expect(core.sanitizeStagingTerm("npm vs bun")).toBe("npm vs bun");
  });

  it("plant-secret: caller-supplied term is scrubbed before staging", () => {
    const AWS = "AKIAIOSFODNN7EXAMPLE";
    const older = insertMem("secret term older body");
    const newer = insertMem("secret term newer body");
    core.stageContradictions([
      { olderId: older, olderContent: "a", newerId: newer, newerContent: "b", term: `key ${AWS}` },
    ]);
    const row = db.query<{ term: string | null }, [number, number]>(
      "SELECT term FROM memory_conflict_staging WHERE older_id=? AND newer_id=?",
    ).get(older, newer)!;
    expect(row.term ?? "").not.toContain(AWS);
  });

  it("scrub failure drops term (NULL) rather than storing raw", () => {
    core._forceScrubThrowForTesting(true);
    try {
      expect(core.sanitizeStagingTerm("raw AKIAIOSFODNN7EXAMPLE")).toBeNull();
    } finally {
      core._forceScrubThrowForTesting(false);
    }
  });
});

