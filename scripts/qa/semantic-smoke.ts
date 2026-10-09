#!/usr/bin/env bun
/**
 * qa/semantic-smoke.ts — exercises the semantic (embedding) path end-to-end
 * against a deterministic local stand-in for llama-server's OpenAI-compatible
 * /v1/embeddings endpoint (hashed bag-of-words vectors: texts that share words
 * are close). Tests our pipeline — backfill, hybrid recall, SessionStart's
 * semantic branch, provider-down and provider-slow fallbacks — not model quality.
 * Sandboxed; never touches the real ~/.claude. Prints PASS/FAIL per check.
 *
 * Usage (repo root): bun run scripts/qa/semantic-smoke.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const DIM = 256;
let delayMs = 0;

function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3) continue;
    let h = 2166136261;
    for (const ch of w.slice(0, 6)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; // 6-char stem
    v[h % DIM]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

const stub = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname === "/v1/embeddings" && req.method === "POST") {
      if (delayMs) await Bun.sleep(delayMs);
      const body = (await req.json()) as { input: string | string[]; model?: string };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({ object: "list", model: body.model ?? "stub", data: inputs.map((t, i) => ({ object: "embedding", index: i, embedding: embed(t) })) });
    }
    return new Response("not found", { status: 404 });
  },
});

const T = mkdtempSync(join(tmpdir(), "ltm-semantic-smoke-"));
const home = join(T, "home"), data = join(T, "data"), repo = join(T, "code", "shop-api");
for (const d of [home, data, join(repo, ".git")]) mkdirSync(d, { recursive: true });
const env = (url: string): Record<string, string> => ({
  ...process.env as Record<string, string>, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
  CLAUDE_PLUGIN_DATA: data, CLAUDE_PLUGIN_ROOT: ROOT, LTM_DB_PATH: join(data, "openltm.db"),
  LTM_LLAMA_CPP_URL: url, LTM_EMBED_PROVIDER: "llamacpp", TMPDIR: T,
});
const UP = `http://127.0.0.1:${stub.port}`;
const DOWN = "http://127.0.0.1:9";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      got: ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 700)}` : ""}`);
}
/** Run a snippet inside the sandbox with core loaded as `c`; returns its JSON stdout. */
async function core(code: string, url = UP): Promise<any> {
  const p = Bun.spawn([process.execPath, "-e", `const c = await import("@rohirik/openltm-core"); await c.waitForInit(); const out = await (async () => { ${code} })(); console.log(JSON.stringify(out));`],
    { env: env(url), cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  const last = out.trim().split("\n").pop() ?? "";
  try { return JSON.parse(last); } catch { throw new Error(`core() output not JSON: ${out}\n${err}`); }
}
async function hook(file: string, payload: object, url = UP): Promise<string> {
  const p = Bun.spawn([process.execPath, "run", join(ROOT, "hooks", "src", file)], { env: env(url), cwd: T, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}

const MEMORIES = [
  { content: "Payments client retries idempotent POST requests with an Idempotency-Key header and exponential backoff", category: "gotcha", importance: 4 },
  { content: "Database migrations run through the migrations folder with a migration_history table, never ad-hoc ALTERs", category: "architecture", importance: 4 },
  { content: "The checkout service caches product prices in Redis for sixty seconds", category: "architecture", importance: 3, project_scope: "shop-api" },
  { content: "Prefer bun over npm for scripts in every repository", category: "preference", importance: 5 },
  { content: "Webhook signatures are verified with HMAC SHA256 before parsing the payload", category: "constraint", importance: 4, project_scope: "shop-api" },
];

try {
  await core(`return ${JSON.stringify(MEMORIES)}.map((m) => c.learn({ ...m, skipExport: true }).id);`);
  const stored = await core(`return c.getDb().query("SELECT COUNT(*) n FROM memory_embeddings").get().n;`);
  check(`learn embedded every memory while the provider was up (${stored}/${MEMORIES.length})`, stored === MEMORIES.length, stored);

  // The stub's vectors are bag-of-words, so the query shares stems with its target.
  const hybrid = await core(`return (await c.recall({ query: "payments client retries POST requests backoff" })).map((m) => ({ id: m.id, content: m.content.slice(0, 40), sem: m.explainer?.semanticScore ?? null }));`);
  check("hybrid recall ranks the payments memory first", String(hybrid[0]?.content).startsWith("Payments client"), hybrid);
  check("hybrid recall used semantic scores", hybrid.some((m: any) => typeof m.sem === "number" && m.sem > 0), hybrid);

  const ftsOnly = await core(`return (await c.recall({ query: "payments client retries POST requests backoff", semantic: false })).map((m) => ({ content: m.content.slice(0, 40), sem: m.explainer?.semanticScore ?? null }));`);
  check("semantic:false returns no semantic scores", ftsOnly.every((m: any) => m.sem === null), ftsOnly);

  // SessionStart's semantic branch: the project summary is embedded as the query.
  await hook("SessionStart.ts", { cwd: repo, session_id: "s0", source: "startup" });
  await core(`c.upsertGoal("shop-api", "Ship idempotent payment retries and webhook signature checks"); await new Promise(r => setTimeout(r, 200)); return true;`);
  const ss = await hook("SessionStart.ts", { cwd: repo, session_id: "s1", source: "resume" });
  check("SessionStart (provider up) injects the LTM index", ss.includes("LTM index") && /- \[\d+\]/.test(ss), ss);

  const ssDown = await hook("SessionStart.ts", { cwd: repo, session_id: "s2", source: "resume" }, DOWN);
  check("SessionStart (provider down) still injects the LTM index", ssDown.includes("LTM index") && /- \[\d+\]/.test(ssDown), ssDown);

  const down = await core(`return (await c.recall({ query: "how do we retry payment calls safely" })).map((m) => m.content.slice(0, 40));`, DOWN);
  check("recall with provider down falls back to full-text", String(down[0]).startsWith("Payments client"), down);

  delayMs = 5000;
  // Timed inside the process: a long-lived MCP server answers at the timeout even
  // though the abandoned fetch keeps a one-shot process alive until it settles.
  const { ms, slow } = await core(`const t0 = performance.now(); const r = await c.recall({ query: "payments client retries POST requests backoff" }); return { ms: performance.now() - t0, slow: r.map((m) => m.content.slice(0, 40)) };`);
  delayMs = 0;
  check(`recall with a slow provider gives up in time (${Math.round(ms)}ms) and still answers`, ms < 4500 && String(slow[0]).startsWith("Payments client"), { ms, slow });
} catch (err) {
  failures++;
  console.log(`FAIL  smoke run threw: ${err}`);
} finally {
  stub.stop(true);
  rmSync(T, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll semantic smoke checks passed." : `\n${failures} semantic smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
