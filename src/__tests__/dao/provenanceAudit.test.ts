/**
 * DAO unit tests for provenanceAudit.ts.
 * Uses _setDbForTesting for process-level isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-prov-dao-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let insertProvenance: typeof import("@rohirik/ltm-core").insertProvenance;
let insertAudit: typeof import("@rohirik/ltm-core").insertAudit;
let listProvenance: typeof import("@rohirik/ltm-core").listProvenance;
let queryAudit: typeof import("@rohirik/ltm-core").queryAudit;
let snapshotMemory: typeof import("@rohirik/ltm-core").snapshotMemory;
let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  const { _setDbForTesting } = await import("@rohirik/ltm-core");
  _setDbForTesting(db);

  const { runPendingMigrations } = await import("@rohirik/ltm-core");
  await runPendingMigrations(db);

  const dao = await import("@rohirik/ltm-core");
  insertProvenance = dao.insertProvenance;
  insertAudit = dao.insertAudit;
  listProvenance = dao.listProvenance;
  queryAudit = dao.queryAudit;
  snapshotMemory = dao.snapshotMemory;
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

function seedMemory(content = "test memory"): number {
  const r = db.run(
    `INSERT INTO memories (content, category, importance, confidence, dedup_key)
     VALUES (?, 'pattern', 3, 1.0, ?)`,
    [content, `dedup-${Date.now()}-${Math.random()}`]
  );
  return Number(r.lastInsertRowid);
}

describe("insertProvenance", () => {
  it("round-trips: inserted row is retrievable", () => {
    const memId = seedMemory("prov round-trip");
    const id = insertProvenance(db, { memory_id: memId, source_type: "learn", actor: "test:agent", source_ref: "sess_abc" });
    expect(id).toBeGreaterThan(0);
    const rows = listProvenance(db, memId);
    const found = rows.find(r => r.id === id);
    expect(found).toBeDefined();
    expect(found?.source_type).toBe("learn");
    expect(found?.actor).toBe("test:agent");
    expect(found?.source_ref).toBe("sess_abc");
  });

  it("rejects invalid source_type (CHECK constraint)", () => {
    const memId = seedMemory("bad prov");
    expect(() =>
      db.run(
        `INSERT INTO memory_provenance (memory_id, source_type) VALUES (?, ?)`,
        [memId, "invalid-type"]
      )
    ).toThrow();
  });

  it("metadata field stored as JSON string", () => {
    const memId = seedMemory("prov meta");
    const meta = JSON.stringify({ turn: 7, score: 0.92 });
    insertProvenance(db, { memory_id: memId, source_type: "evaluate-session", metadata: meta });
    const [row] = listProvenance(db, memId);
    expect(row?.metadata).toBe(meta);
  });
});

describe("insertAudit", () => {
  it("round-trips: inserted row is retrievable", () => {
    const memId = seedMemory("audit round-trip");
    const after = JSON.stringify({ id: memId, content: "audit round-trip" });
    const id = insertAudit(db, { memory_id: memId, op: "insert", actor: "mcp:ltm_learn", after_json: after });
    expect(id).toBeGreaterThan(0);
    const rows = queryAudit(db, { memoryId: memId });
    const found = rows.find(r => r.id === id);
    expect(found?.op).toBe("insert");
    expect(found?.actor).toBe("mcp:ltm_learn");
    expect(found?.after_json).toBe(after);
  });

  it("rejects invalid op (CHECK constraint)", () => {
    const memId = seedMemory("bad audit op");
    expect(() =>
      db.run(
        `INSERT INTO memory_audit (memory_id, op, actor) VALUES (?, ?, ?)`,
        [memId, "destroy", "test"]
      )
    ).toThrow();
  });

  it("memory_id NOT FK — audit row survives memory deletion", () => {
    const memId = seedMemory("deletable");
    insertAudit(db, { memory_id: memId, op: "forget", actor: "mcp:ltm_forget" });
    db.run(`DELETE FROM memories WHERE id=?`, [memId]);
    const rows = queryAudit(db, { memoryId: memId });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("listProvenance", () => {
  it("returns empty array for unknown memory", () => {
    expect(listProvenance(db, 999999)).toEqual([]);
  });

  it("returns rows ordered newest first", () => {
    const memId = seedMemory("prov order");
    insertProvenance(db, { memory_id: memId, source_type: "legacy" });
    insertProvenance(db, { memory_id: memId, source_type: "learn" });
    const rows = listProvenance(db, memId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.source_type).toBe("learn");
    expect(rows[rows.length - 1]?.source_type).toBe("legacy");
  });
});

describe("queryAudit", () => {
  it("filters by memoryId", () => {
    const memId = seedMemory("audit filter");
    insertAudit(db, { memory_id: memId, op: "insert", actor: "test" });
    const rows = queryAudit(db, { memoryId: memId });
    expect(rows.every(r => r.memory_id === memId)).toBe(true);
  });

  it("filters by op", () => {
    const memId = seedMemory("audit op filter");
    insertAudit(db, { memory_id: memId, op: "insert", actor: "a" });
    insertAudit(db, { memory_id: memId, op: "update", actor: "a" });
    const inserts = queryAudit(db, { memoryId: memId, op: "insert" });
    const updates = queryAudit(db, { memoryId: memId, op: "update" });
    expect(inserts.every(r => r.op === "insert")).toBe(true);
    expect(updates.every(r => r.op === "update")).toBe(true);
  });

  it("filters by sessionId", () => {
    const memId = seedMemory("audit sess filter");
    insertAudit(db, { memory_id: memId, op: "insert", actor: "a", session_id: "sess_xyz" });
    insertAudit(db, { memory_id: memId, op: "update", actor: "a", session_id: "sess_other" });
    const rows = queryAudit(db, { memoryId: memId, sessionId: "sess_xyz" });
    expect(rows.every(r => r.session_id === "sess_xyz")).toBe(true);
  });

  it("respects limit", () => {
    const memId = seedMemory("audit limit");
    for (let i = 0; i < 10; i++) {
      insertAudit(db, { memory_id: memId, op: "update", actor: "a" });
    }
    const rows = queryAudit(db, { memoryId: memId, limit: 3 });
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

describe("snapshotMemory", () => {
  it("returns null for nonexistent memory", () => {
    expect(snapshotMemory(db, 999999)).toBeNull();
  });

  it("returns slim row without embedding field", () => {
    const memId = seedMemory("snap test");
    const snap = snapshotMemory(db, memId);
    expect(snap).not.toBeNull();
    expect(snap?.id).toBe(memId);
    expect(snap?.content).toBe("snap test");
    expect("embedding" in (snap ?? {})).toBe(false);
  });

  it("snapshot captures all expected columns", () => {
    const memId = seedMemory("snap cols");
    const snap = snapshotMemory(db, memId)!;
    const requiredKeys = ["id","content","category","importance","confidence","status","created_at","confirm_count"];
    for (const key of requiredKeys) {
      expect(key in snap).toBe(true);
    }
  });
});
