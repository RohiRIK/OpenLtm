#!/usr/bin/env bun
/**
 * qa/server-smoke.ts — starts the graph server (port 7331) in a throwaway
 * sandbox and checks its network guards: loopback bind, Host/Origin allowlists,
 * JSON-only mutations, secret masking, /api/reveal confinement, SIGTERM exit.
 * Prints PASS/FAIL per check. Port 7331 must be free.
 *
 * Usage (repo root): bun run scripts/qa/server-smoke.ts
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const BASE = "http://127.0.0.1:7331";
const T = mkdtempSync(join(tmpdir(), "ltm-server-smoke-"));
const dbPath = join(T, "openltm.db");
const KEY = "sk-qa-REALKEY-abcdefgh-9876";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      got: ${String(detail).slice(0, 400)}` : ""}`);
}
const req = (path: string, init: RequestInit = {}) => fetch(BASE + path, init).then(async (r) => ({ status: r.status, body: await r.text() }));

const server = Bun.spawn([process.execPath, "run", join(ROOT, "src", "graph-server.ts")], {
  env: { ...process.env, HOME: T, CLAUDE_CONFIG_DIR: join(T, ".claude"), LTM_DB_PATH: dbPath, CLAUDE_PLUGIN_DATA: T, LTM_EMBED_PROVIDER: "disabled" },
  stdout: "ignore", stderr: "ignore",
});

try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    up = await fetch(BASE + "/api/stats").then((r) => r.ok, () => false);
    if (!up) await Bun.sleep(250);
  }
  check("server starts and answers GET /api/stats", up);

  const listeners = readFileSync("/proc/net/tcp", "utf-8").split("\n").filter((l) => l.includes(":1CA3 ") && l.includes(" 0A "));
  check("listens on 127.0.0.1 only (not 0.0.0.0)", listeners.length > 0 && listeners.every((l) => l.includes("0100007F:1CA3")), listeners.join("\n"));

  check("Host: evil.com → 403", (await req("/api/stats", { headers: { Host: "evil.com" } })).status === 403);
  check("X-Forwarded-Host: evil.com → 403", (await req("/api/stats", { headers: { "X-Forwarded-Host": "evil.com:7332" } })).status === 403);
  check("cross-origin text/plain POST → 403", (await req("/api/memory/merge", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "text/plain" }, body: "{}" })).status === 403);
  check("same-origin text/plain POST → 415", (await req("/api/memory/merge", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" })).status === 415);

  const put = await req("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "ltm.openai.apiKey": KEY }) });
  check("PUT /api/settings with JSON accepted", put.status === 200, put.body);
  const got = await req("/api/settings");
  const masked = (JSON.parse(got.body) as Record<string, string>)["ltm.openai.apiKey"];
  check("GET /api/settings masks the API key", !got.body.includes(KEY) && typeof masked === "string" && masked.endsWith("9876"), masked);
  await req("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: got.body });
  const stored = new Database(dbPath, { readonly: true }).query<{ value: string }, []>("SELECT value FROM settings WHERE key='ltm.openai.apiKey'").get()?.value;
  check("PUTting the masked settings back keeps the real key", stored === KEY, stored);

  // Another process (e.g. `ltm janitor run`) holds the janitor lock → the server must not run a second janitor.
  writeFileSync(dbPath + ".janitor.lock", JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
  const busy = await req("/api/janitor/run", { method: "POST", headers: { "Content-Type": "application/json" } });
  check("POST /api/janitor/run → 409 while another process holds the janitor lock", busy.status === 409, busy);
  rmSync(dbPath + ".janitor.lock", { force: true });

  // The GET route for /api/memory/:id used to answer every method, so the UI's
  // edit (PUT) and delete (DELETE) returned 200 and changed nothing.
  const rw = new Database(dbPath);
  const ins = (content: string) => Number(rw.run("INSERT INTO memories (content, category, importance, dedup_key) VALUES (?, 'pattern', 3, ?)", [content, `smoke-${content}`]).lastInsertRowid);
  const editId = ins("server smoke: memory to edit");
  const delId = ins("server smoke: memory to delete");
  const edit = await req(`/api/memory/${editId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `edited with key ${"AKIA" + "IOSFODNN7EXAMPLE"}` }) });
  const edited = rw.query<{ content: string }, [number]>("SELECT content FROM memories WHERE id=?").get(editId)?.content ?? "";
  check("PUT /api/memory/:id edits the memory and scrubs secrets", edit.status === 200 && edited.startsWith("edited with key") && !edited.includes("IOSFODNN7EXAMPLE"), edited);
  const del = await req(`/api/memory/${delId}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
  check("DELETE /api/memory/:id deletes the memory", del.status === 200 && !rw.query("SELECT 1 FROM memories WHERE id=?").get(delId), del);
  rw.close();

  check("/api/reveal outside the DB dir → 403", (await req("/api/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/etc/passwd" }) })).status === 403);
} catch (err) {
  failures++;
  console.log(`FAIL  smoke run threw: ${err}`);
} finally {
  server.kill("SIGTERM");
  const exited = await Promise.race([server.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
  check("server exits on SIGTERM", exited);
  if (!exited) server.kill("SIGKILL");
  rmSync(T, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll server smoke checks passed." : `\n${failures} server smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
