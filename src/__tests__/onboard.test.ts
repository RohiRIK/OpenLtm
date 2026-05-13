import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

const TEST_DIR = join(tmpdir(), `ltm-onboard-test-${process.pid}`);
const PLUGIN_DATA = join(TEST_DIR, "plugin-data");
const DB_PATH = join(TEST_DIR, "test-ltm.db");
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "src", "schema.sql");

// Set env BEFORE any imports that read it
process.env.CLAUDE_PLUGIN_DATA = PLUGIN_DATA;

// Deferred imports — resolved after DB injection
let runOnboard: typeof import("../onboard.js").runOnboard;
let runDiagnostics: typeof import("../onboard.js").runDiagnostics;
let isAlreadyOnboarded: typeof import("../onboard.js").isAlreadyOnboarded;
let writeOnboardedFlag: typeof import("../onboard.js").writeOnboardedFlag;
let getOnboardedFlagPath: typeof import("../onboard.js").getOnboardedFlagPath;

beforeAll(async () => {
  mkdirSync(PLUGIN_DATA, { recursive: true });

  const { runPendingMigrations } = await import("../migrations.js");
  const { _setDbForTesting } = await import("../shared-db.js");

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
    const result = await runOnboard({ nonInteractive: true, cwd: TEST_DIR });
    expect(result.success).toBe(true);
    expect(result.projectName).toBeTruthy();
    clearFlag();
  });

  it("writes onboarded.flag", async () => {
    clearFlag();
    await runOnboard({ nonInteractive: true, cwd: TEST_DIR });
    expect(isAlreadyOnboarded(PLUGIN_DATA)).toBe(true);
    clearFlag();
  });

  it("derives project name from cwd basename", async () => {
    clearFlag();
    const result = await runOnboard({ nonInteractive: true, cwd: "/some/project/my-app" });
    expect(result.projectName).toBe("my-app");
    clearFlag();
  });

  it("is idempotent — returns success without re-running if already onboarded", async () => {
    writeOnboardedFlag(PLUGIN_DATA);
    const result = await runOnboard({ nonInteractive: true, cwd: TEST_DIR });
    expect(result.success).toBe(true);
    expect(result.projectName).toBeUndefined(); // skipped — no wizard ran
    clearFlag();
  });

  it("--force re-runs even when flag exists", async () => {
    writeOnboardedFlag(PLUGIN_DATA);
    const result = await runOnboard({ nonInteractive: true, force: true, cwd: TEST_DIR });
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
    const result = await runOnboard({ nonInteractive: true, force: true, cwd: TEST_DIR });
    expect(result.success).toBe(false);
    process.env.CLAUDE_PLUGIN_DATA = saved;
  });
});
