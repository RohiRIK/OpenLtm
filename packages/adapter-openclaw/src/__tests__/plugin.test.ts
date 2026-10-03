/**
 * Tests for the OpenClaw adapter.
 *
 * OpenClaw runs on Node and core is Bun code, so the adapter deliberately does
 * not import `@rohirik/openltm-core` — it spawns the core MCP server as a Bun
 * child and speaks JSON-RPC over stdio. These tests exercise the real bridge
 * against a real database, and stub only the host API.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openclaw-ltm-${process.pid}-${Date.now()}.db`;
const PKG_DIR = join(import.meta.dir, "..", "..");
const MANIFEST_PATH = join(PKG_DIR, "openclaw.plugin.json");

mock.module("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (options: unknown) => options,
}));

type Tool = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
};

interface FakeApi {
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  pluginConfig: unknown;
  registerTool: (tool: Tool) => void;
  registerMemoryPromptSupplement: (b: () => string[]) => void;
  registerMemoryPromptPreparation?: (p: () => Promise<readonly string[]>) => void;
  tools: Tool[];
  supplements: Array<() => string[]>;
  preparations: Array<() => Promise<readonly string[]>>;
}

/** `withPreparation: false` models hosts older than 2026.9.8 (sync supplement only). */
function createFakeApi(pluginConfig: unknown = {}, withPreparation = true): FakeApi {
  const api: FakeApi = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    pluginConfig,
    tools: [],
    supplements: [],
    preparations: [],
    registerTool(tool: Tool) {
      api.tools.push(tool);
    },
    registerMemoryPromptSupplement(builder) {
      api.supplements.push(builder);
    },
  };
  if (withPreparation) {
    api.registerMemoryPromptPreparation = (prepare) => {
      api.preparations.push(prepare);
    };
  }
  return api;
}

async function register(pluginConfig: unknown = {}, withPreparation = true) {
  const { default: entry } = (await import("../index.js")) as never as {
    default: { register: (api: FakeApi) => void };
  };
  const api = createFakeApi(pluginConfig, withPreparation);
  entry.register(api);
  return api;
}

const text = async (tool: Tool, id: string, params: Record<string, unknown>) =>
  (await tool.execute(id, params)).content[0]!.text;

beforeAll(() => {
  // Deliberately NOT pre-created or migrated: a first-time OpenClaw user has no
  // database, and the bridge must bring one up fully migrated before serving.
  // Pre-seeding here is what hid "no such column: decay_score" in 2.15.1.
  process.env["LTM_DB_PATH"] = dbPath;
});

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
  delete process.env["LTM_DB_PATH"];
});

describe("OpenClaw adapter — registration", () => {
  it("registers the eight OpenLTM tools", async () => {
    const api = await register();
    expect(api.tools.map((t) => t.name).sort()).toEqual([
      "openltm_brain_stats",
      "openltm_context",
      "openltm_forget",
      "openltm_graph",
      "openltm_learn",
      "openltm_recall",
      "openltm_relate",
      "openltm_stale",
    ]);
  });

  it("gives every tool a label and a usable description", async () => {
    const api = await register();
    for (const tool of api.tools) {
      expect(tool.label).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("declares exactly the tools it registers in the manifest", async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const api = await register();
    expect([...manifest.contracts.tools].sort()).toEqual(api.tools.map((t) => t.name).sort());
  });

  it("never resolves a core subpath that core's exports map hides from Node", () => {
    // Bun ignores `exports` for this lookup; Node throws ERR_PACKAGE_PATH_NOT_EXPORTED.
    // This passed every Bun test and broke every real OpenClaw install (2.15.1).
    const source = readFileSync(join(PKG_DIR, "src", "index.ts"), "utf-8");
    expect(source).not.toMatch(/resolve\(\s*["']@rohirik\/openltm-core\/package\.json/);
  });

  it("does not import the Bun-only core package at module load", () => {
    // The whole point of the bridge: a static import of core would make the
    // plugin unloadable under Node with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const source = readFileSync(join(PKG_DIR, "src", "index.ts"), "utf-8");
    const staticImports = source
      .split("\n")
      .filter((line) => /^\s*import\s[^;]*from\s+["']@rohirik\/openltm-core/.test(line));
    expect(staticImports).toEqual([]);
  });
});

describe("OpenClaw adapter — behaviour over the real bridge", () => {
  it("learn, then recall the same fact", async () => {
    const api = await register();
    const learn = api.tools.find((t) => t.name === "openltm_learn")!;
    const recall = api.tools.find((t) => t.name === "openltm_recall")!;

    const learned = await text(learn, "t1", {
      content: "OpenClaw bridge probe — always pin the host version before shipping a plugin",
      category: "constraint",
      importance: 4,
    });
    expect(learned).not.toContain("unavailable");

    const recalled = await text(recall, "t2", { query: "pin the host version" });
    expect(recalled).toContain("pin the host version");
  });

  it("reports a friendly error instead of throwing when the engine is missing", async () => {
    const api = await register();
    const forget = api.tools.find((t) => t.name === "openltm_forget")!;
    const out = await text(forget, "t3", { id: 999_999 });
    // Either the bridge is healthy and reports "not found", or it explains why
    // it is unavailable. Both are graceful text, never a thrown error.
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("lists stale memories without throwing", async () => {
    const api = await register();
    const stale = api.tools.find((t) => t.name === "openltm_stale")!;
    const out = await text(stale, "t4", { action: "list" });
    expect(out).not.toContain("unavailable");
  });

  it("context returns a tool result, not a bare string", async () => {
    const api = await register();
    const context = api.tools.find((t) => t.name === "openltm_context")!;
    const out = await context.execute("t5", { project: "openclaw-ltm" });
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content[0]!.text).not.toContain("unavailable");
  });

  it("auto-recall injects a Prior Knowledge block through the async preparation", async () => {
    const api = await register();
    expect(api.preparations).toHaveLength(1);
    expect(api.supplements).toHaveLength(0);
    const lines = await api.preparations[0]!();
    expect(lines[0]).toBe("## Prior Knowledge (LTM)");
    expect(lines.join("\n")).toContain("pin the host version");
  });

  it("auto-recall respects the line budget", async () => {
    const api = await register({ prefillLines: 4 });
    expect((await api.preparations[0]!()).length).toBeLessThanOrEqual(4);
  });

  it("auto-recall falls back to a cached synchronous supplement on older hosts", async () => {
    const api = await register({}, false);
    expect(api.supplements).toHaveLength(1);
    expect(api.supplements[0]!()).toEqual([]); // first turn: nothing cached yet
    for (let i = 0; i < 50 && api.supplements[0]!().length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(api.supplements[0]!()[0]).toBe("## Prior Knowledge (LTM)");
  });

  it("auto-recall yields nothing when disabled", async () => {
    const api = await register({ autoRecall: false });
    expect(await api.preparations[0]!()).toEqual([]);
    const legacy = await register({ autoRecall: false }, false);
    expect(legacy.supplements[0]!()).toEqual([]);
  });
});
