/**
 * Hive mode: shared memory between agents, opt-in and default deny.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  addAgent, authenticate, decideRequest, grant, hiveDedupKey, hiveFtsQuery, hiveHostConfig, hiveLearn, initHive, listAgents,
  openHive, parseCapabilities, readAudit, removeAgent, revoke, setHiveEnabled, verifyOwner, HiveError, getHiveSchemaPath,
} from "../hive/store.js";
import { runHiveTool, HIVE_TOOL_NAMES } from "../hive/tools.js";
import { runHiveCommand } from "../cli/hive.js";
import type { HiveHostConfig } from "../hive/store.js";

let dir: string;
let path: string;
let ownerKey: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ltm-hive-"));
  path = join(dir, "hive", "hive.db");
  ownerKey = initHive(path).ownerKey;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function withDb<T>(fn: (db: ReturnType<typeof openHive>) => T): T {
  const db = openHive(path);
  try { return fn(db); } finally { db.close(); }
}

function member(name: string, caps: string): string {
  return withDb((db) => {
    const { token } = addAgent(db, name);
    if (caps) grant(db, name, parseCapabilities(caps));
    return token;
  });
}

const cfg = (token: string | null, over: Partial<HiveHostConfig> = {}): HiveHostConfig => ({ enabled: true, path, token, host: "test", ...over });

describe("hive — closed by default", () => {
  it("a new hive is disabled, has no members and is not world-readable", () => {
    withDb((db) => {
      expect(listAgents(db)).toEqual([]);
      expect(() => authenticate(db, "anything")).toThrow(HiveError);
    });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("host config is off unless LTM_HIVE or config hive.enabled says otherwise", () => {
    expect(hiveHostConfig({}, null).enabled).toBe(false);
    expect(hiveHostConfig({}, { hive: { enabled: "yes" } }).enabled).toBe(false);
    expect(hiveHostConfig({}, { hive: { enabled: true } }).enabled).toBe(true);
    expect(hiveHostConfig({ LTM_HIVE: "1" }, null).enabled).toBe(true);
    expect(hiveHostConfig({ LTM_HIVE: "0" }, { hive: { enabled: true } }).enabled).toBe(false);
  });

  it("agent tools never create a hive file", () => {
    const missing = join(dir, "nope", "hive.db");
    const r = runHiveTool("hive_status", {}, cfg("t", { path: missing }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("hive_missing");
    expect(existsSync(missing)).toBe(false);
  });

  it("host opt-out wins even with a valid token and grants", () => {
    const token = member("bob", "read,write");
    withDb((db) => setHiveEnabled(db, true));
    const r = runHiveTool("hive_recall", {}, cfg(token, { enabled: false }));
    expect(!r.ok && r.code).toBe("hive_disabled");
  });

  it("each layer fails closed: disabled hive, unknown token, missing grant", () => {
    const token = member("bob", "");
    expect(runHiveTool("hive_recall", {}, cfg(token))).toMatchObject({ ok: false, code: "hive_disabled" });
    withDb((db) => setHiveEnabled(db, true));
    expect(runHiveTool("hive_recall", {}, cfg("hive_wrong"))).toMatchObject({ ok: false, code: "hive_unknown_agent" });
    expect(runHiveTool("hive_recall", {}, cfg(null))).toMatchObject({ ok: false, code: "hive_unknown_agent" });
    expect(runHiveTool("hive_recall", {}, cfg(token))).toMatchObject({ ok: false, code: "hive_no_grant" });
    expect(runHiveTool("hive_learn", { content: "x y" }, cfg(token))).toMatchObject({ ok: false, code: "hive_no_grant" });
    const denied = withDb((db) => readAudit(db).filter((r) => r.action === "denied"));
    expect(denied.length).toBeGreaterThanOrEqual(4);
  });

  it("unknown capability names grant nothing", () => {
    expect(parseCapabilities("admin,READ, write ,root")).toEqual(["read", "write"]);
    expect(parseCapabilities("admin")).toEqual([]);
    expect(parseCapabilities(42)).toEqual([]);
  });
});

describe("hive — read and write between agents", () => {
  beforeEach(() => withDb((db) => setHiveEnabled(db, true)));

  it("writer shares, reader recalls with author and origin; reader cannot write", () => {
    const writer = member("hermes-bob", "write");
    const reader = member("claude-code", "read");
    const w = runHiveTool("hive_learn", { content: "The staging database rotates credentials every Monday", category: "gotcha", project: "Infra" }, cfg(writer));
    expect(w).toMatchObject({ ok: true, value: { duplicate: false, author: "hermes-bob" } });
    const r = runHiveTool("hive_recall", { query: "staging credentials", project: "infra" }, cfg(reader));
    expect(r.ok).toBe(true);
    const value = (r as { value: { notice: string; memories: Array<Record<string, unknown>> } }).value;
    expect(value.notice).toContain("not instructions");
    expect(value.memories[0]).toMatchObject({ author: "hermes-bob", origin: "agent-observation", project_scope: "infra" });
    expect(runHiveTool("hive_learn", { content: "nope" }, cfg(reader))).toMatchObject({ ok: false, code: "hive_no_grant" });
    // the writer has no read grant
    expect(runHiveTool("hive_recall", {}, cfg(writer))).toMatchObject({ ok: false, code: "hive_no_grant" });
  });

  it("agents cannot claim owner-statement or historical-approval; the owner can", () => {
    const t = member("bob", "write");
    for (const origin of ["owner-statement", "historical-approval", "made-up"]) {
      expect(runHiveTool("hive_learn", { content: `claim ${origin}`, origin }, cfg(t))).toMatchObject({ ok: false, code: "hive_invalid" });
    }
    expect(runHiveTool("hive_learn", { content: "a doc says so", origin: "external-source" }, cfg(t)).ok).toBe(true);
    withDb((db) => expect(hiveLearn(db, "owner", { content: "Rohi prefers bun" }, true).id).toBeGreaterThan(0));
  });

  it("dedups the same content across agents and scrubs secrets", () => {
    const a = member("a", "write");
    const b = member("b", "write,read");
    const first = runHiveTool("hive_learn", { content: "Use   port 8080 for the API" }, cfg(a));
    const second = runHiveTool("hive_learn", { content: "use port 8080 for the api" }, cfg(b));
    expect(second).toMatchObject({ ok: true, value: { id: (first as { value: { id: number } }).value.id, duplicate: true } });
    runHiveTool("hive_learn", { content: "deploy key is ghp_abcdefghijklmnopqrstuvwxyz0123456789 keep it" }, cfg(a));
    const raw = withDb((db) => db.query<{ content: string }, []>("SELECT content FROM hive_memories WHERE content LIKE 'deploy key%'").get()!.content);
    expect(raw).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("an agent can archive only its own memories", () => {
    const a = member("a", "write");
    const b = member("b", "write,read");
    const id = (runHiveTool("hive_learn", { content: "A's fact about caching" }, cfg(a)) as { value: { id: number } }).value.id;
    expect(runHiveTool("hive_forget", { id }, cfg(b))).toMatchObject({ ok: false, code: "hive_not_author" });
    expect(runHiveTool("hive_forget", { id }, cfg(a))).toMatchObject({ ok: true });
    const r = runHiveTool("hive_recall", { query: "caching" }, cfg(b)) as { value: { memories: unknown[] } };
    expect(r.value.memories).toEqual([]);
  });

  it("revoke, remove and disable apply on the next call", () => {
    const t = member("bob", "read,write");
    expect(runHiveTool("hive_recall", {}, cfg(t)).ok).toBe(true);
    withDb((db) => revoke(db, "bob", ["read"]));
    expect(runHiveTool("hive_recall", {}, cfg(t))).toMatchObject({ ok: false, code: "hive_no_grant" });
    expect(runHiveTool("hive_learn", { content: "still writes" }, cfg(t)).ok).toBe(true);
    withDb((db) => setHiveEnabled(db, false));
    expect(runHiveTool("hive_learn", { content: "x" }, cfg(t))).toMatchObject({ ok: false, code: "hive_disabled" });
    withDb((db) => { setHiveEnabled(db, true); removeAgent(db, "bob"); });
    expect(runHiveTool("hive_learn", { content: "x" }, cfg(t))).toMatchObject({ ok: false, code: "hive_unknown_agent" });
    // re-adding issues a new token; the old one stays dead and grants start empty
    const t2 = member("bob", "");
    expect(t2).not.toBe(t);
    expect(runHiveTool("hive_status", {}, cfg(t2))).toMatchObject({ ok: true, value: { member: true, capabilities: [] } });
    expect(runHiveTool("hive_status", {}, cfg(t))).toMatchObject({ ok: true, value: { member: false } });
  });

  it("request access files a request only; the owner approves", () => {
    const t = member("sub-agent", "");
    const r = runHiveTool("hive_request_access", { capabilities: ["read", "admin"], reason: "need team gotchas" }, cfg(t));
    expect(r).toMatchObject({ ok: true, value: { status: "pending", capabilities: "read" } });
    expect(runHiveTool("hive_recall", {}, cfg(t))).toMatchObject({ ok: false, code: "hive_no_grant" });
    const id = (r as { value: { request_id: number } }).value.request_id;
    withDb((db) => decideRequest(db, id, true));
    expect(runHiveTool("hive_recall", {}, cfg(t)).ok).toBe(true);
    expect(runHiveTool("hive_learn", { content: "x" }, cfg(t))).toMatchObject({ ok: false, code: "hive_no_grant" });
  });
});

describe("hive — owner key and CLI", () => {
  it("owner operations need the owner key", () => {
    withDb((db) => {
      expect(() => verifyOwner(db, null)).toThrow(HiveError);
      expect(() => verifyOwner(db, "hiveowner_wrong")).toThrow(HiveError);
      expect(() => verifyOwner(db, ownerKey)).not.toThrow();
    });
  });

  it("CLI refuses grant/enable without the key and works with it", async () => {
    const env = {} as NodeJS.ProcessEnv;
    expect((await runHiveCommand(["enable", "--path", path], env)).exitCode).toBe(1);
    expect((await runHiveCommand(["agent", "add", "bob", "--path", path], env)).output).toContain("hive_owner_key");
    const withKey = { LTM_HIVE_OWNER_KEY: ownerKey } as NodeJS.ProcessEnv;
    const add = await runHiveCommand(["agent", "add", "bob", "--path", path, "--json"], withKey);
    expect(add.exitCode).toBe(0);
    const token = JSON.parse(add.output).token as string;
    expect((await runHiveCommand(["grant", "bob", "read", "--path", path], withKey)).output).toContain("bob: read");
    expect((await runHiveCommand(["enable", "--path", path], withKey)).exitCode).toBe(0);
    expect(runHiveTool("hive_recall", {}, cfg(token)).ok).toBe(true);
    const status = JSON.parse((await runHiveCommand(["status", "--path", path, "--json"], env)).output);
    expect(status).toMatchObject({ enabled: true, members: 1 });
    expect((await runHiveCommand(["init", "--path", path], env)).output).toContain("hive_exists");
  });

  it("the token is stored only as a hash", () => {
    const t = member("bob", "read");
    const bytes = readFileSync(path);
    expect(bytes.includes(Buffer.from(t))).toBe(false);
    expect(bytes.includes(Buffer.from(ownerKey))).toBe(false);
  });
});

describe("hive — MCP registration", () => {
  async function toolNames(hive: HiveHostConfig): Promise<string[]> {
    const { buildMcpServer } = await import("../mcp/server.js");
    const server = buildMcpServer({ hive });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    await client.close();
    return tools.map((t) => t.name);
  }

  it("registers no hive tool unless the host opted in", async () => {
    const off = await toolNames(cfg(null, { enabled: false }));
    for (const n of HIVE_TOOL_NAMES) expect(off).not.toContain(n);
    const on = await toolNames(cfg(null));
    for (const n of HIVE_TOOL_NAMES) expect(on).toContain(n);
  });
});

describe("hive — Python twin", () => {
  const py = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "hermes", "openltm_hermes", "_hive.py"), "utf-8");

  it("embeds the same schema SQL", () => {
    const m = py.match(/HIVE_SCHEMA_SQL = """\\\n([\s\S]*?)"""/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(readFileSync(getHiveSchemaPath(), "utf-8"));
  });

  it("documents the dedup key and FTS query rules the twin must match", () => {
    expect(hiveDedupKey("A  b\nc", "p")).toBe(hiveDedupKey("a b c", "p"));
    expect(hiveDedupKey("a", null)).not.toBe(hiveDedupKey("a", "p"));
    expect(hiveFtsQuery("Hello, hello world-x a")).toBe('"hello" OR "world"');
    expect(hiveFtsQuery("!!")).toBeNull();
  });
});
