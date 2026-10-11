#!/usr/bin/env bun
/**
 * qa/continuity-smoke.ts — the plugin's default database, end to end, the way
 * Claude Code runs it: no LTM_DB_PATH, an alternate CLAUDE_CONFIG_DIR, the MCP
 * server started from .claude-plugin/plugin.json (placeholders expanded as the
 * host expands them) and the hooks run through hooks/bin/run-hook.sh.
 *
 * Session 1: SessionStart registers the repo, then MCP `learn` stores a project
 * memory, a global importance-4 memory and a global importance-3 memory.
 * Session 2: SessionStart lists the first two in its index — a global needs
 * importance ≥ 4 — and the third is still one `recall` or prompt away. Both
 * sides must have used exactly one database file.
 *
 * Usage (repo root): bun run scripts/qa/continuity-smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const T = mkdtempSync(join(tmpdir(), "ltm-continuity-smoke-"));
const home = join(T, "home"), tmp = join(T, "tmp");
const configDir = join(T, "alt-claude-config");
// What Claude Code passes a --plugin-dir plugin as CLAUDE_PLUGIN_DATA under CLAUDE_CONFIG_DIR.
const data = join(configDir, "plugins", "data", "openltm-inline");
const repo = join(T, "code", "Continuity_Repo");
for (const d of [home, tmp, data, repo]) mkdirSync(d, { recursive: true });
mkdirSync(join(home, ".bun", "bin"), { recursive: true });
Bun.spawnSync(["ln", "-s", process.execPath, join(home, ".bun", "bin", "bun")]);
Bun.spawnSync(["git", "-C", repo, "init", "-q"]);

const host = { HOME: home, CLAUDE_CONFIG_DIR: configDir, TMPDIR: tmp, LTM_EMBED_PROVIDER: "disabled", LTM_JANITOR_ON_SESSION_END: "0" };
const hookEnv: Record<string, string> = { PATH: "/usr/bin:/bin", ...host, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: data };

type Manifest = { mcpServers: { memory: { args: string[]; env: Record<string, string> } } };
const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf-8")) as Manifest;
const expand = (s: string) => s.replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOT).replaceAll("${CLAUDE_PLUGIN_DATA}", data);
function mcpEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...host, CLAUDE_PLUGIN_DATA: data };
  for (const k of ["LTM_DB_PATH", "LTM_DATA_DIR", "LTM_PLUGIN_DATA"]) delete env[k];
  // Measured (Claude Code 2.1.295): an entry that references its own key, like
  // "CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}", reaches the server unexpanded.
  for (const [k, v] of Object.entries(manifest.mcpServers.memory.env)) env[k] = v.includes(`\${${k}}`) ? v : expand(v);
  return env;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      got: ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600)}` : ""}`);
}
function hook(file: string, payload: object): string {
  const r = Bun.spawnSync([join(ROOT, "hooks", "bin", "run-hook.sh"), join(ROOT, "hooks", "src", file)], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)), env: hookEnv, cwd: T,
  });
  return r.stdout.toString();
}
type Result = { content: Array<{ text: string }>; isError?: boolean };
async function mcpSession<R>(fn: (call: (name: string, args: Record<string, unknown>) => Promise<any>) => Promise<R>): Promise<R> {
  const client = new Client({ name: "qa-continuity", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: manifest.mcpServers.memory.args.map(expand), cwd: repo, env: mcpEnv(), stderr: "ignore",
  }));
  try {
    return await fn(async (name, args) => {
      const r = (await client.callTool({ name, arguments: args })) as Result;
      if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
      return JSON.parse(r.content[0]!.text);
    });
  } finally { await client.close(); }
}
/** Every openltm.db under the sandbox, and any path still holding a `${…}` placeholder. */
function scan(): { dbs: string[]; placeholders: string[] } {
  const out = Bun.spawnSync(["find", T, "-not", "-path", `${home}/.bun/*`]).stdout.toString().split("\n").filter(Boolean);
  return { dbs: out.filter((p) => p.endsWith("/openltm.db")), placeholders: out.filter((p) => p.includes("${")) };
}
/** The development fallback (<plugin root>/data/openltm.db) — where a server that lost CLAUDE_PLUGIN_DATA writes. */
function devFallbackState(): string {
  const dir = join(ROOT, "data");
  if (!existsSync(dir)) return "absent";
  return readdirSync(dir).sort().map((f) => { const s = statSync(join(dir, f)); return `${f} ${s.size} ${s.mtimeMs}`; }).join("\n");
}
const devBefore = devFallbackState();

try {
  const first = hook("SessionStart.ts", { cwd: repo, session_id: "c1", source: "startup" });
  check("session 1: SessionStart registers the repo", first.includes("continuity-repo"), first);

  const learned = await mcpSession(async (call) => {
    const project = (await call("context", {})).project as string;
    const scoped = await call("learn", { title: "Continuity project memory", content: "Continuity: the retry queue drains oldest-first", category: "pattern", project });
    const global4 = await call("learn", { title: "Continuity global memory", content: "Continuity: always pin the toolchain in mise.toml", category: "preference", importance: 4 });
    const global3 = await call("learn", { title: "Continuity canary", content: "Continuity canary cedarlantern217 lives in the default database", category: "pattern" });
    await call("context_add", { type: "decision", content: "Continuity decision: one database for hooks and MCP" });
    return { project, scoped, global4, global3 };
  });
  check("MCP and hooks resolve the same project", learned.project === "continuity-repo", learned.project);
  check("learn reports the scope it stored (project / global / global)",
    learned.scoped.project_scope === "continuity-repo" && learned.global4.project_scope === null && learned.global3.project_scope === null, learned);

  const second = hook("SessionStart.ts", { cwd: repo, session_id: "c2", source: "startup" });
  check("session 2: index lists the project memory learned through MCP", second.includes(`[${learned.scoped.id}] Continuity project memory`), second);
  check("session 2: index lists the global importance-4 memory", second.includes(`[${learned.global4.id}] Continuity global memory`), second);
  check("session 2: a global importance-3 memory stays out of the index (by design)", !second.includes(`[${learned.global3.id}]`), second);
  check("session 2: restores the decision context_add stored", second.includes("Continuity decision: one database for hooks and MCP"), second);

  const recalled = await mcpSession((call) => call("recall", { query: "cedarlantern217" }));
  check("session 2: recall finds the global importance-3 memory", (recalled as Array<{ id: number }>).some((m) => m.id === learned.global3.id), recalled);
  const prompt = hook("UserPromptSubmit.ts", { cwd: repo, session_id: "c2", prompt: "where does the cedarlantern217 canary live?" });
  check("session 2: prompt recall surfaces it when the prompt asks", prompt.includes(`[${learned.global3.id}]`), prompt);

  const { dbs, placeholders } = scan();
  check("exactly one database in the sandbox, at $CLAUDE_PLUGIN_DATA/openltm.db", dbs.length === 1 && dbs[0] === join(data, "openltm.db"), dbs);
  check("no path named after an unexpanded ${…} placeholder", placeholders.length === 0, placeholders);
  check("the plugin checkout's dev-fallback DB (data/) was not touched", devFallbackState() === devBefore, devFallbackState());
} catch (e) {
  check("continuity smoke ran without throwing", false, e instanceof Error ? e.stack : e);
} finally {
  rmSync(T, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll continuity smoke checks passed." : `\n${failures} continuity smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
