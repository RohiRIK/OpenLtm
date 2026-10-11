import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync } from "fs";
import { join } from "path";
import { makeSandbox, markOnboarded, runHook, type Sandbox } from "./hookHarness";

let sb: Sandbox;

beforeAll(() => {
  sb = makeSandbox("session-start");
  markOnboarded(sb);
});

afterAll(() => sb.cleanup());

describe("SessionStart hook (subprocess)", () => {
  it("exits with code 0 on empty DB with unknown cwd", async () => {
    const cwd = join(sb.base, "unknown-project-xyz");
    mkdirSync(cwd, { recursive: true });
    const { exitCode } = await runHook("SessionStart.ts", { cwd }, sb);
    expect(exitCode).toBe(0);
  }, 30_000);

  it("outputs valid UTF-8 content (may be empty on empty DB)", async () => {
    const { stdout, exitCode } = await runHook("SessionStart.ts", { cwd: join(sb.base, "unknown-project-abc") }, sb);
    expect(exitCode).toBe(0);
    expect(typeof stdout).toBe("string");
  }, 30_000);

  it("does not crash with a well-formed JSON input", async () => {
    const { exitCode, stderr } = await runHook("SessionStart.ts", { cwd: join(sb.base, "project-unique") }, sb);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Unhandled");
    expect(stderr).not.toContain("TypeError: Cannot read");
  }, 30_000);

  it("exits with code 0 when cwd is missing (no cwd in JSON)", async () => {
    const { exitCode, stdout } = await runHook("SessionStart.ts", "{}", sb);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("**Context not restored:** registry_miss");
  }, 30_000);
});
