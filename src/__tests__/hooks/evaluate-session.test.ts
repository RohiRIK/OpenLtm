/**
 * EvaluateSession (SessionEnd hook), run as a subprocess with HOME /
 * CLAUDE_PLUGIN_DATA / CLAUDE_PLUGIN_ROOT / LTM_DB_PATH pointed at temp dirs so
 * nothing touches the real ~/.claude.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const HOOK_SCRIPT = join(PROJECT_ROOT, "hooks", "src", "EvaluateSession.ts");

let tmp: string;
let home: string;
let pluginData: string;
let pluginRoot: string;

type Entry = Record<string, unknown>;
const userMsg = (text: string): Entry => ({ type: "user", message: { role: "user", content: text } });
const toolUse = (name: string, input: Record<string, unknown>): Entry => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id: `t-${Math.random()}`, name, input }] },
});
const toolError = (content: unknown): Entry => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content }] },
});

const REAL_ERROR = "Exit code 1\nerror: Cannot find module 'left-pad' from '/repo/src/index.ts'";
const JUNK_ERRORS = [
  "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
  "<tool_use_error>String to replace not found in file.\nString: const x = 1;</tool_use_error>",
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
  "[Request interrupted by user for tool use]",
  "Permission to use Bash with command rm -rf /repo/build has been denied.",
  "Claude requested permissions to use Bash, but you haven't granted it yet.",
  "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Irreversible Local Destruction]. If you have other tasks that don't depend on this action, continue working on them.",
  "Exit code 1",
];

function writeTranscript(name: string, entries: Entry[]): string {
  const path = join(tmp, `${name}.jsonl`);
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

async function runHook(payload: Record<string, unknown>) {
  const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT], {
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      LTM_DB_PATH: join(pluginData, "openltm.db"),
      TMPDIR: tmp,
    },
    cwd: PROJECT_ROOT,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ltm-evaluate-session-"));
  home = join(tmp, "home");
  pluginData = join(tmp, "data");
  pluginRoot = join(tmp, "plugin-root");
  for (const dir of [home, pluginData, pluginRoot]) mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("EvaluateSession hook (SessionEnd)", () => {
  const sessionId = "evalsess-1111-2222-3333";
  const shortId = sessionId.substring(0, 8);

  it("writes learned files under the plugin data dir, not the plugin root, and nothing to stdout", async () => {
    const transcript = writeTranscript("eval", [
      userMsg("fix the build"),
      toolUse("Edit", { file_path: "/repo/src/index.ts" }),
      ...JUNK_ERRORS.map(toolError),
      toolError(REAL_ERROR),
      toolError([{ type: "text", text: REAL_ERROR }]), // duplicate in array form
      toolUse("Bash", { command: "bun test" }),
    ]);

    const run = await runHook({
      session_id: sessionId,
      transcript_path: transcript,
      cwd: "/tmp/ltm-evaluate-session-project",
      hook_event_name: "SessionEnd",
      reason: "exit",
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");

    // Nothing written into the plugin install dir.
    expect(readdirSync(pluginRoot)).toEqual([]);

    const patternsDir = join(pluginData, "learned", "patterns");
    const patternFiles = readdirSync(patternsDir);
    expect(patternFiles).toHaveLength(1);
    expect(patternFiles[0]).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${shortId}\\.md$`));
    const pattern = readFileSync(join(patternsDir, patternFiles[0]!), "utf-8");
    expect(pattern).toContain(`**Session ID:** ${sessionId}`);
    expect(pattern).toContain("Cannot find module 'left-pad'");
    expect(pattern).toContain("- /repo/src/index.ts");
    expect(pattern).not.toContain("tool_use_error");

    const summary = readFileSync(join(pluginData, "learned", "summary.md"), "utf-8");
    expect(summary).toContain(`Session ${shortId}`);
    expect(summary).toContain("(Errors: 1)");
  }, 30_000);

  it("queues only real, deduplicated errors as proposals", async () => {
    const proposalsPath = join(pluginData, "proposals", `${sessionId}.json`);
    expect(existsSync(proposalsPath)).toBe(true);
    const { proposals } = JSON.parse(readFileSync(proposalsPath, "utf-8")) as {
      proposals: Array<{ content: string; category: string; source: string }>;
    };
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.content).toBe(REAL_ERROR.replace(/\s+/g, " "));
    expect(proposals[0]!.category).toBe("gotcha");
    expect(proposals[0]!.source).toBe("evaluate-session");
  });

  it("does not duplicate the summary line when a session ends twice", async () => {
    const transcript = join(tmp, "eval.jsonl");
    const run = await runHook({ session_id: sessionId, transcript_path: transcript, cwd: "/tmp/ltm-evaluate-session-project" });
    expect(run.exitCode).toBe(0);
    const summary = readFileSync(join(pluginData, "learned", "summary.md"), "utf-8");
    expect(summary.split(`Session ${shortId}`).length - 1).toBe(1);
  }, 30_000);

  it("writes no proposals file when every error is noise", async () => {
    const transcript = writeTranscript("eval-noise", [
      userMsg("hi"),
      toolUse("Read", { file_path: "/repo/a.ts" }),
      ...JUNK_ERRORS.map(toolError),
    ]);
    const run = await runHook({ session_id: "noisesess-0000", transcript_path: transcript, cwd: "/tmp/ltm-evaluate-session-project" });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(existsSync(join(pluginData, "proposals", "noisesess-0000.json"))).toBe(false);
  }, 30_000);

  it("skips short sessions and missing transcripts", async () => {
    const short = writeTranscript("eval-short", [userMsg("hi"), userMsg("bye")]);
    const shortRun = await runHook({ session_id: "shortsess-0000", transcript_path: short, cwd: "/tmp/x" });
    const missingRun = await runHook({ session_id: "missing-0000", cwd: "/tmp/x" });
    expect(shortRun.exitCode).toBe(0);
    expect(missingRun.exitCode).toBe(0);
    const patternFiles = readdirSync(join(pluginData, "learned", "patterns"));
    expect(patternFiles.some(f => f.includes("shortses") || f.includes("missing-"))).toBe(false);
  }, 30_000);

  it("removes UserPromptSubmit's per-session dedupe state when the session ends", async () => {
    const state = join(tmp, "ltm-prompt-recall-endsess-4444.json");
    writeFileSync(state, JSON.stringify([1, 2, 3]));
    const run = await runHook({ session_id: "endsess-4444", cwd: "/tmp/x" });
    expect(run.exitCode).toBe(0);
    expect(existsSync(state)).toBe(false);
  }, 30_000);
});
