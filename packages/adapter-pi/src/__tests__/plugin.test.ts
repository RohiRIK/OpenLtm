/**
 * Pi extension — the real entry point (src/index.ts, what dist/index.js is built
 * from), driven with a stub Pi host. It bridges to a real `mcp-serve` child over
 * stdio against a temp DB, exactly as Pi runs it. (The old tests exercised
 * hooks.ts/tools.ts, which Pi never loaded.)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Tool = { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> };
type Handler = (event: unknown) => Promise<unknown> | unknown;

function createStubPi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, Handler>();
  return {
    tools,
    handlers,
    registerTool(def: Tool) { tools.set(def.name, def); },
    on(event: string, handler: Handler) { handlers.set(event, handler); },
  };
}

async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for the MCP bridge");
    await Bun.sleep(50);
  }
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map((c) => c.text).join("\n");

describe("Pi extension (real entry point over the MCP bridge)", () => {
  const root = mkdtempSync(join(tmpdir(), "ltm-pi-"));
  // Under Bun (this runner) node:sqlite is unavailable, so the legacy-name check
  // cannot run and keeps the raw folder name; use one that is already normalized.
  // Mixed-case unification is exercised under real Node in scripts/qa/adapters-smoke.ts.
  const cwd = join(root, "code", "pi-demo");
  const saved = { LTM_DB_PATH: process.env.LTM_DB_PATH, CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA };
  const pi = createStubPi();

  beforeAll(async () => {
    mkdirSync(join(cwd, ".git"), { recursive: true });
    process.env.LTM_DB_PATH = join(root, "openltm.db");
    delete process.env.CLAUDE_PLUGIN_DATA;
    const { default: ltmExtension } = await import("../index.js");
    ltmExtension(pi);
    await until(() => pi.tools.has("learn") && pi.tools.has("context_add"));
  }, 30_000);

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(root, { recursive: true, force: true });
  });

  it("registers every MCP tool and hooks before_agent_start + session_compact", () => {
    for (const name of ["recall", "get", "learn", "context", "context_items", "context_add", "proposals"]) {
      expect(pi.tools.has(name)).toBe(true);
    }
    expect(pi.handlers.has("before_agent_start")).toBe(true);
    expect(pi.handlers.has("session_compact")).toBe(true);
  });

  it("learn → before_agent_start injects it for the project resolved from cwd", async () => {
    const learned = JSON.parse(text(await pi.tools.get("learn")!.execute("t1", {
      content: "Pi demo: deploys go through the blue/green switch, never in place", category: "workflow", importance: 3, project: "pi-demo",
    }))) as { id: number };
    const res = (await pi.handlers.get("before_agent_start")!({ cwd, systemPrompt: "BASE" })) as { systemPrompt: string };
    expect(res.systemPrompt.startsWith("BASE\n\n## Prior Knowledge (LTM)")).toBe(true);
    expect(res.systemPrompt).toContain(`Project (pi-demo):`);
    expect(res.systemPrompt).toContain(`[${learned.id}] Pi demo: deploys go through the blue/green switch`);
  }, 30_000);

  it("session_compact records the summary as project progress via context_add", async () => {
    const summary = "Compacted session: wired the blue/green deploy switch and documented the rollback steps for the demo service.";
    await pi.handlers.get("session_compact")!({ cwd, summary });
    const items = text(await pi.tools.get("context_items")!.execute("t2", { project: "pi-demo", type: "progress" }));
    expect(items).toContain("Compacted: Compacted session: wired the blue/green deploy switch");
  }, 30_000);

  it("ignores short compaction summaries", async () => {
    await pi.handlers.get("session_compact")!({ cwd, summary: "too short" });
    const items = text(await pi.tools.get("context_items")!.execute("t3", { project: "pi-demo", type: "progress" }));
    expect(items).not.toContain("too short");
  }, 30_000);
});
