import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-prefill-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

beforeAll(async () => {
  const { runPendingMigrations, _setDbForTesting } = await import("../index.js");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await runPendingMigrations(db);
  _setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("prefill helpers", () => {
  it("returns empty output when no memories exist", async () => {
    const { buildPrefillContext } = await import("../index.js");
    expect(buildPrefillContext({ project: "empty-prefill-project", maxMemories: 4 })).toBe("");
  });

  it("builds a compact shared prefill block from globals + project memories", async () => {
    const { buildPrefillContext, deriveProjectFromCwd, learn } = await import("../index.js");

    learn({
      content: "Global guardrail — prefer Bun commands in this repo",
      category: "workflow",
      importance: 4,
      skipExport: true,
    });
    learn({
      content: "Project decision — adapter hooks should use the shared prefill builder",
      category: "architecture",
      importance: 3,
      project_scope: "prefill-project",
      skipExport: true,
    });

    expect(deriveProjectFromCwd("/tmp/prefill-project")).toBe("prefill-project");

    const block = buildPrefillContext({ project: "prefill-project", maxMemories: 6, maxLines: 18 });
    expect(block).toContain("## Prior Knowledge (LTM)");
    expect(block).toContain("Global:");
    expect(block).toContain("Project (prefill-project):");
    expect(block).toContain("prefer Bun commands");
    expect(block).toContain("shared prefill builder");
  });
});

describe("prefill injectTopN regression", () => {
  it("selectPrefillMemories respects maxMemories (injectTopN stand-in)", async () => {
    const { learn, selectPrefillMemories } = await import("../index.js");
    const project = `inject-topn-${Date.now()}`;
    for (let i = 0; i < 8; i++) {
      learn({
        content: `Prefill inject regression memory ${i} for ${project}`,
        category: "pattern",
        importance: 3,
        project_scope: project,
        skipExport: true,
      });
    }
    const { scoped, globals, report } = selectPrefillMemories(project, { maxMemories: 3 });
    expect(scoped.length + globals.length).toBeLessThanOrEqual(3);
    expect(report.selected).toBeLessThanOrEqual(3);
  });
});
