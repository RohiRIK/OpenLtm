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
  it("registers the thirteen OpenLTM tools", async () => {
    const api = await register();
    expect(api.tools.map((t) => t.name).sort()).toEqual([
      "openltm_brain_stats",
      "openltm_collection",
      "openltm_context",
      "openltm_context_add",
      "openltm_forget",
      "openltm_get",
      "openltm_graph",
      "openltm_learn",
      "openltm_proposals",
      "openltm_recall",
      "openltm_record",
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

  it("lists a stale-flagged memory and clears its flag", async () => {
    const api = await register();
    const learn = api.tools.find((t) => t.name === "openltm_learn")!;
    const stale = api.tools.find((t) => t.name === "openltm_stale")!;
    const learned = JSON.parse(await text(learn, "s1", {
      content: "OpenClaw stale probe: the bridge config lives in openclaw.plugin.json",
      category: "architecture",
    })) as { id: number };
    const db = new Database(dbPath);
    try {
      // The bridge can still be recording the learn's background work. Match
      // production's bounded lock wait instead of racing its SQLite writer.
      db.run("PRAGMA busy_timeout = 5000");
      db.run("UPDATE memories SET stale_flagged_at = datetime('now'), stale_reason = 'probe' WHERE id = ?", [learned.id]);
    } finally {
      db.close();
    }

    expect(await text(stale, "s2", { action: "list" })).toContain("OpenClaw stale probe");
    expect(JSON.parse(await text(stale, "s3", { action: "clear", memory_id: learned.id }))).toEqual({ id: learned.id, revalidated: true });
    expect(await text(stale, "s4", { action: "list" })).not.toContain("OpenClaw stale probe");
  });

  it("brain_stats counts the whole store, not a recall sample", async () => {
    const api = await register();
    const stats = JSON.parse(await text(api.tools.find((t) => t.name === "openltm_brain_stats")!, "s5", {})) as {
      active: number; byCategory: Record<string, number>;
    };
    expect(stats.active).toBeGreaterThan(0);
    expect(stats.byCategory["constraint"]).toBeGreaterThan(0);
  });

  it("get, context_add and proposals reach the core tools", async () => {
    const api = await register();
    const recalled = await text(api.tools.find((t) => t.name === "openltm_recall")!, "g1", { query: "pin the host version" });
    const id = Number(/\[(\d+)\]/.exec(recalled)![1]);
    const got = JSON.parse(await text(api.tools.find((t) => t.name === "openltm_get")!, "g2", { id })) as { ok: boolean };
    expect(got.ok).toBe(true);

    const added = JSON.parse(await text(api.tools.find((t) => t.name === "openltm_context_add")!, "g3", {
      type: "decision", content: "OpenClaw context_add probe", project: "openclaw-ltm",
    })) as { ok: boolean };
    expect(added.ok).toBe(true);
    const ctx = await text(api.tools.find((t) => t.name === "openltm_context")!, "g4", { project: "openclaw-ltm" });
    expect(ctx).toContain("OpenClaw context_add probe");

    const proposals = JSON.parse(await text(api.tools.find((t) => t.name === "openltm_proposals")!, "g5", { action: "list" })) as { count: number };
    expect(typeof proposals.count).toBe("number");
  });

  it("collection and record reach the core tools through the bridge", async () => {
    const api = await register();
    const collection = api.tools.find((t) => t.name === "openltm_collection")!;
    const record = api.tools.find((t) => t.name === "openltm_record")!;
    const defined = JSON.parse(await text(collection, "c1", {
      action: "define", name: "claw_hosts", description: "Hosts OpenClaw talks to",
      fields: [{ name: "host", type: "string", required: true }, { name: "port", type: "integer" }], key_field: "host",
    })) as { ok: boolean };
    expect(defined.ok).toBe(true);
    expect(JSON.parse(await text(record, "c2", { action: "put", collection: "claw_hosts", data: { host: "gw", port: 18789 } }))).toMatchObject({ ok: true, created: true });
    const q = JSON.parse(await text(record, "c3", { action: "query", collection: "claw_hosts", where: [{ field: "port", op: "eq", value: 18789 }] })) as { count: number };
    expect(q.count).toBe(1);
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
    const lines = await api.preparations[0]!();
    // Budget covers header + memories; the evidence frame (open, notice, blank, close) is fixed overhead.
    expect(lines.filter((l) => l.startsWith("- (")).length).toBeLessThanOrEqual(3);
    expect(lines).toContain("<recalled-memory>");
    expect(lines.at(-1)).toBe("</recalled-memory>");
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
