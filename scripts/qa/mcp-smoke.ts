#!/usr/bin/env bun
/**
 * qa/mcp-smoke.ts — end-to-end check of the plugin MCP server over real stdio.
 *
 * Starts `bun run src/mcp-server.ts` in a throwaway sandbox (temp HOME, DB and
 * plugin data — never the real ~/.claude), drives it with the MCP SDK client,
 * and prints PASS/FAIL per check. Exit code 1 if any check fails.
 *
 * Usage (repo root): bun run scripts/qa/mcp-smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const EXPECTED_VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { version: string }).version;

const tmp = mkdtempSync(join(tmpdir(), "ltm-mcp-smoke-"));
const home = join(tmp, "home");
const data = join(tmp, "data");
const project = join(tmp, "Smoke_Project");
for (const d of [home, join(data, "proposals"), project]) mkdirSync(d, { recursive: true });
writeFileSync(join(data, "proposals", "smoke-session.json"), JSON.stringify({
  generatedAt: Date.now(),
  proposals: [{ content: "Smoke proposal: recall fuses full-text and embedding rankings with RRF", category: "architecture", importance: 4, source: "smoke" }],
}));
const victim = join(data, "victim.json");
writeFileSync(victim, JSON.stringify({ generatedAt: Date.now(), proposals: [{ content: "x", category: "pattern", importance: 3, source: "x" }] }));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["run", join(ROOT, "src", "mcp-server.ts")],
  cwd: project,
  env: {
    ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
    LTM_DB_PATH: join(data, "openltm.db"), CLAUDE_PLUGIN_DATA: data, LTM_EMBED_PROVIDER: "disabled",
  } as Record<string, string>,
  stderr: "ignore",
});
const client = new Client({ name: "qa-smoke", version: "0" });

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ""}`);
}
type Result = { content: Array<{ text: string }>; isError?: boolean };
async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  return (await client.callTool({ name, arguments: args })) as Result;
}
const json = (r: Result) => JSON.parse(r.content[0]!.text) as any;

try {
  await client.connect(transport);

  check(`server reports package version ${EXPECTED_VERSION}`, client.getServerVersion()?.version === EXPECTED_VERSION, client.getServerVersion());

  const { tools } = await client.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const expected = ["recall", "get", "learn", "relate", "forget", "revalidate", "admin_audit", "context", "graph", "context_items", "context_add", "proposals"];
  check("tools/list has all 12 tools", expected.every((n) => byName.has(n)), [...byName.keys()]);
  check("read-only tools are annotated readOnlyHint", ["recall", "get", "context", "context_items", "graph", "admin_audit"].every((n) => byName.get(n)?.annotations?.readOnlyHint === true));
  check("forget is annotated destructiveHint", byName.get("forget")?.annotations?.destructiveHint === true);
  check("context needs no project argument", ((byName.get("context")?.inputSchema as { required?: string[] }).required ?? []).length === 0);

  const ctx = await call("context", {});
  check("context {} resolves the cwd's project (normalized folder name)", !ctx.isError && json(ctx).project === "smoke-project", ctx.content[0]?.text);

  const add = await call("context_add", { type: "decision", content: "Smoke decision: hybrid recall uses RRF k=60" });
  check("context_add decision ok", !add.isError && json(add).ok === true, add.content[0]?.text);
  const items = await call("context_items", { type: "decision" });
  check("context_items lists the new decision", items.content[0]!.text.includes("Smoke decision"), items.content[0]?.text);

  const list = await call("proposals", { action: "list" });
  check("proposals list shows the queued proposal", json(list).count === 1 && json(list).proposals[0].session_id === "smoke-session", json(list));
  const bad = await call("proposals", { action: "reject", session_id: "../victim", index: 0 });
  check("proposals rejects a path-like session_id and leaves the file", bad.isError === true && existsSync(victim), bad.content[0]?.text);
  const missing = await call("proposals", { action: "accept" });
  check("proposals accept without ids is an error", missing.isError === true);
  const accept = await call("proposals", { action: "accept", session_id: "smoke-session", index: 0 });
  check("proposals accept ok and file consumed", !accept.isError && !existsSync(join(data, "proposals", "smoke-session.json")), accept.content[0]?.text);

  const rec = await call("recall", { query: "how do we fuse full-text and embedding rankings" });
  const hits = json(rec) as Array<{ id: number; content: string }>;
  check("recall ranks the accepted proposal first", hits[0]?.content.includes("RRF") === true, hits.slice(0, 3));

  if (hits[0]) {
    const got = await call("get", { id: hits[0].id });
    check("get returns the full memory", json(got).ok === true && json(got).memory.content.includes("RRF"), got.content[0]?.text);
  }

  const priv = await call("learn", { content: "Smoke private note: the staging bastion host is named kestrel", tags: ["private"], category: "workflow" });
  const privId = json(priv).id as number;
  const privRecall = json(await call("recall", { query: "staging bastion host kestrel" })) as Array<{ id: number }>;
  check("private memory hidden from recall by default", !privRecall.some((m) => m.id === privId), privRecall);
  const privGet = await call("get", { id: privId });
  check("get on a private memory returns error=private", json(privGet).error === "private", privGet.content[0]?.text);
  const privAllowed = json(await call("recall", { query: "staging bastion host kestrel", includePrivate: true })) as Array<{ id: number }>;
  check("includePrivate=true returns it", privAllowed.some((m) => m.id === privId), privAllowed);

  const secret = await call("learn", { content: "Deploy key for CI is AKIAIOSFODNN7EXAMPLE do not share", category: "workflow" });
  const secretGet = await call("get", { id: json(secret).id });
  check("AWS-style key never comes back out of the store", !secretGet.content[0]!.text.includes("AKIAIOSFODNN7EXAMPLE"), secretGet.content[0]?.text);
} catch (err) {
  failures++;
  console.log(`FAIL  smoke run threw: ${err}`);
} finally {
  await client.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll MCP smoke checks passed." : `\n${failures} MCP smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
