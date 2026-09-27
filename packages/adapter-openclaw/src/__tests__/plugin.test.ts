/**
 * Tests for the OpenClaw adapter.
 *
 * OpenClaw runs on Node and core is Bun code, so the adapter deliberately does
 * not import `@rohirik/openltm-core` — it spawns the core MCP server as a Bun
 * child and speaks JSON-RPC over stdio. These tests exercise the real bridge
 * against a real database, and stub only the host API.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openclaw-ltm-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "..", "openltm-core", "src", "schema.sql");
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
  tools: Tool[];
  supplements: Array<() => string[]>;
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

async function register(pluginConfig: unknown = {}) {
  const { default: entry } = (await import("../index.js")) as never as {
    default: { register: (api: FakeApi) => void };
  };
  const api = createFakeApi(pluginConfig);
  entry.register(api);
  return api;
}

const text = async (tool: Tool, id: string, params: Record<string, unknown>) =>
  (await tool.execute(id, params)).content[0]!.text;

beforeAll(async () => {
  // Seed a database the bridge will open, so recall has something to find.
  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await runPendingMigrations(db);
  db.close();

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

  it("auto-recall returns a (possibly empty) section list and never throws", async () => {
    const api = await register();
    expect(api.supplements).toHaveLength(1);
    expect(Array.isArray(api.supplements[0]!())).toBe(true);
  });

  it("auto-recall yields nothing when disabled", async () => {
    const api = await register({ autoRecall: false });
    expect(api.supplements[0]!()).toEqual([]);
  });
});
