import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const HOOK_SCRIPT  = join(PROJECT_ROOT, "hooks", "src", "SessionStart.ts");
const DB_PATH      = `/tmp/test-ltm-autoonboard-${Date.now()}.db`;

async function runHook(pluginDataDir: string): Promise<{ exitCode: number | null; stdout: string }> {
  const input = JSON.stringify({ cwd: "/tmp/test-autoonboard-project" });
  const proc = Bun.spawn(
    ["bun", "run", HOOK_SCRIPT],
    {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        LTM_DB_PATH: DB_PATH,
        CLAUDE_PLUGIN_DATA: pluginDataDir,
        CLAUDE_PLUGIN_ROOT: undefined, // no root → skip actual spawn, message still fires
      },
      cwd: PROJECT_ROOT,
    }
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

describe("SessionStart auto-onboard (P5-0.5)", () => {
  let tmpPluginData: string;

  beforeEach(() => {
    tmpPluginData = join(tmpdir(), `ltm-autoonboard-test-${Date.now()}`);
    mkdirSync(tmpPluginData, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpPluginData, { recursive: true }); } catch {}
  });

  it("prints auto-onboard message when flag is absent", async () => {
    const { exitCode, stdout } = await runHook(tmpPluginData);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("auto-onboarded");
    expect(stdout).toContain("/openltm:onboard to customize");
  }, 30_000);

  it("does not print auto-onboard message when flag is present", async () => {
    writeFileSync(join(tmpPluginData, "onboarded.flag"), new Date().toISOString(), "utf-8");
    const { exitCode, stdout } = await runHook(tmpPluginData);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("auto-onboarded");
  }, 30_000);
});
