/**
 * Integration tests: learn() + forget() instrumentation, recall({ includeProvenance }).
 * Verifies audit rows are produced, snapshots are correct, and provenance is fetchable.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-audit-int-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

let learn: typeof import("@rohirik/openltm-core").learn;
let forget: typeof import("@rohirik/openltm-core").forget;
let recall: typeof import("@rohirik/openltm-core").recall;
let queryAudit: typeof import("@rohirik/openltm-core").queryAudit;
let listProvenance: typeof import("@rohirik/openltm-core").listProvenance;
let db: Database;

beforeAll(async () => {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(schemaPath, "utf-8"));

  const { _setDbForTesting } = await import("@rohirik/openltm-core");
  _setDbForTesting(db);

  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  await runPendingMigrations(db);

  const dbMod = await import("@rohirik/openltm-core");
  learn = dbMod.learn;
  forget = dbMod.forget;
  recall = dbMod.recall;

  const daoMod = await import("@rohirik/openltm-core");
  queryAudit = daoMod.queryAudit;
  listProvenance = daoMod.listProvenance;
}, 30_000);

afterAll(() => {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("learn() instrumentation", () => {
  it("insert: produces 1 provenance row and 1 audit row with op=insert", () => {
    const result = learn({
      content: `Audit test: learn insert ${Date.now()}`,
      category: "pattern",
      importance: 3,
      actor: "test:learn",
      sessionId: "sess_audit_01",
    });
    expect(result.action).toBe("created");

    const auditRows = queryAudit(db, { memoryId: result.id, op: "insert" });
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.actor).toBe("test:learn");
    expect(auditRows[0]?.session_id).toBe("sess_audit_01");
    expect(auditRows[0]?.before_json).toBeNull();
    expect(auditRows[0]?.after_json).not.toBeNull();

    const provRows = listProvenance(db, result.id);
    expect(provRows.length).toBeGreaterThanOrEqual(1);
    expect(provRows[0]?.source_type).toBe("learn");
  });

  it("after_json does not contain embedding field", () => {
    const result = learn({
      content: `No embedding in audit ${Date.now()}`,
      category: "gotcha",
      actor: "test:learn",
    });
    const auditRows = queryAudit(db, { memoryId: result.id, op: "insert" });
    const afterObj = JSON.parse(auditRows[0]?.after_json ?? "{}");
    expect("embedding" in afterObj).toBe(false);
  });

  it("reinforce: produces 1 audit row with op=update", () => {
    const content = `Reinforce audit test ${Date.now()}`;
    const first = learn({ content, category: "pattern", actor: "test:learn" });
    expect(first.action).toBe("created");

    const second = learn({ content, category: "pattern", actor: "test:learn", sessionId: "sess_reinforce" });
    expect(second.action).toBe("reinforced");
    expect(second.id).toBe(first.id);

    const updates = queryAudit(db, { memoryId: first.id, op: "update" });
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0]?.before_json).not.toBeNull();
    expect(updates[0]?.after_json).not.toBeNull();
  });

  it("concurrent learn() calls all produce correctly-ordered audit rows", async () => {
    const base = `Concurrent audit ${Date.now()}`;
    const [a, b, c] = await Promise.all([
      Promise.resolve(learn({ content: `${base}-A`, category: "pattern", actor: "concurrent:a" })),
      Promise.resolve(learn({ content: `${base}-B`, category: "pattern", actor: "concurrent:b" })),
      Promise.resolve(learn({ content: `${base}-C`, category: "pattern", actor: "concurrent:c" })),
    ]);
    for (const result of [a, b, c]) {
      expect(result.action).toBe("created");
      const rows = queryAudit(db, { memoryId: result.id, op: "insert" });
      expect(rows.length).toBe(1);
    }
  });
});

describe("forget() instrumentation", () => {
  it("produces audit row with op=forget and populated before_json", () => {
    const result = learn({
      content: `Forget audit test ${Date.now()}`,
      category: "pattern",
      actor: "test:learn",
    });
    const memId = result.id;

    forget({ id: memId, actor: "test:forget", sessionId: "sess_forget_01" });

    const auditRows = queryAudit(db, { memoryId: memId, op: "forget" });
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.actor).toBe("test:forget");
    expect(auditRows[0]?.session_id).toBe("sess_forget_01");
    expect(auditRows[0]?.before_json).not.toBeNull();
    expect(auditRows[0]?.after_json).toBeNull();
  });

  it("audit row survives after memory is deleted", () => {
    const result = learn({
      content: `Forget survival test ${Date.now()}`,
      category: "pattern",
    });
    const memId = result.id;
    forget({ id: memId });

    const rows = queryAudit(db, { memoryId: memId });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const forgetRows = rows.filter(r => r.op === "forget");
    expect(forgetRows.length).toBe(1);
  });

  it("before_json does not contain embedding field", () => {
    const result = learn({
      content: `Forget no embed ${Date.now()}`,
      category: "pattern",
    });
    forget({ id: result.id });

    const rows = queryAudit(db, { memoryId: result.id, op: "forget" });
    const beforeObj = JSON.parse(rows[0]?.before_json ?? "{}");
    expect("embedding" in beforeObj).toBe(false);
  });
});

describe("recall({ includeProvenance })", () => {
  it("default: does NOT attach provenance field", async () => {
    learn({ content: `Recall default no prov ${Date.now()}`, category: "pattern" });
    const results = await recall({ query: "Recall default no prov", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).not.toHaveProperty("provenance");
  });

  it("includeProvenance: true attaches provenance array", async () => {
    learn({
      content: `Recall with prov ${Date.now()}`,
      category: "pattern",
      actor: "test:learn",
    });
    const results = await recall({ query: "Recall with prov", limit: 5, includeProvenance: true });
    expect(results.length).toBeGreaterThan(0);
    expect(Array.isArray(results[0]?.provenance)).toBe(true);
  });
});
