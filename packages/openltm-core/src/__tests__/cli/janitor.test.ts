/**
 * janitor.test.ts — `ltm janitor` CLI: parsing, exit codes, lock, and the
 * no-server path (runs with graph-server, llama-server, and Ollama all down).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";

// ── Arg parsing (pure) ────────────────────────────────────────────────────────

describe("cli/janitor — parseJanitorArgs", () => {
  it("parses run flags", async () => {
    const { parseJanitorArgs } = await import("../../cli/janitor.js");
    const p = parseJanitorArgs(["run", "--db", "/x/ltm.db", "--if-due", "--interval-minutes", "90", "--max-minutes", "5", "--json"]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.command).toBe("run");
    expect(p.dbPath).toBe("/x/ltm.db");
    expect(p.ifDue).toBe(true);
    expect(p.intervalMinutes).toBe(90);
    expect(p.maxMinutes).toBe(5);
    expect(p.json).toBe(true);
  });

  it("schedule takes a kind positional and defaults per platform", async () => {
    const { parseJanitorArgs } = await import("../../cli/janitor.js");
    const p = parseJanitorArgs(["schedule", "cron", "--check-minutes", "30"]);
    expect(p.ok && p.scheduleKind).toBe("cron");
    expect(p.ok && p.checkMinutes).toBe(30);
    const d = parseJanitorArgs(["schedule"]);
    expect(d.ok && d.scheduleKind).toBe(process.platform === "darwin" ? "launchd" : "systemd");
  });

  it("rejects bad input", async () => {
    const { parseJanitorArgs } = await import("../../cli/janitor.js");
    expect(parseJanitorArgs([]).ok).toBe(false);
    expect(parseJanitorArgs(["nuke"]).ok).toBe(false);
    expect(parseJanitorArgs(["run", "--interval-minutes", "0"]).ok).toBe(false);
    expect(parseJanitorArgs(["run", "--interval-minutes", "abc"]).ok).toBe(false);
    expect(parseJanitorArgs(["run", "--db"]).ok).toBe(false);
    expect(parseJanitorArgs(["run", "--frobnicate"]).ok).toBe(false);
    expect(parseJanitorArgs(["schedule", "windows-task"]).ok).toBe(false);
    expect(parseJanitorArgs(["run", "extra"]).ok).toBe(false);
  });
});

// ── In-process: full pipeline with every server down ──────────────────────────

describe("cli/janitor — run with no servers (in-process)", () => {
  let dir: string;
  let dbPath: string;
  let db: Database;
  const urls: string[] = [];
  const prevFetch = globalThis.fetch;
  const prevLlama = process.env.LTM_LLAMA_CPP_URL;
  let ids: number[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ltm-janitor-cli-"));
    dbPath = join(dir, "ltm.db");
    process.env.LTM_LLAMA_CPP_URL = "http://127.0.0.1:9";
    const { resetLlamaCppProbeForTesting } = await import("../../providers/llamacpp.js");
    resetLlamaCppProbeForTesting();
    // Every network call fails, as if nothing were listening. Record targets.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input instanceof Request ? input.url : input));
      throw new Error("ECONNREFUSED (test: no servers)");
    }) as typeof fetch;

    const { initDb, _setDbForTesting } = await import("../../shared-db.js");
    db = await initDb({ dbPath });
    _setDbForTesting(db);
    const { learn } = await import("../../db.js");
    ids = [
      learn({ content: "Janitor CLI test: always enable WAL mode on SQLite", category: "pattern" }).id,
      learn({ content: "Janitor CLI test: SQLite should run in WAL journal mode", category: "pattern" }).id,
      learn({ content: "Janitor CLI test: docker hub rate limits anonymous pulls", category: "gotcha" }).id,
    ];
    // Two near-identical vectors and one orthogonal one → exactly one dedup pair.
    const same = new Float32Array(1024).fill(0.5);
    const other = new Float32Array(1024).map((_, i) => (i % 2 === 0 ? 1 : -1));
    const put = db.prepare("INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, dim) VALUES (?, ?, 'bge-m3', 1024)");
    put.run(ids[0]!, Buffer.from(same.buffer));
    put.run(ids[1]!, Buffer.from(same.buffer));
    put.run(ids[2]!, Buffer.from(other.buffer));
  });

  afterAll(() => {
    globalThis.fetch = prevFetch;
    if (prevLlama === undefined) delete process.env.LTM_LLAMA_CPP_URL;
    else process.env.LTM_LLAMA_CPP_URL = prevLlama;
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs the full pipeline, exits 0, and queues dedup as a suggestion only", async () => {
    const { parseJanitorArgs, runJanitorCommand } = await import("../../cli/janitor.js");
    const parsed = parseJanitorArgs(["run", "--db", dbPath, "--json"]);
    if (!parsed.ok) throw new Error(parsed.error);
    const res = await runJanitorCommand(parsed);
    const out = JSON.parse(res.output);
    expect(out.errors).toEqual([]);
    expect(res.exitCode).toBe(0);
    expect(out.dbPath).toBe(dbPath);
    expect(out.embed.embedded).toBe(0); // llama-server down → nothing written, nothing over-reported
    expect(out.dedup.candidatesFound).toBe(1);

    // Suggest-only: originals untouched, one pending review row.
    const statuses = db.query<{ status: string }, []>(`SELECT status FROM memories WHERE id IN (${ids.join(",")})`).all();
    expect(statuses.every((s) => s.status === "active")).toBe(true);
    const pending = db.query<{ source: string }, []>("SELECT source FROM memories WHERE status = 'pending' AND source LIKE 'dedup:%'").all();
    expect(pending.map((p) => p.source)).toEqual([`dedup:${ids[0]}:${ids[1]}`]);

    // Lock released, run recorded.
    expect(existsSync(`${dbPath}.janitor.lock`)).toBe(false);
    const last = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'ltm.janitor.lastRunAt'").get();
    expect(last?.value).toBe(out.timestamp);
  });

  it("never talks to graph-server — only local provider endpoints are attempted", () => {
    expect(urls.some((u) => /:7331|:7332|\/api\/janitor/.test(u))).toBe(false);
    expect(urls.every((u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u))).toBe(true);
  });

  it("--if-due skips a run that is not due", async () => {
    const { parseJanitorArgs, runJanitorCommand } = await import("../../cli/janitor.js");
    const parsed = parseJanitorArgs(["run", "--db", dbPath, "--if-due", "--json"]);
    if (!parsed.ok) throw new Error(parsed.error);
    const res = await runJanitorCommand(parsed);
    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.output);
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe("not-due");
    expect(out.intervalMinutes).toBe(360);
  });

  it("status reports last run, pending suggestions, and a free lock", async () => {
    const { parseJanitorArgs, runJanitorCommand } = await import("../../cli/janitor.js");
    const parsed = parseJanitorArgs(["status", "--db", dbPath, "--json"]);
    if (!parsed.ok) throw new Error(parsed.error);
    const res = await runJanitorCommand(parsed);
    expect(res.exitCode).toBe(0);
    const s = JSON.parse(res.output);
    expect(s.due).toBe(false);
    expect(s.pendingDedupSuggestions).toBe(1);
    expect(s.lock.held).toBe(false);
  });

  it("fails closed with exit 4 while another run holds the lock", async () => {
    const { parseJanitorArgs, runJanitorCommand, JANITOR_EXIT } = await import("../../cli/janitor.js");
    const lockPath = `${dbPath}.janitor.lock`;
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
    try {
      const parsed = parseJanitorArgs(["run", "--db", dbPath, "--json"]);
      if (!parsed.ok) throw new Error(parsed.error);
      const res = await runJanitorCommand(parsed);
      expect(res.exitCode).toBe(JANITOR_EXIT.LOCKED);
      expect(JSON.parse(res.output).error).toBe("locked");
      expect(existsSync(lockPath)).toBe(true); // someone else's lock is left alone
    } finally {
      rmSync(lockPath, { force: true });
    }
  });
});

// ── Subprocess: the real `ltm` binary, nothing listening ──────────────────────

describe("cli/janitor — ltm binary (subprocess)", () => {
  let dir: string;
  let bin: string;
  const env: Record<string, string> = {};

  function ltm(args: string[], extraEnv: Record<string, string> = {}): { code: number; stdout: string; stderr: string } {
    const r = Bun.spawnSync([process.execPath, bin, ...args], { env: { ...env, ...extraEnv }, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ltm-janitor-bin-"));
    bin = (await import("../../cli/janitor.js")).LTM_BIN_PATH;
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !["LTM_DB_PATH", "CLAUDE_PLUGIN_DATA", "LTM_JANITOR_ON_SESSION_END", "LTM_JANITOR_INTERVAL_MINUTES"].includes(k)) env[k] = v;
    }
    env.LTM_LLAMA_CPP_URL = "http://127.0.0.1:9";
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("exit 3 when the database does not exist (and does not create it)", () => {
    const missing = join(dir, "missing.db");
    const r = ltm(["janitor", "run", "--db", missing]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("database not found");
    expect(existsSync(missing)).toBe(false);
    expect(ltm(["janitor", "status", "--db", missing]).code).toBe(3);
  });

  it("exit 1 on usage errors", () => {
    expect(ltm(["janitor", "explode"]).code).toBe(1);
    expect(ltm(["janitor"]).code).toBe(1);
  });

  it("exit 0 for a full run with every server down; honours LTM_DB_PATH", () => {
    const dbPath = join(dir, "env.db");
    expect(ltm(["memory", "learn", "--text", "subprocess janitor memory"], { LTM_DB_PATH: dbPath }).code).toBe(0);
    const r = ltm(["janitor", "run", "--json"], { LTM_DB_PATH: dbPath });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.dbPath).toBe(dbPath);
    expect(out.errors).toEqual([]);
  });

  it("exit 4 when the lock is held by a live process", () => {
    const dbPath = join(dir, "locked.db");
    ltm(["memory", "learn", "--text", "locked janitor memory"], { LTM_DB_PATH: dbPath });
    writeFileSync(`${dbPath}.janitor.lock`, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
    const r = ltm(["janitor", "run", "--db", dbPath]);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("holds");
  });

  it("schedule renders a unit with the resolved DB path and fails closed without a DB", () => {
    const dbPath = join(dir, "env.db");
    const r = ltm(["janitor", "schedule", "cron", "--db", dbPath, "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.activate.join("\n")).toContain(`LTM_DB_PATH=${dbPath}`);
    expect(ltm(["janitor", "schedule", "cron", "--db", join(dir, "nope.db")]).code).toBe(3);
  });

  it("hook --name SessionEnd spawns a detached run that curates the DB", async () => {
    const sub = mkdtempSync(join(dir, "hook-"));
    const dbPath = join(sub, "ltm.db");
    ltm(["memory", "learn", "--text", "session end hook memory"], { LTM_DB_PATH: dbPath });
    const r = Bun.spawnSync([process.execPath, bin, "hook", "--name", "SessionEnd"], {
      env: { ...env, LTM_DB_PATH: dbPath }, stdin: new TextEncoder().encode("{}"), stdout: "pipe", stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe(""); // nothing injected into the session
    const log = join(sub, "janitor.log");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(existsSync(log) && readFileSync(log, "utf-8").includes("janitor"))) {
      await Bun.sleep(100);
    }
    expect(readFileSync(log, "utf-8")).toMatch(/janitor (ok|skipped)/);
  });
});

// ── spawnJanitorDetached guards ───────────────────────────────────────────────

describe("cli/janitor — spawnJanitorDetached", () => {
  it("respects LTM_JANITOR_ON_SESSION_END=0", async () => {
    const { spawnJanitorDetached } = await import("../../cli/janitor.js");
    expect(spawnJanitorDetached({ dbPath: "/nonexistent/x.db", env: { LTM_JANITOR_ON_SESSION_END: "0" } })).toEqual({ spawned: false, reason: "disabled" });
  });

  it("does nothing when the DB is missing", async () => {
    const { spawnJanitorDetached } = await import("../../cli/janitor.js");
    expect(spawnJanitorDetached({ dbPath: join(tmpdir(), `ltm-none-${Date.now()}.db`), env: {} })).toEqual({ spawned: false, reason: "no-db" });
  });
});
