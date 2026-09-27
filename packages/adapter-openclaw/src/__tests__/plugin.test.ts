/**
 * Tests for the OpenClaw adapter.
 *
 * The host SDK is not installable here (`openclaw` is an optional peer that the
 * host provides), so these tests drive the plugin's `register()` against a fake
 * API and assert on what it registers. That is the part we own and can verify;
 * the host's own loading of the manifest is checked separately by
 * `bun run check:openclaw`.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openclaw-ltm-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "..", "openltm-core", "src", "schema.sql");
const PKG_DIR = join(import.meta.dir, "..", "..");
const MANIFEST_PATH = join(PKG_DIR, "openclaw.plugin.json");

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
  registerMemoryPromptSupplement: (b: (p: { availableTools: Set<string> }) => string[]) => void;
  tools: Tool[];
  supplements: Array<(p: { availableTools: Set<string> }) => string[]>;
}

function createFakeApi(pluginConfig: unknown = {}): FakeApi {
  const api: FakeApi = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    pluginConfig,
    tools: [],
    supplements: [],
    registerTool(tool: Tool) {
      api.tools.push(tool);
    },
    registerMemoryPromptSupplement(builder) {
      api.supplements.push(builder);
    },
  };
  return api;
}

/**
 * The host SDK is provided by OpenClaw at runtime and is not installable here
 * (`openclaw` is an optional peer dependency). Stub it before importing the
 * entry so the plugin's own registration logic is what gets tested.
 */
mock.module("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (options: unknown) => options,
}));

async function loadEntry(): Promise<{ default: { register: (api: FakeApi) => void } }> {
  return (await import("../index.js")) as never;
}

beforeAll(async () => {
  const { runPendingMigrations, _setDbForTesting } = await import("@rohirik/openltm-core");
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

describe("OpenClaw adapter — registration", () => {
  it("registers the eight OpenLTM tools", async () => {
    const entry = await loadEntry();
    const api = createFakeApi();
    entry.default.register(api);

    const names = api.tools.map((t) => t.name).sort();
    expect(names).toEqual([
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

  it("gives every tool a label and a WHEN-style description", async () => {
    const entry = await loadEntry();
    const api = createFakeApi();
    entry.default.register(api);
    for (const tool of api.tools) {
      expect(tool.label).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("declares exactly the tools it registers in the manifest", async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const entry = await loadEntry();
    const api = createFakeApi();
    entry.default.register(api);

    const registered = api.tools.map((t) => t.name).sort();
    expect([...manifest.contracts.tools].sort()).toEqual(registered);
  });

  it("registers a prompt supplement for auto-recall", async () => {
    const entry = await loadEntry();
    const api = createFakeApi();
    entry.default.register(api);
    expect(api.supplements).toHaveLength(1);
  });
});

describe("OpenClaw adapter — behaviour", () => {
  async function register(pluginConfig: unknown = {}) {
    const entry = await loadEntry();
    const api = createFakeApi(pluginConfig);
    entry.default.register(api);
    return api;
  }

  it("learn and recall round-trip through the registered tools", async () => {
    const api = await register();
    const learn = api.tools.find((t) => t.name === "openltm_learn")!;
    const recall = api.tools.find((t) => t.name === "openltm_recall")!;

    const learned = JSON.parse(
      (await learn.execute("c1", { content: "OpenClaw adapter roundtrip — always pin host versions", category: "constraint", importance: 4 })).content[0]!.text,
    );
    expect(learned.action).toBe("created");

    const recalled = JSON.parse(
      (await recall.execute("c2", { query: "pin host versions" })).content[0]!.text,
    );
    expect(recalled.some((m: { id: number }) => m.id === learned.id)).toBe(true);
  });

  it("rejects an unknown category instead of persisting it", async () => {
    const api = await register();
    const tool = api.tools.find((t) => t.name === "openltm_learn")!;
    const out = JSON.parse(
      (await tool.execute("c3", { content: "category guard probe for unknown values", category: "not-a-category" })).content[0]!.text,
    );
    expect(out.action).toBe("created");

    // The persisted row must carry the fallback, not the rejected value.
    const { getDb } = await import("@rohirik/openltm-core");
    const row = getDb()
      .query<{ category: string }, [number]>("SELECT category FROM memories WHERE id=?")
      .get(out.id as number);
    expect(row?.category).toBe("pattern");
  });

  it("surfaces tool errors as text rather than throwing", async () => {
    const api = await register();
    const forget = api.tools.find((t) => t.name === "openltm_forget")!;
    const out = await forget.execute("c4", { id: 999_999 });
    expect(out.content[0]!.text).toContain("openltm_forget failed");
  });

  it("lists stale memories and rejects a clear without an id", async () => {
    const api = await register();
    const stale = api.tools.find((t) => t.name === "openltm_stale")!;
    expect((await stale.execute("c5", { action: "list" })).content[0]!.text).toBe("No stale memories.");
    expect((await stale.execute("c6", { action: "clear" })).content[0]!.text).toContain("memory_id is required");
  });

  it("auto-recall injects a Prior Knowledge block when memories exist", async () => {
    const api = await register();
    const sections = api.supplements[0]!({ availableTools: new Set() });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.join("\n")).toContain("Prior Knowledge");
  });

  it("auto-recall yields nothing when autoRecall is disabled", async () => {
    const api = await register({ autoRecall: false });
    expect(api.supplements[0]!({ availableTools: new Set() })).toEqual([]);
  });
});
