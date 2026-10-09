/**
 * UserPromptSubmit: per-prompt FTS recall — skip rules, scoping/filters,
 * per-session dedupe, output format.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  formatPromptRecall, promptRecallLimit, promptSkipReason, queryTokens, MAX_CONTENT_CHARS,
} from "../../../hooks/lib/promptRecall";
import {
  initSandboxDb, makeSandbox, registerProject, runHook, seedMemory, writeConfig, type Sandbox,
} from "./hookHarness";

describe("promptRecall helpers", () => {
  it("skip rules: disabled flags, slash commands, short prompts", () => {
    const long = "why does the sqlite busy timeout matter here";
    expect(promptSkipReason(long, {})).toBeNull();
    expect(promptSkipReason(long, { ltm: { autoRecall: false } } as never)).toBe("autoRecall disabled");
    expect(promptSkipReason(long, { ltm: { promptRecall: false } } as never)).toBe("promptRecall disabled");
    expect(promptSkipReason("/openltm:memory recall sqlite timeout", {})).toBe("slash command");
    expect(promptSkipReason("fix sqlite", {})).toBe("prompt too short");
  });

  it("promptRecallLimit defaults to 5 and clamps", () => {
    expect(promptRecallLimit({})).toBe(5);
    expect(promptRecallLimit({ ltm: { promptRecallLimit: 2 } } as never)).toBe(2);
    expect(promptRecallLimit({ ltm: { promptRecallLimit: 0 } } as never)).toBe(1);
    expect(promptRecallLimit({ ltm: { promptRecallLimit: 500 } } as never)).toBe(20);
  });

  it("queryTokens drops stopwords, short and duplicate tokens", () => {
    expect(queryTokens("Can you please fix the SQLite busy-timeout, the SQLite one?"))
      .toEqual(["fix", "sqlite", "busy", "timeout"]);
    expect(queryTokens("can you do this for me please")).toEqual([]);
  });

  it("formats a compact block and clips content to 200 chars", () => {
    const out = formatPromptRecall([
      { id: 7, category: "gotcha", content: "line one\n  line two", project_scope: null, rank: -1 },
      { id: 9, category: "pattern", content: "x".repeat(500), project_scope: "p", rank: -1 },
    ]);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe("LTM (relevant to this prompt):");
    expect(lines[1]).toBe("- [7] (gotcha) line one line two");
    const clipped = lines[2]!.replace("- [9] (pattern) ", "");
    expect(clipped.length).toBe(MAX_CONTENT_CHARS);
    expect(clipped.endsWith("…")).toBe(true);
    expect(formatPromptRecall([])).toBe("");
  });
});

describe("UserPromptSubmit hook (subprocess)", () => {
  let sb: Sandbox;
  let cwd: string;
  const ids: Record<string, number> = {};
  const PROMPT = "why does sqlite need a busy timeout when hooks write concurrently?";

  beforeAll(() => {
    sb = makeSandbox("prompt-recall");
    cwd = join(sb.base, "alpha-repo");
    mkdirSync(cwd, { recursive: true });
    initSandboxDb(sb);
    registerProject(sb, cwd, "alpha");
    ids.global = seedMemory(sb, { content: "SQLite WAL needs busy_timeout: hooks and the MCP server write concurrently", category: "gotcha", importance: 4 });
    ids.alpha = seedMemory(sb, { content: "Alpha deploys go through the blue-green pipeline in deploy/pipeline.yml", category: "workflow", project: "alpha" });
    ids.beta = seedMemory(sb, { content: "Beta deploys go through the blue-green pipeline as well", category: "workflow", project: "beta" });
    ids.stale = seedMemory(sb, { content: "SQLite busy timeout for concurrent hook writes is 1000ms", category: "gotcha", stale: true });
    ids.deprecated = seedMemory(sb, { content: "SQLite busy timeout concurrent hooks write deprecated note", category: "gotcha", status: "deprecated" });
    ids.weak = seedMemory(sb, { content: "Timeout handling in the HTTP client", category: "pattern" });
  });

  afterAll(() => sb.cleanup());

  const run = (payload: Record<string, unknown>, extraEnv: Record<string, string | undefined> = {}) =>
    runHook("UserPromptSubmit.ts", { cwd, session_id: "s-main", ...payload }, sb, extraEnv);

  it("injects relevant memories in the compact format", async () => {
    const { exitCode, stdout } = await run({ prompt: PROMPT, session_id: "s-format" });
    expect(exitCode).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("LTM (relevant to this prompt):");
    expect(lines[1]).toBe(`- [${ids.global}] (gotcha) SQLite WAL needs busy_timeout: hooks and the MCP server write concurrently`);
  }, 30_000);

  it("excludes stale, non-active, single-weak-token and other-project memories", async () => {
    const { stdout } = await run({ prompt: PROMPT, session_id: "s-filters" });
    expect(stdout).not.toContain(`[${ids.stale}]`);
    expect(stdout).not.toContain(`[${ids.deprecated}]`);
    expect(stdout).not.toContain(`[${ids.weak}]`);

    const deploy = await run({ prompt: "how do deploys work with the blue-green pipeline?", session_id: "s-scope" });
    expect(deploy.stdout).toContain(`[${ids.alpha}]`);
    expect(deploy.stdout).not.toContain(`[${ids.beta}]`);
  }, 30_000);

  it("never re-injects a memory within the same session", async () => {
    const first = await run({ prompt: PROMPT, session_id: "s-dedupe" });
    expect(first.stdout).toContain(`[${ids.global}]`);
    const second = await run({ prompt: PROMPT, session_id: "s-dedupe" });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe("");
    const otherSession = await run({ prompt: PROMPT, session_id: "s-dedupe-2" });
    expect(otherSession.stdout).toContain(`[${ids.global}]`);
  }, 30_000);

  it("honours ids already in the session's dedupe state", async () => {
    writeFileSync(join(sb.tmp, "ltm-prompt-recall-s-seeded.json"), JSON.stringify({ ids: [ids.global] }));
    const { stdout } = await run({ prompt: PROMPT, session_id: "s-seeded" });
    expect(stdout).not.toContain(`[${ids.global}]`);
  }, 30_000);

  // Found in a live Claude Code run: SessionStart's index shows only a title, so
  // treating its ids as "already injected" meant the model never got the body.
  it("still injects a memory that SessionStart only listed in its index", async () => {
    const start = await runHook("SessionStart.ts", { cwd, session_id: "s-index", source: "startup" }, sb);
    expect(start.stdout).toContain(`[${ids.global}]`);
    const { stdout } = await run({ prompt: PROMPT, session_id: "s-index" });
    expect(stdout).toContain(`[${ids.global}]`);
  }, 30_000);

  it("prints nothing for slash commands, short prompts, or no matches", async () => {
    for (const prompt of ["/openltm:memory recall sqlite busy timeout", "sqlite timeout", "please summarise the quarterly marketing roadmap"]) {
      const { exitCode, stdout } = await run({ prompt, session_id: `s-skip-${prompt.length}` });
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    }
  }, 30_000);

  it("prints nothing and exits 0 on malformed stdin", async () => {
    const { exitCode, stdout } = await runHook("UserPromptSubmit.ts", "not json", sb);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  }, 30_000);

  it("respects ltm.promptRecall=false and ltm.autoRecall=false", async () => {
    const off = makeSandbox("prompt-recall-off");
    try {
      initSandboxDb(off);
      seedMemory(off, { content: "SQLite WAL needs busy_timeout: hooks and the MCP server write concurrently", importance: 4 });
      const base = await runHook("UserPromptSubmit.ts", { cwd, prompt: PROMPT, session_id: "a" }, off);
      expect(base.stdout).toContain("LTM (relevant to this prompt):");
      writeConfig(off, { ltm: { promptRecall: false } });
      expect((await runHook("UserPromptSubmit.ts", { cwd, prompt: PROMPT, session_id: "b" }, off)).stdout).toBe("");
      writeConfig(off, { ltm: { autoRecall: false } });
      expect((await runHook("UserPromptSubmit.ts", { cwd, prompt: PROMPT, session_id: "c" }, off)).stdout).toBe("");
    } finally {
      off.cleanup();
    }
  }, 30_000);

  it("is a no-op (and does not create a DB) when the DB is missing", async () => {
    const empty = makeSandbox("prompt-recall-nodb");
    try {
      const { exitCode, stdout } = await runHook("UserPromptSubmit.ts", { cwd, prompt: PROMPT, session_id: "x" }, empty);
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(existsSync(empty.dbPath)).toBe(false);
    } finally {
      empty.cleanup();
    }
  }, 30_000);
});
