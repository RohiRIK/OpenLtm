import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

const dbPath = `/tmp/test-opencode-ltm-${process.pid}-${Date.now()}.db`;
let prevDbPath = "";
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "..", "openltm-core", "src", "schema.sql");

beforeAll(async () => {
  const { runPendingMigrations, _setDbForTesting, configure, getConfiguredDbPath } = await import("@rohirik/openltm-core");
  // One DB for the injected handle and for core's DB_PATH (the project-name probe
  // opens DB_PATH), as in production — without leaking env into other test files.
  prevDbPath = getConfiguredDbPath();
  configure({ dbPath });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await runPendingMigrations(db);
  _setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  const { configure } = await import("@rohirik/openltm-core");
  if (prevDbPath) configure({ dbPath: prevDbPath });
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

type Part = { type: "text"; text: string };
type Tool = { name: string; input: unknown; options?: { codemode?: boolean }; execute(input: unknown, ctx?: unknown): Promise<{ content?: string; output?: unknown }> };

/** Runs the plugin's setup against a stand-in V2 context and captures what it registers. */
async function load(directory: string) {
  const { default: plugin } = await import("../index.js");
  const tools: Tool[] = [];
  const hooks = new Map<string, (event: { system: Part[] }) => Promise<void> | void>();
  const registration = { dispose: async () => {} };
  const ctx = {
    location: { directory, project: { id: "p", directory, canonical: directory } },
    tool: { transform: async (cb: (editor: { add(t: Tool): void }) => void) => { cb({ add: t => tools.push(t) }); return registration; } },
    session: { hook: async (name: string, cb: (event: { system: Part[] }) => Promise<void> | void) => { hooks.set(name, cb); return registration; } },
  };
  await plugin.setup(ctx as never);
  const run = async (name: "context" | "compaction") => {
    const event = { system: [] as Part[] };
    await hooks.get(name)!(event);
    return event.system;
  };
  const call = async (name: string, input: unknown) => {
    const result = await tools.find(t => t.name === name)!.execute(input, {});
    return JSON.parse(result.content!);
  };
  return { plugin, tools, hooks, run, call };
}

describe("OpenCode LTM plugin — V2 module", () => {
  it("default-exports { id, setup } as OpenCode V2 requires", async () => {
    const { default: plugin } = await import("../index.js");
    expect(plugin.id).toBe("openltm");
    expect(typeof plugin.setup).toBe("function");
  });

  it("adds the 5 tools as direct (non code-mode) JSON Schema tools", async () => {
    const { tools } = await load("/tmp/test-project");
    expect(tools.map(t => t.name).sort()).toEqual(["ltm_context", "ltm_forget", "ltm_learn", "ltm_recall", "ltm_relate"]);
    for (const t of tools) {
      expect((t.input as { type: string }).type).toBe("object");
      expect(t.options?.codemode).toBe(false);
    }
  });

  it("registers the context and compaction session hooks", async () => {
    const { hooks } = await load("/tmp/test-project");
    expect([...hooks.keys()].sort()).toEqual(["compaction", "context"]);
  });

  it("tool results carry content only (the host rejects output without an output schema)", async () => {
    const { tools } = await load("/tmp/test-project");
    const result = await tools.find(t => t.name === "ltm_recall")!.execute({ query: "anything" }, {});
    expect(typeof result.content).toBe("string");
    expect("output" in result).toBe(false);
  });
});

describe("context hook — injects Prior Knowledge block", () => {
  it("appends a text part when memories exist", async () => {
    const { learn } = await import("@rohirik/openltm-core");
    learn({ content: "Use bun not npm", category: "preference", importance: 3, project_scope: "test-opencode-proj", skipExport: true });

    const { run } = await load("/tmp/test-opencode-proj");
    const system = await run("context");
    expect(system.length).toBeGreaterThan(0);
    expect(system[0]!.type).toBe("text");
    expect(system.some(p => p.text.includes("Prior Knowledge"))).toBe(true);
  });

  it("appends nothing when no memories exist for project", async () => {
    const { run } = await load("/tmp/empty-project-xyz");
    expect((await run("context")).length).toBe(0);
  });
});

describe("ltm_learn tool roundtrip", () => {
  it("stores memory and recalls it", async () => {
    const { call } = await load("/tmp/roundtrip");
    const result = await call("ltm_learn", { content: "OpenCode adapter roundtrip test memory", category: "pattern", importance: 3 }) as { id: number; action: string; category: string };
    expect(result.id).toBeGreaterThan(0);
    expect(result.action).toBe("created");
    expect(result.category).toBe("pattern");

    const memories = await call("ltm_recall", { query: "OpenCode adapter roundtrip" }) as Array<{ id: number }>;
    expect(memories.some(m => m.id === result.id)).toBe(true);
  });

  it("auto-detects the category when it is omitted", async () => {
    const { call } = await load("/tmp/roundtrip");
    const result = await call("ltm_learn", { content: "Gotcha: the V2 host rejects tool output without an output schema" }) as { id: number; category: string };
    expect(result.id).toBeGreaterThan(0);
    expect(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]).toContain(result.category);
  });
});

describe("egress scrub — legacy raw rows never reach the prompt", () => {
  const KEY = "AKIAIOSFODNN7EXAMPLE";
  const project = "test-opencode-leak-proj";

  async function plantLegacyRow(): Promise<void> {
    const { learn, getDb } = await import("@rohirik/openltm-core");
    const res = learn({ content: "Legacy deploy note placeholder", category: "gotcha", importance: 4, project_scope: project, skipExport: true });
    const id = (res as { id: number }).id;
    // Simulate a row stored before write-time scrubbing existed.
    getDb().run("UPDATE memories SET content = ? WHERE id = ?", [`Legacy deploy note uses ${KEY}`, id]);
  }

  it("context prefill redacts a planted key", async () => {
    await plantLegacyRow();
    const { run } = await load(`/tmp/${project}`);
    const text = (await run("context")).map(p => p.text).join("\n");
    expect(text).toContain("Legacy deploy note");
    expect(text).not.toContain(KEY);
  });

  it("compaction redacts a planted key", async () => {
    const { run } = await load(`/tmp/${project}`);
    const text = (await run("compaction")).map(p => p.text).join("\n");
    expect(text).toContain("Legacy deploy note");
    expect(text).not.toContain(KEY);
  });

  it("ltm_recall and ltm_context tool output redact a planted key", async () => {
    const { tools } = await load(`/tmp/${project}`);
    const recall = await tools.find(t => t.name === "ltm_recall")!.execute({ query: "Legacy", project });
    expect(recall.content).toContain("Legacy deploy note");
    expect(recall.content).not.toContain(KEY);
    const ctx = await tools.find(t => t.name === "ltm_context")!.execute({ project });
    expect(ctx.content).not.toContain(KEY);
  });
});
