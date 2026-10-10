import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { makeSandbox, markOnboarded, runHook, type Sandbox } from "./hooks/hookHarness";

// Real ~/.claude — the spawned hook must never write here. The isolated test
// wrapper passes the pre-isolation home; fall back to homedir() otherwise.
const REAL_REGISTRY = join(process.env.LTM_TEST_REAL_HOME || homedir(), ".claude", "projects", "registry.json");

function readRegistry(path: string): Record<string, string> {
  try { return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>; }
  catch { return {}; }
}

describe("SessionStart auto-onboard (P5-0.5)", () => {
  let sb: Sandbox;
  let cwd: string;

  beforeEach(() => {
    sb = makeSandbox("autoonboard");
    cwd = join(sb.base, "Test AutoOnboard Project");
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => sb.cleanup());

  it("onboards on first startup and names the registered project, not a path slug", async () => {
    const { exitCode, stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('auto-onboarded "test-autoonboard-project"');
    expect(stdout).toContain("/openltm:onboard to customize");
    expect(existsSync(join(sb.data, "onboarded.flag"))).toBe(true);
  }, 30_000);

  it("treats a payload without `source` as startup (older Claude Code builds)", async () => {
    const { stdout } = await runHook("SessionStart.ts", { cwd }, sb);
    expect(stdout).toContain("auto-onboarded");
  }, 30_000);

  it("does not print auto-onboard message when flag is present", async () => {
    markOnboarded(sb);
    const { exitCode, stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("auto-onboard");
  }, 30_000);

  it("fires once: a second startup does not onboard again", async () => {
    await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    const { stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    expect(stdout).not.toContain("auto-onboard");
  }, 30_000);

  it("skips onboarding without CLAUDE_PLUGIN_DATA (not a plugin install)", async () => {
    const { exitCode, stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb, { CLAUDE_PLUGIN_DATA: undefined });
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("auto-onboard");
  }, 30_000);

  it("writes only under the sandbox HOME, never the real ~/.claude", async () => {
    await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    for (const key of Object.keys(readRegistry(REAL_REGISTRY))) {
      expect(key.startsWith(sb.base)).toBe(false);
    }
  }, 30_000);
});
