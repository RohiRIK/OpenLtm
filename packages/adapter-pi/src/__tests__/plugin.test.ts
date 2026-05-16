import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

const dbPath = `/tmp/test-pi-ltm-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "..", "ltm-core", "src", "schema.sql");

function createMockPi() {
  const tools: Array<{
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }> = [];
  const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  return {
    tools,
    handlers,
    registerTool(def: typeof tools[0]) { tools.push(def); },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]!.push(handler);
    },
  };
}

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

describe("Pi LTM extension — registerTools()", () => {
  it("registers exactly 3 tools", async () => {
    const { registerTools } = await import("../tools.js");
    const pi = createMockPi();
    registerTools(pi);
    expect(pi.tools).toHaveLength(3);
  });

  it("registers ltm_recall, ltm_learn, ltm_forget", async () => {
    const { registerTools } = await import("../tools.js");
    const pi = createMockPi();
    registerTools(pi);
    const names = pi.tools.map(t => t.name);
    expect(names).toContain("ltm_recall");
    expect(names).toContain("ltm_learn");
    expect(names).toContain("ltm_forget");
  });

  it("tools have label and description", async () => {
    const { registerTools } = await import("../tools.js");
    const pi = createMockPi();
    registerTools(pi);
    for (const tool of pi.tools) {
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });
});

describe("Pi LTM extension — registerHooks()", () => {
  it("registers before_agent_start and session_compact hooks", async () => {
    const { registerHooks } = await import("../hooks.js");
    const pi = createMockPi();
    registerHooks(pi);
    expect(pi.handlers["before_agent_start"]?.length).toBeGreaterThan(0);
    expect(pi.handlers["session_compact"]?.length).toBeGreaterThan(0);
  });

  it("before_agent_start returns systemPrompt with Prior Knowledge when memories exist", async () => {
    const { learn } = await import("@rohirik/ltm-core");
    learn({
      content: "Pi test memory — use strict types",
      category: "pattern",
      importance: 3,
      project_scope: "pi-test-proj",
      skipExport: true,
    });

    const { registerHooks } = await import("../hooks.js");
    const pi = createMockPi();
    registerHooks(pi);

    const result = await pi.handlers["before_agent_start"]![0]!({
      cwd: "/tmp/pi-test-proj",
      systemPrompt: "",
    }) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain("Prior Knowledge");
  });

  it("before_agent_start returns undefined when no memories for project", async () => {
    const { registerHooks } = await import("../hooks.js");
    const pi = createMockPi();
    registerHooks(pi);

    const result = await pi.handlers["before_agent_start"]![0]!({
      cwd: "/tmp/empty-pi-project-xyz-no-memories",
      systemPrompt: "",
    });

    expect(result).toBeUndefined();
  });
});

describe("ltm_learn / ltm_recall roundtrip via Pi tools", () => {
  it("stores and retrieves a memory", async () => {
    const { registerTools } = await import("../tools.js");
    const pi = createMockPi();
    registerTools(pi);

    const learnTool = pi.tools.find(t => t.name === "ltm_learn")!;
    const recallTool = pi.tools.find(t => t.name === "ltm_recall")!;

    const learnResult = await learnTool.execute("call-1", {
      content: "Pi roundtrip test — always verify types",
      category: "gotcha",
      importance: 4,
    }) as { content: Array<{ type: string; text: string }> };

    const learned = JSON.parse(learnResult.content[0]!.text) as { id: number; action: string };
    expect(learned.id).toBeGreaterThan(0);
    expect(learned.action).toBe("created");

    const recallResult = await recallTool.execute("call-2", {
      query: "Pi roundtrip verify types",
    }) as { content: Array<{ type: string; text: string }> };

    const memories = JSON.parse(recallResult.content[0]!.text) as Array<{ id: number }>;
    expect(memories.some(m => m.id === learned.id)).toBe(true);
  });
});
