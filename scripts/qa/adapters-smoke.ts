#!/usr/bin/env bun
/**
 * qa/adapters-smoke.ts — runs each non-Claude adapter the way its host does and
 * checks that every host names the same repo the same way:
 *   - Pi and OpenClaw: the BUILT dist bundles under real Node (their hosts run
 *     Node), with stub hosts, bridged to a real `mcp-serve` child over stdio.
 *   - OpenCode: its source under Bun (OpenCode runs Bun), with a stub host.
 *   - Claude Code: hooks/lib/resolveProject on the same directory.
 * Sandboxed (temp HOME + DB). Prints PASS/FAIL per check.
 *
 * Usage (repo root): bun run scripts/qa/adapters-smoke.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dir, "..", "..");
const T = mkdtempSync(join(tmpdir(), "ltm-adapters-smoke-"));
const home = join(T, "home");
const repo = join(T, "code", "Demo_Repo"); // mixed case + underscore: must normalise to demo-repo
const dbPath = join(T, "openltm.db");
for (const d of [home, join(repo, ".git"), join(repo, "src")]) mkdirSync(d, { recursive: true });
const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), LTM_DB_PATH: dbPath, LTM_EMBED_PROVIDER: "disabled" } as Record<string, string>;
delete env.CLAUDE_PLUGIN_DATA;
delete env.LTM_DATA_DIR;
const EXPECTED = "demo-repo";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      got: ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 700)}` : ""}`);
}

function build(pkg: string): string {
  const r = spawnSync(process.execPath, ["run", "build"], { cwd: join(ROOT, "packages", pkg), encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${pkg} build failed: ${r.stderr}`);
  return join(ROOT, "packages", pkg, "dist", "index.js");
}

function node(driver: string, cwd: string): any {
  const file = join(T, `driver-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, driver);
  const r = spawnSync("node", ["--no-warnings", file], { cwd, env, encoding: "utf-8", timeout: 90_000 });
  const last = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  try { return JSON.parse(last); } catch { return { error: `node exited ${r.status}: ${r.stdout}\n${r.stderr}` }; }
}

const UNTIL = `async function until(c, ms = 30000) { const t = Date.now(); while (!c()) { if (Date.now() - t > ms) throw new Error("bridge timeout"); await new Promise(r => setTimeout(r, 50)); } }`;

try {
  // ── Claude Code: the reference name ────────────────────────────────────────
  const claude = spawnSync(process.execPath, ["-e", `import { resolveProject } from ${JSON.stringify(join(ROOT, "hooks", "lib", "resolveProject.ts"))}; console.log(resolveProject(${JSON.stringify(join(repo, "src"))}).name);`],
    { env, encoding: "utf-8" }).stdout.trim();
  check(`Claude Code hooks name the repo "${EXPECTED}" (from a subfolder)`, claude === EXPECTED, claude);

  // ── Pi (built bundle, Node) ─────────────────────────────────────────────────
  const piDist = pathToFileURL(build("adapter-pi")).href;
  const pi = node(`${UNTIL}
    const { default: ext } = await import(${JSON.stringify(piDist)});
    const tools = new Map(), on = new Map();
    ext({ registerTool: (d) => tools.set(d.name, d), on: (e, h) => on.set(e, h) });
    await until(() => tools.has("learn") && tools.has("context_add"));
    const txt = async (n, p) => (await tools.get(n).execute("x", p)).content.map(c => c.text).join("\\n");
    const learned = JSON.parse(await txt("learn", { content: "Pi smoke: the Demo repo deploys via blue/green", category: "workflow", importance: 3, project: "${EXPECTED}" }));
    const inj = await on.get("before_agent_start")({ cwd: process.cwd(), systemPrompt: "BASE" });
    await on.get("session_compact")({ cwd: process.cwd(), summary: "Pi smoke compaction summary: wired blue/green deploys and wrote the rollback runbook." });
    const progress = await txt("context_items", { project: "${EXPECTED}", type: "progress" });
    console.log(JSON.stringify({ tools: [...tools.keys()].length, id: learned.id, prompt: inj?.systemPrompt ?? "", progress }));
    process.exit(0);`, repo);
  check("Pi (Node, dist) registers the MCP tools through the bridge", (pi.tools ?? 0) >= 12, pi);
  check(`Pi injects the memory under "Project (${EXPECTED})" from a mixed-case folder`, String(pi.prompt).includes(`Project (${EXPECTED}):`) && String(pi.prompt).includes(`[${pi.id}] Pi smoke`), pi.prompt ?? pi);
  check("Pi session_compact records progress via context_add", String(pi.progress).includes("Pi smoke compaction summary"), pi.progress ?? pi);

  // ── OpenClaw (built bundle, Node; SDK import stubbed via a loader hook) ─────
  const stub = join(T, "openclaw-plugin-entry.mjs");
  writeFileSync(stub, "export const definePluginEntry = (entry) => entry;\n");
  const hooks = join(T, "openclaw-hooks.mjs");
  writeFileSync(hooks, `export async function resolve(spec, ctx, next) { if (spec === "openclaw/plugin-sdk/plugin-entry") return { url: ${JSON.stringify(pathToFileURL(stub).href)}, shortCircuit: true }; return next(spec, ctx); }\n`);
  const ocDist = pathToFileURL(build("adapter-openclaw")).href;
  const oc = node(`import { register } from "node:module"; register(${JSON.stringify(pathToFileURL(hooks).href)});
    ${UNTIL}
    const { default: entry } = await import(${JSON.stringify(ocDist)});
    const tools = new Map(), preps = [];
    entry.register({ logger: { info() {}, warn() {}, error() {} }, pluginConfig: {}, registerTool: (t) => tools.set(t.name, t),
      registerMemoryPromptSupplement() {}, registerMemoryPromptPreparation: (p) => preps.push(p) });
    const txt = async (n, p) => (await tools.get(n).execute("x", p)).content.map(c => c.text).join("\\n");
    const learned = await txt("openltm_learn", { content: "OpenClaw smoke: Demo repo invoices are summed in integer cents", category: "gotcha", project: "${EXPECTED}" });
    const ctx = await txt("openltm_context", {});
    const lines = preps.length ? await preps[0]() : [];
    console.log(JSON.stringify({ tools: [...tools.keys()], learned, ctx, prefill: lines.join("\\n") }));
    process.exit(0);`, repo);
  check("OpenClaw (Node, dist) registers its 8 tools", Array.isArray(oc.tools) && oc.tools.length === 8, oc);
  check(`OpenClaw's context tool resolves "${EXPECTED}" from a mixed-case cwd`, String(oc.ctx).includes(`"project":"${EXPECTED}"`) || String(oc.ctx).includes("OpenClaw smoke"), oc.ctx ?? oc);
  check("OpenClaw prompt preparation injects Prior Knowledge", String(oc.prefill).includes("Prior Knowledge") && String(oc.prefill).includes("OpenClaw smoke"), oc.prefill ?? oc);

  // ── OpenCode (source, Bun) ──────────────────────────────────────────────────
  const opencode = spawnSync(process.execPath, ["-e", `
    const core = await import("@rohirik/openltm-core"); await core.waitForInit();
    const { plugin } = await import(${JSON.stringify(join(ROOT, "packages", "adapter-opencode", "src", "index.ts"))});
    const hooks = await plugin.server({ project: { path: ${JSON.stringify(repo)} }, sessionID: "oc" });
    const out = { system: [] }; await hooks["experimental.chat.system.transform"]({ sessionID: "oc" }, out);
    console.log(JSON.stringify({ system: out.system.join("\\n"), name: core.deriveProjectFromCwd(${JSON.stringify(repo)}) }));`],
    { env, cwd: ROOT, encoding: "utf-8" });
  const ocode = (() => { try { return JSON.parse(opencode.stdout.trim().split("\n").pop()!); } catch { return { error: opencode.stdout + opencode.stderr }; } })();
  check(`OpenCode names the repo "${EXPECTED}" and injects its memories`, ocode.name === EXPECTED && String(ocode.system).includes("Pi smoke"), ocode);
} catch (err) {
  failures++;
  console.log(`FAIL  smoke run threw: ${err}`);
} finally {
  rmSync(T, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll adapter smoke checks passed." : `\n${failures} adapter smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
