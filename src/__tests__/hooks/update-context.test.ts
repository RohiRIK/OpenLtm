/**
 * UpdateContext (Stop hook — fires after every assistant turn), run as a subprocess
 * with HOME / CLAUDE_PLUGIN_DATA / LTM_DB_PATH pointed at temp dirs so nothing
 * touches the real ~/.claude.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const HOOK_SCRIPT = join(PROJECT_ROOT, "hooks", "src", "UpdateContext.ts");
const SCHEMA_PATH = join(PROJECT_ROOT, "src", "schema.sql");

let tmp: string;
let home: string;
let pluginData: string;
let dbPath: string;
const workCwd = "/tmp/ltm-update-context-test-project";

type Entry = Record<string, unknown>;
const userMsg = (text: string): Entry => ({ type: "user", message: { role: "user", content: text } });
const assistantMsg = (text: string): Entry => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const toolUse = (name: string, input: Record<string, unknown>): Entry => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id: `t-${Math.random()}`, name, input }] },
});

function writeTranscript(name: string, entries: Entry[]): string {
  const path = join(tmp, `${name}.jsonl`);
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

async function runHook(payload: Record<string, unknown>, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT], {
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home, CLAUDE_PLUGIN_DATA: pluginData, LTM_DB_PATH: dbPath, ...env },
    cwd: PROJECT_ROOT,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

function progressRows(): Array<{ project_name: string; content: string; session_id: string | null }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query<{ project_name: string; content: string; session_id: string | null }, []>(
      `SELECT project_name, content, session_id FROM context_items WHERE type='progress' ORDER BY id`
    ).all();
  } finally {
    db.close();
  }
}

function findFiles(root: string, name: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    if (statSync(p).isDirectory()) found.push(...findFiles(p, name));
    else if (entry === name) found.push(p);
  }
  return found;
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ltm-update-context-"));
  home = join(tmp, "home");
  pluginData = join(tmp, "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(pluginData, { recursive: true });
  dbPath = join(pluginData, "openltm.db");

  const { runPendingMigrations } = await import("@rohirik/openltm-core");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await runPendingMigrations(db);
  db.close();
}, 30_000);

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("UpdateContext hook (Stop)", () => {
  it("writes nothing to stdout and keeps one progress row per session across turns", async () => {
    const base = [userMsg("hello"), assistantMsg("hi"), userMsg("edit a file")];

    const earlier = writeTranscript("sess-earlier", [...base, toolUse("Edit", { file_path: "/repo/earlier.ts" })]);
    const first = await runHook({ cwd: workCwd, session_id: "earlier-session-0001", transcript_path: earlier, hook_event_name: "Stop" });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe("");

    // Three turns of the current session — the transcript grows each turn.
    const turns: Entry[] = [...base];
    for (const file of ["a.ts", "b.ts", "c.ts"]) {
      turns.push(toolUse("Write", { file_path: `/repo/${file}`, content: "x" }));
      const path = writeTranscript("sess-current", turns);
      const run = await runHook({ cwd: workCwd, session_id: "current-session-0002", transcript_path: path, hook_event_name: "Stop" });
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
    }

    const rows = progressRows();
    const earlierRows = rows.filter(r => r.session_id === "earlier-session-0001");
    const currentRows = rows.filter(r => r.session_id === "current-session-0002");
    expect(earlierRows).toHaveLength(1);
    expect(earlierRows[0]!.content).toContain("/repo/earlier.ts");
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]!.content).toContain("[current-]");
    expect(currentRows[0]!.content).toContain("/repo/a.ts, /repo/b.ts, /repo/c.ts");
  }, 60_000);

  it("does nothing when transcript_path is missing (no history.jsonl fallback)", async () => {
    // A history.jsonl that the old fallback would have followed.
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "history.jsonl"), JSON.stringify({ sessionId: "hist-session", project: workCwd }) + "\n");
    const before = progressRows().length;

    const run = await runHook({ cwd: workCwd, session_id: "no-transcript-session" });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(progressRows().length).toBe(before);
  }, 30_000);

  it("falls back to context-progress.md with one line per session when the DB is absent", async () => {
    const missingDb = join(tmp, "absent", "openltm.db");
    const turns: Entry[] = [userMsg("a"), assistantMsg("b"), userMsg("c")];
    for (const file of ["one.ts", "two.ts"]) {
      turns.push(toolUse("Edit", { file_path: `/repo/${file}` }));
      const path = writeTranscript("sess-md", turns);
      const run = await runHook(
        { cwd: "/tmp/ltm-update-context-md-project", session_id: "mdsess01-0000", transcript_path: path },
        { LTM_DB_PATH: missingDb },
      );
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
    }

    const files = [...findFiles(home, "context-progress.md"), ...findFiles(pluginData, "context-progress.md")];
    expect(files).toHaveLength(1);
    const lines = readFileSync(files[0]!, "utf-8").split("\n").filter(Boolean);
    const sessionLines = lines.filter(l => l.includes("[mdsess01]"));
    expect(sessionLines).toHaveLength(1);
    expect(sessionLines[0]).toContain("/repo/one.ts, /repo/two.ts");
    expect(existsSync(missingDb)).toBe(false);
  }, 60_000);
});
