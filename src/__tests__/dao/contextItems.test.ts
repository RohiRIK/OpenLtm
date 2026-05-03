import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

// Unique path per process+timestamp to avoid collisions when tests run in parallel
const dbPath = `/tmp/test-ltm-dao-${process.pid}-${Date.now()}.db`;
const schemaPath = join(import.meta.dir, "..", "..", "..", "src", "schema.sql");

// Deferred — imported after the DB is injected
let listByProject: typeof import("../../dao/contextItems.js").listByProject;
let appendProgress: typeof import("../../dao/contextItems.js").appendProgress;
let upsertGoal: typeof import("../../dao/contextItems.js").upsertGoal;
let addDecision: typeof import("../../dao/contextItems.js").addDecision;
let addGotcha: typeof import("../../dao/contextItems.js").addGotcha;
let writeQueue: typeof import("../../lib/writeQueue.js").writeQueue;

async function drain() {
  await writeQueue.enqueue(() => {});
}

beforeAll(async () => {
  // Create a fully-migrated test DB without touching the shared-db singleton env var.
  // This avoids the process.env.LTM_DB_PATH race when test files run concurrently.
  const { runPendingMigrations } = await import("../../migrations.js");
  const { _setDbForTesting } = await import("../../shared-db.js");

  const testDb = new Database(dbPath, { create: true });
  testDb.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  testDb.exec(readFileSync(schemaPath, "utf-8"));
  await runPendingMigrations(testDb);

  // Inject the fresh DB so all DAO functions use it
  _setDbForTesting(testDb);

  const dao = await import("../../dao/contextItems.js");
  const wq = await import("../../lib/writeQueue.js");
  listByProject = dao.listByProject;
  appendProgress = dao.appendProgress;
  upsertGoal = dao.upsertGoal;
  addDecision = dao.addDecision;
  addGotcha = dao.addGotcha;
  writeQueue = wq.writeQueue;
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

const PROJECT = "dao-test-project";

describe("listByProject", () => {
  it("returns empty array for unknown project", () => {
    const rows = listByProject("nonexistent-xyz-12345");
    expect(rows).toEqual([]);
  });

  it("filters by type when given", async () => {
    appendProgress(PROJECT, "progress entry A");
    addDecision(PROJECT, "decision entry B");
    await drain();
    const progress = listByProject(PROJECT, "progress");
    const decisions = listByProject(PROJECT, "decision");
    expect(progress.every(r => r.type === "progress")).toBe(true);
    expect(decisions.every(r => r.type === "decision")).toBe(true);
  });
});

describe("appendProgress", () => {
  const PROJ = "dao-progress-test";

  it("inserts a progress row", async () => {
    appendProgress(PROJ, "step one done");
    await drain();
    const rows = listByProject(PROJ, "progress");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some(r => r.content === "step one done")).toBe(true);
  });

  it("records session_id when provided", async () => {
    appendProgress(PROJ, "with session", "sess-abc");
    await drain();
    const rows = listByProject(PROJ, "progress");
    const row = rows.find(r => r.content === "with session");
    expect(row?.session_id).toBe("sess-abc");
  });

  it("trims to 20 most recent rows", async () => {
    const TRIM_PROJ = "dao-trim-test";
    for (let i = 0; i < 22; i++) {
      appendProgress(TRIM_PROJ, `entry-${i}`);
    }
    await drain();
    const rows = listByProject(TRIM_PROJ, "progress");
    expect(rows.length).toBeLessThanOrEqual(20);
  });
});

describe("upsertGoal", () => {
  const PROJ = "dao-goal-test";

  it("inserts a goal", async () => {
    upsertGoal(PROJ, "build the feature");
    await drain();
    const rows = listByProject(PROJ, "goal");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("build the feature");
  });

  it("replaces the existing goal", async () => {
    upsertGoal(PROJ, "new goal");
    await drain();
    const rows = listByProject(PROJ, "goal");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("new goal");
  });
});

describe("addDecision", () => {
  const PROJ = "dao-decision-test";

  it("inserts a permanent decision row", async () => {
    addDecision(PROJ, "use bun not npm");
    await drain();
    const rows = listByProject(PROJ, "decision");
    expect(rows.some(r => r.content === "use bun not npm")).toBe(true);
    const row = rows.find(r => r.content === "use bun not npm");
    expect(row?.permanent).toBe(1);
  });
});

describe("addGotcha", () => {
  const PROJ = "dao-gotcha-test";

  it("inserts a permanent gotcha row", async () => {
    addGotcha(PROJ, "embedding SELECT * is slow");
    await drain();
    const rows = listByProject(PROJ, "gotcha");
    expect(rows.some(r => r.content === "embedding SELECT * is slow")).toBe(true);
    const row = rows.find(r => r.content === "embedding SELECT * is slow");
    expect(row?.permanent).toBe(1);
  });
});
