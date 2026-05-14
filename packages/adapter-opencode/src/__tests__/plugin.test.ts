import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

const dbPath = `/tmp/test-opencode-ltm-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "..", "ltm-core", "src", "schema.sql");

beforeAll(async () => {
  const { runPendingMigrations, _setDbForTesting } = await import("@rohirik/ltm-core");
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

describe("OpenCode LTM plugin — server()", () => {
  it("returns tool array with 5 expected tools", async () => {
    const { plugin } = await import("../index.js");
    const hooks = await plugin.server({
      project: { path: "/tmp/test-project", name: "test-project" },
      sessionID: "test-session-1",
    });

    expect(Array.isArray(hooks.tool)).toBe(true);
    const toolNames = (hooks.tool ?? []).map(t => t.name);
    expect(toolNames).toContain("ltm_recall");
    expect(toolNames).toContain("ltm_learn");
    expect(toolNames).toContain("ltm_forget");
    expect(toolNames).toContain("ltm_relate");
    expect(toolNames).toContain("ltm_context");
  });

  it("has experimental.chat.system.transform hook", async () => {
    const { plugin } = await import("../index.js");
    const hooks = await plugin.server({
      project: { path: "/tmp/test-project" },
      sessionID: "test-session-2",
    });
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");
  });

  it("has experimental.session.compacting hook", async () => {
    const { plugin } = await import("../index.js");
    const hooks = await plugin.server({
      project: { path: "/tmp/test-project" },
      sessionID: "test-session-3",
    });
    expect(typeof hooks["experimental.session.compacting"]).toBe("function");
  });
});

describe("system.transform — injects Prior Knowledge block", () => {
  it("appends Prior Knowledge block when memories exist", async () => {
    const { learn } = await import("@rohirik/ltm-core");
    learn({ content: "Use bun not npm", category: "preference", importance: 3, project_scope: "test-opencode-proj", skipExport: true });

    const { plugin } = await import("../index.js");
    const hooks = await plugin.server({
      project: { path: "/tmp/test-project", name: "test-opencode-proj" },
      sessionID: "test-session-4",
    });

    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s4", model: "claude-3" }, output);

    expect(output.system.length).toBeGreaterThan(0);
    expect(output.system.some(s => s.includes("Prior Knowledge"))).toBe(true);
  });

  it("does not append block when no memories exist for project", async () => {
    const { plugin } = await import("../index.js");
    const hooks = await plugin.server({
      project: { path: "/tmp/empty-project", name: "empty-project-xyz" },
      sessionID: "test-session-5",
    });

    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s5", model: "claude-3" }, output);

    expect(output.system.length).toBe(0);
  });
});

describe("ltm_learn tool roundtrip", () => {
  it("stores memory and recalls it", async () => {
    const { plugin } = await import("../index.js");
    const hooks = await plugin.server({
      project: { path: "/tmp/roundtrip-project", name: "roundtrip" },
      sessionID: "test-session-6",
    });

    const learnTool = (hooks.tool ?? []).find(t => t.name === "ltm_learn")!;
    const recallTool = (hooks.tool ?? []).find(t => t.name === "ltm_recall")!;

    const result = await learnTool.execute({
      content: "OpenCode adapter roundtrip test memory",
      category: "pattern",
      importance: 3,
    }) as { id: number; action: string };

    expect(result.id).toBeGreaterThan(0);
    expect(result.action).toBe("created");

    const memories = await recallTool.execute({
      query: "OpenCode adapter roundtrip",
    }) as Array<{ id: number; content: string }>;

    expect(memories.some(m => m.id === result.id)).toBe(true);
  });
});
