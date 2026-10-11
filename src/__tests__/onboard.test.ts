import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir, tmpdir } from "os";
import { Database } from "bun:sqlite";

// Everything this suite writes lives under a fresh mkdtemp dir. HOME and
// CLAUDE_CONFIG_DIR point inside it so onboard's registry.json / projects/<name>
// writes never reach the real ~/.claude.
const TEST_DIR = mkdtempSync(join(tmpdir(), "ltm-onboard-test-"));
const FAKE_HOME = join(TEST_DIR, "home");
const FAKE_CLAUDE_DIR = join(FAKE_HOME, ".claude");
// Unique basename so the derived project name can be checked against the real ~/.claude.
const PROJECT_CWD = join(TEST_DIR, basename(TEST_DIR));
const PLUGIN_DATA = join(TEST_DIR, "plugin-data");
const DB_PATH = join(TEST_DIR, "test-openltm.db");
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "src", "schema.sql");

// Real ~/.claude: the test wrapper passes the pre-isolation home; fall back to
// homedir() (cached by Bun at process start) for `HOME=$(mktemp -d) bun test`.
const REAL_CLAUDE_DIR = join(process.env.LTM_TEST_REAL_HOME || homedir(), ".claude");
const REAL_REGISTRY = join(REAL_CLAUDE_DIR, "projects", "registry.json");

const ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_PLUGIN_DATA"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

// Deferred imports — resolved after DB injection
let runOnboard: typeof import("../onboard.js").runOnboard;
let runDiagnostics: typeof import("../onboard.js").runDiagnostics;
let isAlreadyOnboarded: typeof import("../onboard.js").isAlreadyOnboarded;
let writeOnboardedFlag: typeof import("../onboard.js").writeOnboardedFlag;
let getOnboardedFlagPath: typeof import("../onboard.js").getOnboardedFlagPath;

function readRealRegistry(): Record<string, string> {
  try { return JSON.parse(readFileSync(REAL_REGISTRY, "utf-8")) as Record<string, string>; }
  catch { return {}; }
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.HOME = FAKE_HOME;
  process.env.CLAUDE_CONFIG_DIR = FAKE_CLAUDE_DIR;
  process.env.CLAUDE_PLUGIN_DATA = PLUGIN_DATA;

  mkdirSync(PLUGIN_DATA, { recursive: true });
  mkdirSync(PROJECT_CWD, { recursive: true });

  const { runPendingMigrations, _setDbForTesting } = await import("@rohirik/openltm-core");

  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await runPendingMigrations(db);
  _setDbForTesting(db);

  const mod = await import("../onboard.js");
  runOnboard = mod.runOnboard;
  runDiagnostics = mod.runDiagnostics;
  isAlreadyOnboarded = mod.isAlreadyOnboarded;
  writeOnboardedFlag = mod.writeOnboardedFlag;
  getOnboardedFlagPath = mod.getOnboardedFlagPath;
}, 30_000);

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

function clearFlag() {
  try { unlinkSync(getOnboardedFlagPath(PLUGIN_DATA)); } catch {}
}

describe("runDiagnostics", () => {
  it("returns diagnostics array with known labels", () => {
    const results = runDiagnostics();
    const labels = results.map(r => r.label);
    expect(labels).toContain("CLAUDE_PLUGIN_DATA");
    expect(labels).toContain("Database");
    expect(labels).toContain("Projects dir");
    expect(labels).toContain("Hook wiring");
  });

  it("CLAUDE_PLUGIN_DATA shows ok when env is set", () => {
    const r = runDiagnostics().find(d => d.label === "CLAUDE_PLUGIN_DATA")!;
    expect(r.status).toBe("ok");
  });

  it("CLAUDE_PLUGIN_DATA shows critical when env is missing", () => {
    const saved = process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.CLAUDE_PLUGIN_DATA;
    const r = runDiagnostics().find(d => d.label === "CLAUDE_PLUGIN_DATA")!;
    expect(r.status).toBe("critical");
    process.env.CLAUDE_PLUGIN_DATA = saved;
  });
});

describe("isAlreadyOnboarded / writeOnboardedFlag", () => {
  it("returns false when flag absent", () => {
    clearFlag();
    expect(isAlreadyOnboarded(PLUGIN_DATA)).toBe(false);
  });

  it("returns true after writing flag", () => {
    clearFlag();
    writeOnboardedFlag(PLUGIN_DATA);
    expect(isAlreadyOnboarded(PLUGIN_DATA)).toBe(true);
    clearFlag();
  });

  it("flag file contains ISO timestamp", () => {
    clearFlag();
    writeOnboardedFlag(PLUGIN_DATA);
    const content = readFileSync(getOnboardedFlagPath(PLUGIN_DATA), "utf-8");
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    clearFlag();
  });
});

describe("runOnboard --non-interactive", () => {
  it("succeeds on fresh project", async () => {
    clearFlag();
    const result = await runOnboard({ nonInteractive: true, cwd: PROJECT_CWD });
    expect(result.success).toBe(true);
    expect(result.projectName).toBeTruthy();
    clearFlag();
  });

  it("writes onboarded.flag", async () => {
    clearFlag();
    await runOnboard({ nonInteractive: true, cwd: PROJECT_CWD });
    expect(isAlreadyOnboarded(PLUGIN_DATA)).toBe(true);
    clearFlag();
  });

  it("derives project name from cwd basename", async () => {
    clearFlag();
    const result = await runOnboard({ nonInteractive: true, cwd: join(TEST_DIR, "my-app") });
    expect(result.projectName).toBe("my-app");
    clearFlag();
  });

  it("keeps an already-registered name and writes the OpenLTM registry, not ~/.claude/projects", async () => {
    clearFlag();
    const { registerPath, getRegistryPath, CLAUDE_TRANSCRIPTS_DIR } = await import("../../hooks/lib/resolveProject.js");
    const cwd = join(TEST_DIR, "Registered_App");
    registerPath(cwd, "custom-name");
    const result = await runOnboard({ nonInteractive: true, cwd });
    expect(result.projectName).toBe("custom-name");
    expect(JSON.parse(readFileSync(getRegistryPath(), "utf-8"))[cwd]).toBe("custom-name");
    const legacyRegistry = join(CLAUDE_TRANSCRIPTS_DIR, "registry.json");
    if (existsSync(legacyRegistry)) {
      expect(JSON.parse(readFileSync(legacyRegistry, "utf-8"))[cwd]).toBeUndefined();
    }
    clearFlag();
  });

  it("is idempotent — returns success without re-running if already onboarded", async () => {
    writeOnboardedFlag(PLUGIN_DATA);
    const result = await runOnboard({ nonInteractive: true, cwd: PROJECT_CWD });
    expect(result.success).toBe(true);
    expect(result.projectName).toBeUndefined(); // skipped — no wizard ran
    clearFlag();
  });

  it("--force re-runs even when flag exists", async () => {
    writeOnboardedFlag(PLUGIN_DATA);
    const result = await runOnboard({ nonInteractive: true, force: true, cwd: PROJECT_CWD });
    expect(result.success).toBe(true);
    expect(result.projectName).toBeTruthy();
    clearFlag();
  });
});

describe("runOnboard CRITICAL abort", () => {
  it("fails when CLAUDE_PLUGIN_DATA is unset", async () => {
    clearFlag();
    const saved = process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.CLAUDE_PLUGIN_DATA;
    const result = await runOnboard({ nonInteractive: true, force: true, cwd: PROJECT_CWD });
    expect(result.success).toBe(false);
    process.env.CLAUDE_PLUGIN_DATA = saved;
  });
});

describe("HOME isolation", () => {
  let isolatedProjectName = "";

  it("writes registry + project dir under the plugin data dir (not ~/.claude/projects)", async () => {
    clearFlag();
    const result = await runOnboard({ nonInteractive: true, force: true, cwd: PROJECT_CWD });
    expect(result.success).toBe(true);
    // 2.17: OpenLTM state lives in <dataDir>/projects, out of Claude Code's own transcript dir.
    const registry = JSON.parse(
      readFileSync(join(PLUGIN_DATA, "projects", "registry.json"), "utf-8"),
    ) as Record<string, string>;
    expect(registry[PROJECT_CWD]).toBe(result.projectName!);
    expect(existsSync(join(PLUGIN_DATA, "projects", result.projectName!))).toBe(true);
    expect(existsSync(join(FAKE_CLAUDE_DIR, "projects", result.projectName!))).toBe(false);
    isolatedProjectName = result.projectName!;
    clearFlag();
  });

  it("never touches the real ~/.claude", () => {
    expect(REAL_CLAUDE_DIR.startsWith(TEST_DIR)).toBe(false);
    const realRegistry = readRealRegistry();
    for (const key of Object.keys(realRegistry)) {
      expect(key.startsWith(TEST_DIR)).toBe(false);
    }
    expect(isolatedProjectName).toMatch(/^ltm-onboard-test-/);
    expect(existsSync(join(REAL_CLAUDE_DIR, "projects", isolatedProjectName))).toBe(false);
  });
});
