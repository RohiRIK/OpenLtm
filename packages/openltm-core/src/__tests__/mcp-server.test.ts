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
  "context", "graph", "context_items", "context_add", "proposals",
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

    for (const name of ["recall", "get", "context", "context_items", "graph", "admin_audit"]) {
      expect(byName.get(name)!.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of ["learn", "relate", "forget", "revalidate", "context_add", "proposals"]) {
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
