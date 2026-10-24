/**
 * mcp-server.test.ts — tests for packages/openltm-core/src/mcp/server.ts
 *
 * Smoke tests assert the module loads and the tool surface matches the
 * documented contract. The protocol tests drive a real MCP client over an
 * in-memory transport against a temp database — no stdio, no ~/.claude.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServerOptions } from "../mcp/server.js";

const TOOL_NAMES = [
  "recall", "get", "learn", "relate", "forget", "revalidate", "admin_audit",
  "context", "graph", "context_items", "context_add", "proposals", "stale", "stats",
  "collection", "record",
];

describe("mcp/server — buildMcpServer", () => {
  it("exports buildMcpServer and startMcpServer", async () => {
    const mod = await import("../mcp/server.js");
    expect(typeof mod.buildMcpServer).toBe("function");
    expect(typeof mod.startMcpServer).toBe("function");
  });

  it("builds a server exposing the documented tool set", async () => {
    const { buildMcpServer } = await import("../mcp/server.js");
    const server = buildMcpServer();
    expect(typeof server.connect).toBe("function");
    // McpServer keeps registered tools in a private map — assert via the
    // public-ish _registeredTools record the SDK maintains.
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    const names = Object.keys(tools);
    for (const expected of TOOL_NAMES) {
      expect(names).toContain(expected);
    }
  });

  it("accepts host config hooks without invoking them at build time", async () => {
    const { buildMcpServer } = await import("../mcp/server.js");
    let called = false;
    buildMcpServer({
      isEnabled: async () => { called = true; return true; },
      categoriseThreshold: async () => { called = true; return 0.6; },
      defaultProject: () => { called = true; return "p"; },
    });
    expect(called).toBe(false);
  });

  it("reports the openltm-core package version, not a hardcoded one", async () => {
    const { SERVER_VERSION } = await import("../mcp/server.js");
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8"));
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});

// ─── Protocol tests ──────────────────────────────────────────────────────────

const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-mcp-server-test-"));
const dbPath = join(tmpRoot, "openltm.db");
const pluginData = join(tmpRoot, "plugin-data");
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function connect(options: McpServerOptions = {}): Promise<Client> {
  const { buildMcpServer } = await import("../mcp/server.js");
  const server = buildMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "ltm-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function json<T = unknown>(result: ToolResult): T {
  expect(result.isError ?? false).toBe(false);
  return JSON.parse(result.content[0]!.text) as T;
}

let savedPluginData: string | undefined;

beforeAll(async () => {
  const core = await import("../index.js");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterEach(() => {
  if (savedPluginData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
  else process.env.CLAUDE_PLUGIN_DATA = savedPluginData;
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("mcp/server — tools/list", () => {
  it("advertises title + annotations on every tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of TOOL_NAMES) {
      const tool = byName.get(name);
      expect(tool).toBeDefined();
      expect(typeof tool!.title).toBe("string");
      expect(tool!.annotations?.openWorldHint).toBe(false);
    }

    for (const name of ["recall", "get", "context", "context_items", "graph", "admin_audit", "stale", "stats"]) {
      expect(byName.get(name)!.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of ["learn", "relate", "forget", "revalidate", "context_add", "proposals", "collection", "record"]) {
      expect(byName.get(name)!.annotations?.readOnlyHint).toBe(false);
    }
    expect(byName.get("forget")!.annotations?.destructiveHint).toBe(true);
    expect(byName.get("proposals")!.annotations?.destructiveHint).toBe(true);
    expect(byName.get("learn")!.annotations?.destructiveHint).toBe(false);
    expect(byName.get("context_add")!.annotations?.destructiveHint).toBe(false);
    expect(byName.get("relate")!.annotations?.idempotentHint).toBe(true);
    expect(byName.get("revalidate")!.annotations?.idempotentHint).toBe(true);
  });

  it("makes project optional on context, context_items and context_add", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const name of ["context", "context_items", "context_add"]) {
      const schema = tools.find((t) => t.name === name)!.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(Object.keys(schema.properties)).toContain("project");
      expect(schema.required ?? []).not.toContain("project");
    }
    const addSchema = tools.find((t) => t.name === "context_add")!.inputSchema as { required?: string[] };
    expect(addSchema.required).toEqual(expect.arrayContaining(["type", "content"]));
  });

  it("reports the package version in the initialize handshake", async () => {
    const { SERVER_VERSION } = await import("../mcp/server.js");
    const client = await connect();
    expect(client.getServerVersion()?.version).toBe(SERVER_VERSION);
    expect(SERVER_VERSION).not.toBe("1.0.0");
  });
});

describe("mcp/server — context tools without project", () => {
  it("returns a clear error when no project is given and the host has no default", async () => {
    const client = await connect();
    for (const name of ["context", "context_items"]) {
      const res = await call(client, name);
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("Pass `project`");
    }
    const add = await call(client, "context_add", { type: "goal", content: "x" });
    expect(add.isError).toBe(true);
  });

  it("falls back to the host's defaultProject", async () => {
    const core = await import("../index.js");
    core.learn({ content: "mcp default project scoped memory body", category: "pattern", importance: 4, project_scope: "mcp-default-proj", skipExport: true });

    const client = await connect({ defaultProject: async () => "mcp-default-proj" });
    const ctx = json<{ project: string; scoped: Array<{ content: string }> }>(await call(client, "context"));
    expect(ctx.project).toBe("mcp-default-proj");
    expect(ctx.scoped.some((m) => m.content.includes("mcp default project scoped"))).toBe(true);
  });

  it("an explicit project wins over the default", async () => {
    const client = await connect({ defaultProject: () => "should-not-be-used" });
    const ctx = json<{ project: string }>(await call(client, "context", { project: "explicit-proj" }));
    expect(ctx.project).toBe("explicit-proj");
  });

  it("treats a throwing defaultProject as no default", async () => {
    const client = await connect({ defaultProject: () => { throw new Error("no registry"); } });
    const res = await call(client, "context_items");
    expect(res.isError).toBe(true);
  });

  // Found in a live Claude Code run: an anchored learn without `project` was stored
  // global, so a commit to the same repo-relative path in any project flagged it.
  it("learn with files and no project is scoped to the current project; without files it stays global", async () => {
    const core = await import("../index.js");
    const client = await connect({ defaultProject: () => "anchor-proj" });
    const anchored = json<{ id: number }>(await call(client, "learn", { content: "anchored learn scoping check: parser lives in src/parser.ts", category: "architecture", files: ["src/parser.ts"] }));
    const crossProject = json<{ id: number }>(await call(client, "learn", { content: "cross project learn scoping check: prefer bun over npm", category: "preference" }));
    const scopeOf = (id: number) => (core.getDb().query("SELECT project_scope FROM memories WHERE id = ?").get(id) as { project_scope: string | null }).project_scope;
    expect(scopeOf(anchored.id)).toBe("anchor-proj");
    expect(scopeOf(crossProject.id)).toBeNull();
  });
});

describe("mcp/server — context_add", () => {
  it("writes each context type and context_items reads it back", async () => {
    const client = await connect({ defaultProject: () => "ctx-add-proj" });

    for (const [type, content] of [
      ["goal", "ship hybrid recall"],
      ["decision", "fuse FTS and embeddings with RRF k=60"],
      ["gotcha", "FTS5 rank is negative BM25"],
      ["progress", "context_add tool landed"],
    ] as const) {
      const res = json<{ ok: boolean; project: string; type: string }>(await call(client, "context_add", { type, content }));
      expect(res).toEqual({ ok: true, project: "ctx-add-proj", type });
    }

    const items = json<Array<{ type: string; content: string }>>(await call(client, "context_items"));
    expect(items.map((i) => `${i.type}:${i.content}`)).toEqual(expect.arrayContaining([
      "goal:ship hybrid recall",
      "decision:fuse FTS and embeddings with RRF k=60",
      "gotcha:FTS5 rank is negative BM25",
      "progress:context_add tool landed",
    ]));
  });

  it("replaces the goal instead of appending a second one", async () => {
    const client = await connect();
    json(await call(client, "context_add", { type: "goal", content: "first goal", project: "goal-proj" }));
    json(await call(client, "context_add", { type: "goal", content: "second goal", project: "goal-proj" }));
    const goals = json<Array<{ content: string }>>(await call(client, "context_items", { project: "goal-proj", type: "goal" }));
    expect(goals.map((g) => g.content)).toEqual(["second goal"]);
  });

  it("rejects an unknown type and blank content", async () => {
    const client = await connect({ defaultProject: () => "p" });
    const badType = await call(client, "context_add", { type: "note", content: "x" });
    expect(badType.isError).toBe(true);
    const blank = await call(client, "context_add", { type: "decision", content: "   " });
    expect(blank.isError).toBe(true);
  });
});

describe("mcp/server — proposals", () => {
  function useProposalsDir(): string {
    savedPluginData = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    const dir = join(pluginData, "proposals");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writeProposals(dir: string, sessionId: string, proposals: object[]): void {
    writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({ proposals, generatedAt: 1_700_000_000_000 }));
  }

  it("lists pending proposals with session_id + index", async () => {
    const dir = useProposalsDir();
    writeProposals(dir, "sess-a", [
      { content: "proposal low", category: "pattern", importance: 2, source: "eval" },
      { content: "proposal high", category: "gotcha", importance: 4, source: "eval" },
    ]);
    const client = await connect();
    const res = json<{ count: number; proposals: Array<{ session_id: string; index: number; content: string; generated_at: string }> }>(
      await call(client, "proposals", { action: "list" }),
    );
    expect(res.count).toBe(2);
    expect(res.proposals[0]).toMatchObject({ session_id: "sess-a", index: 1, content: "proposal high" });
    expect(res.proposals[0]!.generated_at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("accept scopes the memory to the proposal's project; list shows it", async () => {
    const dir = useProposalsDir();
    writeFileSync(join(dir, "sess-proj.json"), JSON.stringify({
      generatedAt: 1_700_000_000_000, project: "proposal-proj",
      proposals: [{ content: "proposal scoped to its session project zebra", category: "gotcha", importance: 3, source: "eval" }],
    }));
    const client = await connect();
    const list = json<{ proposals: Array<{ session_id: string; project: string | null }> }>(await call(client, "proposals", { action: "list" }));
    expect(list.proposals.find((p) => p.session_id === "sess-proj")?.project).toBe("proposal-proj");
    expect((await call(client, "proposals", { action: "accept", session_id: "sess-proj", index: 0 })).isError).toBeFalsy();
    const core = await import("../index.js");
    const row = core.getDb().query("SELECT project_scope FROM memories WHERE content = ?").get("proposal scoped to its session project zebra") as { project_scope: string | null };
    expect(row.project_scope).toBe("proposal-proj");
  });

  it("accept stores the memory and removes the proposal", async () => {
    const dir = useProposalsDir();
    writeProposals(dir, "sess-b", [
      { content: "accepted proposal: hybrid recall uses reciprocal rank fusion", category: "architecture", importance: 4, source: "eval" },
    ]);
    const client = await connect();
    const res = json<{ ok: boolean }>(await call(client, "proposals", { action: "accept", session_id: "sess-b", index: 0 }));
    expect(res).toEqual({ ok: true, action: "accept", session_id: "sess-b", index: 0 } as never);
    expect(existsSync(join(dir, "sess-b.json"))).toBe(false);

    const core = await import("../index.js");
    const row = core.getDb()
      .query<{ id: number }, [string]>("SELECT id FROM memories WHERE content = ?")
      .get("accepted proposal: hybrid recall uses reciprocal rank fusion");
    expect(row).not.toBeNull();
  });

  it("reject discards the proposal without storing it", async () => {
    const dir = useProposalsDir();
    writeProposals(dir, "sess-c", [
      { content: "rejected proposal body never stored", category: "pattern", importance: 3, source: "eval" },
      { content: "kept proposal body", category: "pattern", importance: 3, source: "eval" },
    ]);
    const client = await connect();
    json(await call(client, "proposals", { action: "reject", session_id: "sess-c", index: 0 }));
    const left = json<{ proposals: Array<{ content: string }> }>(await call(client, "proposals", { action: "list" }));
    expect(left.proposals.map((p) => p.content)).toEqual(["kept proposal body"]);

    const core = await import("../index.js");
    const row = core.getDb()
      .query<{ id: number }, [string]>("SELECT id FROM memories WHERE content = ?")
      .get("rejected proposal body never stored");
    expect(row).toBeNull();
  });

  it("validates session_id + index for accept/reject", async () => {
    const dir = useProposalsDir();
    writeProposals(dir, "sess-d", [{ content: "only proposal", category: "pattern", importance: 3, source: "eval" }]);
    const client = await connect();

    const missing = await call(client, "proposals", { action: "accept" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toContain("session_id and index");

    const traversal = await call(client, "proposals", { action: "reject", session_id: "../sess-d", index: 0 });
    expect(traversal.isError).toBe(true);

    const outOfRange = await call(client, "proposals", { action: "reject", session_id: "sess-d", index: 5 });
    expect(outOfRange.isError).toBe(true);
    expect(outOfRange.content[0]!.text).toContain("No pending proposal");

    const negative = await call(client, "proposals", { action: "accept", session_id: "sess-d", index: -1 });
    expect(negative.isError).toBe(true);

    expect(existsSync(join(dir, "sess-d.json"))).toBe(true);
  });
});

describe("mcp/server — recall workspace / agent filters", () => {
  it("passes workspace_id and agent_id through to recall", async () => {
    const core = await import("../index.js");
    const a = core.learn({ content: "zebracorn workspace alpha memory", category: "pattern", workspace_id: "ws-alpha", agent_id: "agent-1", skipExport: true });
    const b = core.learn({ content: "zebracorn workspace beta memory", category: "pattern", workspace_id: "ws-beta", agent_id: "agent-2", skipExport: true });
    const shared = core.learn({ content: "zebracorn unscoped shared memory", category: "pattern", skipExport: true });

    const client = await connect();
    const ids = async (args: Record<string, unknown>) =>
      json<Array<{ id: number }>>(await call(client, "recall", { query: "zebracorn", ...args })).map((m) => m.id);

    const all = await ids({});
    expect(all).toEqual(expect.arrayContaining([a.id, b.id, shared.id]));

    const alpha = await ids({ workspace_id: "ws-alpha" });
    expect(alpha).toEqual(expect.arrayContaining([a.id, shared.id]));
    expect(alpha).not.toContain(b.id);

    const agent2 = await ids({ agent_id: "agent-2" });
    expect(agent2).toEqual(expect.arrayContaining([b.id, shared.id]));
    expect(agent2).not.toContain(a.id);
  });
});

describe("mcp/server — learn origin", () => {
  it("stores the origin, returns it from learn and recall, and rejects an unknown one", async () => {
    const client = await connect();
    const stored = json<{ id: number; origin: string }>(await call(client, "learn", {
      content: "quokkafern: the owner wants release notes in Hebrew and English", origin: "owner-statement",
    }));
    expect(stored.origin).toBe("owner-statement");
    const recalled = json<Array<{ id: number; origin: string }>>(await call(client, "recall", { query: "quokkafern" }));
    expect(recalled.find((m) => m.id === stored.id)?.origin).toBe("owner-statement");

    const bad = await client.callTool({ name: "learn", arguments: { content: "quokkafern bad origin", origin: "the-boss" } });
    expect(bad.isError).toBe(true);
  });
});

// Found in review: recall hid private memories but the resources listed them.
describe("mcp/server — resources respect the private tag", () => {
  it("memory://globals, memory://recent and memory://project/{name} omit private memories", async () => {
    const core = await import("../index.js");
    const priv = core.learn({ content: "okapi private global note never listed", category: "preference", importance: 5, tags: ["private"], skipExport: true });
    const pub = core.learn({ content: "okapi public global note always listed", category: "preference", importance: 5, skipExport: true });
    const privScoped = core.learn({ content: "okapi private project note", category: "gotcha", tags: ["Private"], project_scope: "okapi-proj", skipExport: true });
    const pubScoped = core.learn({ content: "okapi public project note", category: "gotcha", project_scope: "okapi-proj", skipExport: true });

    const client = await connect();
    const read = async (uri: string) =>
      JSON.parse((await client.readResource({ uri })).contents[0]!.text as string) as Array<{ id: number }>;
    for (const uri of ["memory://globals", "memory://recent"]) {
      const ids = (await read(uri)).map((m) => m.id);
      expect(ids).not.toContain(priv.id);
    }
    expect((await read("memory://globals")).map((m) => m.id)).toContain(pub.id);
    const scoped = (await read("memory://project/okapi-proj")).map((m) => m.id);
    expect(scoped).toContain(pubScoped.id);
    expect(scoped).not.toContain(privScoped.id);
  });
});

describe("mcp/server — learn never sends a private memory to the categorise LLM", () => {
  it("skips the LLM fallback for tags: [private] (control: it runs otherwise)", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    const savedFetch = globalThis.fetch;
    const sent: string[] = [];
    process.env.ANTHROPIC_API_KEY = "test-key";
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      sent.push(`${String(input)} ${String(init?.body ?? "")}`);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "pattern" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const client = await connect();
      // No category keywords → the heuristic is unsure → the LLM fallback would run.
      json(await call(client, "learn", { content: "Narwhal quarterly offsite moved to Lisbon", tags: ["private"] }));
      expect(sent.filter((s) => s.includes("Narwhal"))).toEqual([]);
      json(await call(client, "learn", { content: "Narwhal annual offsite moved to Porto" }));
      expect(sent.some((s) => s.includes("api.anthropic.com") && s.includes("Narwhal annual"))).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

describe("mcp/server — graph traversal skips private memories", () => {
  it("a relation never pulls a private memory's content into the graph output", async () => {
    const core = await import("../index.js");
    const pub = core.learn({ content: "Axolotl service uses the blue deploy pipeline", category: "architecture", skipExport: true });
    const priv = core.learn({ content: "Axolotl private escalation phone tree", category: "workflow", tags: ["private"], skipExport: true });
    const other = core.learn({ content: "Axolotl blue pipeline needs manual approval", category: "workflow", skipExport: true });
    core.relate({ source_id: pub.id, target_id: priv.id, relationship_type: "related_to" });
    core.relate({ source_id: pub.id, target_id: other.id, relationship_type: "supports" });
    const client = await connect();
    const text = (await call(client, "graph", { memory_ids: [pub.id], depth: 2 })).content[0]!.text;
    expect(text).not.toContain("escalation phone tree");
    expect(text).toContain("manual approval");
  });
});

describe("mcp/server — context_add keeps permanent items unique", () => {
  it("adding the same decision twice stores it once", async () => {
    const client = await connect();
    for (let i = 0; i < 2; i++) {
      json(await call(client, "context_add", { type: "decision", content: "Use WAL mode for the ledger DB", project: "uniq-proj" }));
    }
    const items = json<Array<{ content: string }>>(await call(client, "context_items", { project: "uniq-proj", type: "decision" }));
    expect(items.filter((i) => i.content === "Use WAL mode for the ledger DB").length).toBe(1);
  });
});

// Round-2 release verification (F1): `context` promised goals, decisions and
// gotchas but returned memories only — a context_add decision never showed up.
describe("mcp/server — context returns the project's context items", () => {
  it("context_add without project, then context: goal, decisions, gotchas, progress are there", async () => {
    const client = await connect({ defaultProject: () => "ctx-f1" });
    json(await call(client, "context_add", { type: "goal", content: "Ship hybrid recall" }));
    json(await call(client, "context_add", { type: "decision", content: "We use RRF k=60 for hybrid recall." }));
    json(await call(client, "context_add", { type: "gotcha", content: "FTS5 needs quoted tokens" }));
    json(await call(client, "context_add", { type: "progress", content: "wired the semantic retriever" }));
    const ctx = json<{ project: string; goal: string | null; decisions: string[]; gotchas: string[]; progress: string[]; globals: unknown[]; scoped: unknown[] }>(await call(client, "context"));
    expect(ctx.project).toBe("ctx-f1");
    expect(ctx.goal).toBe("Ship hybrid recall");
    expect(ctx.decisions).toContain("We use RRF k=60 for hybrid recall.");
    expect(ctx.gotchas).toContain("FTS5 needs quoted tokens");
    expect(ctx.progress).toContain("wired the semantic retriever");
    expect(Array.isArray(ctx.globals) && Array.isArray(ctx.scoped)).toBe(true);
  });

  it("memories in context are egress-scrubbed", async () => {
    const core = await import("../index.js");
    const db = core.getDb();
    const key = "AKIA" + "IOSFODNN7EXAMPLE";
    db.run("INSERT INTO memories (content, category, importance, project_scope, dedup_key) VALUES (?, 'gotcha', 4, 'ctx-scrub', 'ctx-scrub-1')", [`legacy row with ${key} in it`]);
    const client = await connect();
    const ctx = json<{ scoped: Array<{ content: string }> }>(await call(client, "context", { project: "ctx-scrub" }));
    expect(ctx.scoped.some((m) => m.content.startsWith("legacy row with"))).toBe(true);
    expect(JSON.stringify(ctx)).not.toContain(key);
  });

  it("learn reports the scope it stored the memory under", async () => {
    const client = await connect({ defaultProject: () => "scope-proj" });
    const global = json<{ project_scope: string | null }>(await call(client, "learn", { content: "Scope report: cross-project fact", category: "pattern" }));
    expect(global.project_scope).toBeNull();
    const anchored = json<{ project_scope: string | null }>(await call(client, "learn", { content: "Scope report: anchored fact", category: "gotcha", files: ["src/a.ts"] }));
    expect(anchored.project_scope).toBe("scope-proj");
  });
});

describe("mcp/server — neighbour relations are scrubbed (deep)", () => {
  const AWS = "AKIAIOSFODNN7EXAMPLE";
  it("get + recall on a clean memory never leak a related memory's secret", async () => {
    const core = await import("../index.js");
    const db = core.getDb();
    // Plant raw secret directly (bypassing write scrub) to model a legacy row.
    const dirty = Number(db.run(
      `INSERT INTO memories (content, title, category, importance, confidence, status, dedup_key)
       VALUES (?, ?, 'gotcha', 3, 1, 'active', ?)`,
      [`runner key ${AWS} rotates monthly`, `title ${AWS}`, `neighbour-dirty-${AWS}`],
    ).lastInsertRowid);
    const clean = core.learn({ content: "zebrafish neighbour scrub clean memory", category: "pattern", importance: 3, skipExport: true }).id;
    core.relate({ source_id: clean, target_id: dirty, relationship_type: "related_to" });

    const client = await connect();
    const got = await call(client, "get", { id: clean });
    expect(got.content[0]!.text).not.toContain(AWS);
    expect(got.content[0]!.text).toContain("[REDACTED:aws-access-key]");
    const parsed = json<{ memory: { relations: Array<{ memory: { id: number } }> } }>(got);
    expect(parsed.memory.relations.some((r) => r.memory.id === dirty)).toBe(true);

    const rec = await call(client, "recall", { query: "zebrafish neighbour", verbose: true });
    expect(rec.content[0]!.text).not.toContain(AWS);
  });
});

describe("mcp/server — tags scrub (write + compact egress)", () => {
  const AWS = "AKIAIOSFODNN7EXAMPLE";
  it("learn() stores a planted-secret tag redacted", async () => {
    const core = await import("../index.js");
    const id = core.learn({ content: "quokka tag write scrub", category: "pattern", importance: 3, tags: [`key-${AWS}`], skipExport: true }).id;
    const names = core.getDb().query<{ name: string }, [number]>(
      "SELECT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id WHERE mt.memory_id=?",
    ).all(id).map((r) => r.name);
    expect(names.join(",").toUpperCase()).not.toContain(AWS);
    expect(names.join(",")).toContain("[redacted:aws-access-key]");
  });

  it("compact recall output never returns a raw legacy tag", async () => {
    const core = await import("../index.js");
    const db = core.getDb();
    const id = core.learn({ content: "wombat compact tag egress", category: "pattern", importance: 3, skipExport: true }).id;
    // Legacy raw tag inserted directly (bypassing the write scrub).
    db.run("INSERT OR IGNORE INTO tags(name) VALUES(?)", [`legacy-${AWS}`]);
    const tagId = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name=?").get(`legacy-${AWS}`)!.id;
    db.run("INSERT INTO memory_tags(memory_id, tag_id) VALUES(?, ?)", [id, tagId]);
    const client = await connect();
    const rec = await call(client, "recall", { query: "wombat compact" });
    const text = rec.content[0]!.text;
    expect(text).toContain(`${id}`);
    expect(text).not.toContain(AWS);
    expect(text).toContain("[REDACTED:aws-access-key]");
  });

  it("deep scrub past depth 32 returns the stub, never the raw value", async () => {
    const { scrubMemoryPayload } = await import("../mcp/server.js");
    const core = await import("../index.js");
    let nested: unknown = { secret: `raw ${AWS}` };
    for (let i = 0; i < 40; i++) nested = { child: nested };
    const out = JSON.stringify(scrubMemoryPayload(nested));
    expect(out).not.toContain(AWS);
    expect(out).toContain(core.SCRUB_FAILED_PLACEHOLDER);
    // Arrays too.
    let arr: unknown = [`raw ${AWS}`];
    for (let i = 0; i < 40; i++) arr = [arr];
    expect(JSON.stringify(scrubMemoryPayload(arr))).not.toContain(AWS);
  });
});

describe("mcp/server — collection + record tools", () => {
  const AWS = "AKIAIOSFODNN7EXAMPLE";
  it("define, put, query, recall and context round-trip through MCP", async () => {
    const client = await connect({ defaultProject: () => "mcp-coll" });
    const defined = json<{ ok: boolean; collection: { name: string; origin: string } }>(await call(client, "collection", {
      action: "define", name: "hosts", description: "Homelab hosts and their roles",
      fields: [{ name: "host", type: "string", required: true }, { name: "role", type: "string" }, { name: "port", type: "integer" }],
      key_field: "host",
    }));
    expect(defined.collection).toMatchObject({ name: "hosts", origin: "agent-observation" });
    json(await call(client, "record", { action: "put", collection: "hosts", data: { host: "pve1", role: "quokka hypervisor", port: 8006 } }));
    const q = json<{ count: number; records: Array<{ key: string; data: { port: number } }> }>(
      await call(client, "record", { action: "query", collection: "hosts", where: [{ field: "port", op: "eq", value: 8006 }] }));
    expect(q.count).toBe(1);
    expect(q.records[0]!.key).toBe("pve1");

    const recalled = json<Array<{ type?: string; collection?: string; key?: string }>>(await call(client, "recall", { query: "quokka hypervisor" }));
    expect(recalled.some((r) => r.type === "record" && r.collection === "hosts" && r.key === "pve1")).toBe(true);
    const noRecords = json<Array<{ type?: string }>>(await call(client, "recall", { query: "quokka hypervisor", includeRecords: false }));
    expect(noRecords.some((r) => r.type === "record")).toBe(false);

    const ctx = json<{ collections?: Array<{ name: string; records: number }> }>(await call(client, "context", {}));
    expect(ctx.collections).toContainEqual(expect.objectContaining({ name: "hosts", records: 1 }));
  });

  it("returns refusals as tool errors the model can act on", async () => {
    const client = await connect();
    const bad = await call(client, "record", { action: "put", collection: "hosts", data: { host: "x", nope: 1 } });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0]!.text)).toMatchObject({ ok: false, error: "invalid_record" });
    const secret = await call(client, "record", { action: "put", collection: "hosts", data: { host: "y", role: `uses ${AWS}` } });
    expect(secret.isError).toBe(true);
    expect(secret.content[0]!.text).not.toContain(AWS);
    const dup = await call(client, "collection", { action: "define", name: "host", description: "dup", fields: [{ name: "host", type: "string", required: true }, { name: "role", type: "string" }] });
    expect(JSON.parse(dup.content[0]!.text)).toMatchObject({ ok: false, error: "similar_exists" });
    const missing = await call(client, "record", { action: "get", collection: "hosts" });
    expect(JSON.parse(missing.content[0]!.text)).toMatchObject({ ok: false, error: "missing_argument" });
  });

  it("egress-scrubs a legacy secret already in a record", async () => {
    const core = await import("../index.js");
    const db = core.getDb();
    const c = core.resolveCollection("hosts")!;
    db.run("INSERT INTO records (collection_id, record_key, data, schema_version, search_text) VALUES (?, 'legacy', ?, 1, 'hosts legacy')",
      [c.id, JSON.stringify({ host: "legacy", role: `raw ${AWS}` })]);
    const client = await connect();
    const got = await call(client, "record", { action: "get", collection: "hosts", key: "legacy" });
    expect(got.content[0]!.text).not.toContain(AWS);
    expect(got.content[0]!.text).toContain("[REDACTED:aws-access-key]");
  });
});
