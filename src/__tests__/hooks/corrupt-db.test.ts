/**
 * corrupt-db.test.ts — a hook must never break the host session, even when the
 * database is unreadable. Garbage bytes at LTM_DB_PATH make every DB open throw.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { makeSandbox, markOnboarded, registerProject, runHook, type Sandbox } from "./hookHarness.js";

describe("hooks with a corrupt database", () => {
  let sb: Sandbox;
  let cwd: string;

  beforeAll(() => {
    sb = makeSandbox("corrupt-db");
    cwd = join(sb.base, "repo");
    mkdirSync(cwd, { recursive: true });
    registerProject(sb, cwd, "repo");
    markOnboarded(sb);
    writeFileSync(sb.dbPath, Buffer.from("this is not a sqlite database, just garbage bytes ".repeat(200)));
  });

  afterAll(() => sb.cleanup());

  // SessionStart and UserPromptSubmit catch DB errors themselves and degrade
  // (no safeRun error line); the SQLite message proves they reached the DB.
  it("SessionStart exits 0 and still prints its banner", async () => {
    const { exitCode, stdout, stderr } = await runHook("SessionStart.ts", { cwd, session_id: "s-corrupt", source: "startup" }, sb);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("file is not a database");
    expect(stdout).toContain("LTM Active");
  });

  it("UserPromptSubmit exits 0 and injects nothing", async () => {
    const prompt = "why does sqlite need a busy timeout when hooks write concurrently?";
    const { exitCode, stdout, stderr } = await runHook("UserPromptSubmit.ts", { cwd, session_id: "s-corrupt", prompt }, sb);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("file is not a database");
    expect(stdout.trim()).toBe("");
  });

  it("SessionEnd exits 0", async () => {
    const { exitCode } = await runHook("SessionEnd.ts", { cwd, session_id: "s-corrupt", reason: "exit" }, sb);
    expect(exitCode).toBe(0);
  });
});
