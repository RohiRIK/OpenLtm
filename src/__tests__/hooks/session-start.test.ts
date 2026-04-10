import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-ltm-session-start-${Date.now()}.db`;

// Project root (two levels up from src/__tests__/hooks/)
const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const HOOK_SCRIPT  = join(PROJECT_ROOT, "hooks", "src", "SessionStart.ts");

/**
 * Spawn the SessionStart hook as a subprocess with a given cwd input.
 * Returns { exitCode, stdout, stderr }.
 */
async function runHook(
  cwd: string,
  overrideDbPath: string
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const input = JSON.stringify({ cwd });
  const proc = Bun.spawn(
    ["bun", "run", HOOK_SCRIPT],
    {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, LTM_DB_PATH: overrideDbPath },
      cwd: PROJECT_ROOT,
    }
  );
  const [stdoutBuf, stderrBuf] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout: stdoutBuf, stderr: stderrBuf };
}

beforeAll(async () => {
  // Trigger DB creation by importing shared-db (ensures the DB file exists)
  process.env.LTM_DB_PATH = dbPath;
  await import("../../shared-db.js");
});

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
});

describe("SessionStart hook (subprocess)", () => {
  it("exits with code 0 on empty DB with unknown cwd", async () => {
    const { exitCode } = await runHook("/tmp/test-unknown-project-xyz", dbPath);
    expect(exitCode).toBe(0);
  }, 30_000);

  it("outputs valid UTF-8 content (may be empty on empty DB)", async () => {
    const { stdout, exitCode } = await runHook("/tmp/test-unknown-project-abc", dbPath);
    expect(exitCode).toBe(0);
    // stdout is always a valid string (may be empty or a new-project message)
    expect(typeof stdout).toBe("string");
  }, 30_000);

  it("does not crash with a well-formed JSON input", async () => {
    const { exitCode, stderr } = await runHook("/tmp/test-project-unique", dbPath);
    expect(exitCode).toBe(0);
    // No unhandled error on stderr (warnings about missing DB are fine)
    expect(stderr).not.toContain("Unhandled");
    expect(stderr).not.toContain("TypeError: Cannot read");
  }, 30_000);

  it("exits with code 0 when cwd is missing (no cwd in JSON)", async () => {
    // Spawn with empty JSON (no cwd field) → parseHookInput returns null → early return
    const proc = Bun.spawn(
      ["bun", "run", HOOK_SCRIPT],
      {
        stdin: new Blob(["{}"] ),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, LTM_DB_PATH: dbPath },
        cwd: PROJECT_ROOT,
      }
    );
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  }, 30_000);
});
