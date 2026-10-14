import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-supersede-ux-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

let core: typeof import("../index.js");
let supersedes: typeof import("../janitor/supersedes.js");
let db: Database;

beforeAll(async () => {
  core = await import("../index.js");
  supersedes = await import("../janitor/supersedes.js");
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

  it("listStagedConflicts(limit, project): both memories must be that project or global", () => {
    const mk = (content: string, scope: string | null) => Number(db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key, project_scope)
       VALUES (?, 'architecture', 3, 1, 'active', ?, ?)`, [content, `ux-p-${content}-${Date.now()}`, scope],
    ).lastInsertRowid);
    const [a1, a2] = [mk("alpha uses kafka", "alpha"), mk("alpha uses nats", "alpha")];
    const [b1, b2] = [mk("beta uses redis", "beta"), mk("beta uses memcached", "beta")];
    const [g1, b3] = [mk("prefer tabs", null), mk("beta prefers spaces", "beta")];
    const [g2, a3] = [mk("prefer semicolons", null), mk("alpha drops semicolons", "alpha")];
    const [g3, g4] = [mk("global uses yaml", null), mk("global uses toml", null)];
    core.stageContradictions([
      { olderId: a1, olderContent: "kafka", newerId: a2, newerContent: "nats", term: "kafka vs nats" },
      { olderId: b1, olderContent: "redis", newerId: b2, newerContent: "memcached", term: "redis vs memcached" },
      { olderId: g1, olderContent: "tabs", newerId: b3, newerContent: "spaces", term: "tabs vs spaces" },
      { olderId: g2, olderContent: "semi", newerId: a3, newerContent: "nosemi", term: "semi" },
      { olderId: g3, olderContent: "yaml", newerId: g4, newerContent: "toml", term: "yaml vs toml" },
    ]);
    const forAlpha = core.listStagedConflicts(50, "alpha").map((s) => s.olderId);
    expect(forAlpha).toContain(a1);   // alpha + alpha
    expect(forAlpha).toContain(g2);   // global + alpha
    expect(forAlpha).toContain(g3);   // global + global
    expect(forAlpha).not.toContain(g1); // global + beta must NOT show in alpha's banner
    expect(forAlpha).not.toContain(b1);
    expect(core.listStagedConflicts(50).map((s) => s.olderId)).toContain(b1);
  });

  // The SessionStart banner is asserted on real hook output in src/__tests__/hooks/sessionstart-compact.test.ts.
});

describe("atomic accept + resolve guards", () => {
  function mem(label: string): number {
    return Number(db.run(
      `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
       VALUES (?, 'architecture', 3, 1, 'active', ?)`,
      [label, `atomic-${label}-${Math.random()}`],
    ).lastInsertRowid);
  }
  function stage(older: number, newer: number): number {
    core.stageContradictions([{ olderId: older, olderContent: "a", newerId: newer, newerContent: "b", term: "npm vs bun" }]);
    return db.query<{ id: number }, [number, number]>(
      "SELECT id FROM memory_conflict_staging WHERE older_id=? AND newer_id=?",
    ).get(older, newer)!.id;
  }
  const status = (id: number) =>
    db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id=?").get(id)!.status;
  const stagingStatus = (id: number) =>
    db.query<{ status: string }, [number]>("SELECT status FROM memory_conflict_staging WHERE id=?").get(id)!.status;

  it("failure mid-accept rolls back: memory still active, row still pending", () => {
    const older = mem("mid-fail old"), newer = mem("mid-fail new");
    const sid = stage(older, newer);
    supersedes._forceAcceptFailForTesting(true);
    try {
      expect(() => core.acceptStagedConflict(sid)).toThrow();
    } finally {
      supersedes._forceAcceptFailForTesting(false);
    }
    expect(status(older)).toBe("active");
    expect(stagingStatus(sid)).toBe("pending");
    const rel = db.query<{ c: number }, [number, number]>(
      "SELECT COUNT(*) c FROM memory_relations WHERE source_memory_id=? AND target_memory_id=?",
    ).get(newer, older)!;
    expect(rel.c).toBe(0);
  });

  it("accept on an inactive memory returns false and marks the row stale (not pending forever)", () => {
    const older = mem("deprecated old"), newer = mem("deprecated new");
    const sid = stage(older, newer);
    db.run("UPDATE memories SET status='deprecated' WHERE id=?", [older]);
    expect(core.acceptStagedConflict(sid)).toBe(false);
    expect(stagingStatus(sid)).toBe("stale");
    expect(status(older)).toBe("deprecated");
    expect(status(newer)).toBe("active");
    expect(core.listStagedConflicts(500).some((s) => s.id === sid)).toBe(false);
    expect(core.acceptStagedConflict(sid)).toBe(false);
  });

  it("test hook is not part of the public index export", () => {
    expect((core as Record<string, unknown>)._forceAcceptFailForTesting).toBeUndefined();
  });

  it("unknown id: accept/reject/coexist all return false", () => {
    expect(core.acceptStagedConflict(999_999)).toBe(false);
    expect(core.rejectStagedConflict(999_999)).toBe(false);
    expect(core.coexistStagedConflict(999_999)).toBe(false);
  });

  it("coexist keeps both memories active", () => {
    const older = mem("coexist old"), newer = mem("coexist new");
    const sid = stage(older, newer);
    expect(core.coexistStagedConflict(sid)).toBe(true);
    expect(status(older)).toBe("active");
    expect(status(newer)).toBe("active");
    expect(stagingStatus(sid)).toBe("coexist");
  });

  it("double-resolve: second call of any action returns false", () => {
    const older = mem("double old"), newer = mem("double new");
    const sid = stage(older, newer);
    expect(core.acceptStagedConflict(sid)).toBe(true);
    expect(core.acceptStagedConflict(sid)).toBe(false);
    expect(core.rejectStagedConflict(sid)).toBe(false);
    expect(core.coexistStagedConflict(sid)).toBe(false);
    expect(stagingStatus(sid)).toBe("accepted");
  });

  it("SessionStart banner addresses the user, not the agent", () => {
    const src = readFileSync(join(import.meta.dir, "../../../../hooks/src/SessionStart.ts"), "utf-8");
    expect(src).toContain("awaiting your review");
    expect(src).not.toContain("ltm conflict accept|reject");
  });
});
