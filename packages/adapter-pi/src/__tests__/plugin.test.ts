import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import type { PiExtensionAPI, PiToolDefinition } from "@earendil-works/pi-ai";

const dbPath = `/tmp/test-pi-ltm-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "..", "ltm-core", "src", "schema.sql");

// Mock Pi API
function createMockPi(): PiExtensionAPI & { tools: PiToolDefinition[]; handlers: Record<string, Function[]> } {
  const tools: PiToolDefinition[] = [];
  const handlers: Record<string, Function[]> = {};
  return {
    tools,
    handlers,
    registerTool(def) { tools.push(def); },
    on(event, handler) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]!.push(handler as Function);
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
});

describe("Pi LTM extension — registerHooks()", () => {
  it("registers session:start and compact hooks", async () => {
    const { registerHooks } = await import("../hooks.js");
    const pi = createMockPi();
    registerHooks(pi);
    expect(pi.handlers["session:start"]?.length).toBeGreaterThan(0);
    expect(pi.handlers["compact"]?.length).toBeGreaterThan(0);
  });

  it("session:start injects Prior Knowledge block when memories exist", async () => {
    const { learn } = await import("@rohirik/ltm-core");
    learn({ content: "Pi test memory — use strict types", category: "pattern", importance: 3, project_scope: "pi-test-proj", skipExport: true });

    const { registerHooks } = await import("../hooks.js");
    const pi = createMockPi();
    registerHooks(pi);

    const appended: string[] = [];
    const ctx = {
      cwd: "/tmp/pi-test-proj",
      sessionID: "pi-test-session-1",
      appendToSystemPrompt: (block: string) => { appended.push(block); },
    };

    await pi.handlers["session:start"]![0]!(ctx);

    expect(appended.length).toBeGreaterThan(0);
    expect(appended.some(b => b.includes("Prior Knowledge"))).toBe(true);
  });

  it("session:start does not inject when no memories for project", async () => {
    const { registerHooks } = await import("../hooks.js");
    const pi = createMockPi();
    registerHooks(pi);

    const appended: string[] = [];
    const ctx = {
      cwd: "/tmp/empty-pi-project",
      sessionID: "pi-test-session-2",
      appendToSystemPrompt: (block: string) => { appended.push(block); },
    };

    await pi.handlers["session:start"]![0]!(ctx);

    expect(appended.length).toBe(0);
  });
});

describe("ltm_learn / ltm_recall roundtrip via Pi tools", () => {
  it("stores and retrieves a memory", async () => {
    const { registerTools } = await import("../tools.js");
    const pi = createMockPi();
    registerTools(pi);

    const learnTool = pi.tools.find(t => t.name === "ltm_learn")!;
    const recallTool = pi.tools.find(t => t.name === "ltm_recall")!;

    const result = await learnTool.handler({
      content: "Pi roundtrip test — always verify types",
      category: "gotcha",
      importance: 4,
    }) as { id: number; action: string };

    expect(result.id).toBeGreaterThan(0);
    expect(result.action).toBe("created");

    const memories = await recallTool.handler({
      query: "Pi roundtrip verify types",
    }) as Array<{ id: number; content: string }>;

    expect(memories.some(m => m.id === result.id)).toBe(true);
  });
});
