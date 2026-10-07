import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const HOOK_SCRIPT  = join(PROJECT_ROOT, "hooks", "src", "SessionStart.ts");

// Real ~/.claude — the spawned hook must never write here. The test wrapper
// passes the pre-isolation home; fall back to homedir() otherwise.
const REAL_REGISTRY = join(process.env.LTM_TEST_REAL_HOME || homedir(), ".claude", "projects", "registry.json");

function readRegistry(path: string): Record<string, string> {
  try { return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>; }
  catch { return {}; }
}

let testRoot: string;
let fakeHome: string;
let projectCwd: string;
let dbPath: string;

async function runHook(pluginDataDir: string): Promise<{ exitCode: number | null; stdout: string }> {
  const input = JSON.stringify({ cwd: projectCwd });
  const proc = Bun.spawn(
    ["bun", "run", HOOK_SCRIPT],
    {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Isolate everything under ~/.claude (registry, projects/, logs, tmp) to a temp HOME.
        HOME: fakeHome,
        CLAUDE_CONFIG_DIR: join(fakeHome, ".claude"),
        LTM_DB_PATH: dbPath,
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

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "ltm-autoonboard-test-"));
  fakeHome = join(testRoot, "home");
  projectCwd = join(testRoot, "test-autoonboard-project");
  dbPath = join(testRoot, "test-ltm-autoonboard.db");
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(projectCwd, { recursive: true });
});

afterAll(() => {
  try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
});

describe("SessionStart auto-onboard (P5-0.5)", () => {
  let tmpPluginData: string;

  beforeEach(() => {
    tmpPluginData = mkdtempSync(join(testRoot, "plugin-data-"));
  });

  afterEach(() => {
    try { rmSync(tmpPluginData, { recursive: true, force: true }); } catch {}
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

  it("writes only under the temp HOME, never the real ~/.claude", async () => {
    await runHook(tmpPluginData);
    expect(existsSync(join(fakeHome, ".claude"))).toBe(true);
    expect(Object.keys(readRegistry(REAL_REGISTRY))).not.toContain(projectCwd);
    for (const key of Object.keys(readRegistry(REAL_REGISTRY))) {
      expect(key.startsWith(testRoot)).toBe(false);
    }
  }, 30_000);
});
