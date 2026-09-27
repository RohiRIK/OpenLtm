import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-hook-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "..", "schema.sql");

beforeAll(async () => {
  const { runPendingMigrations, _setDbForTesting } = await import("../../index.js");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await runPendingMigrations(db);
  _setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("cli hook dispatcher", () => {
  it("builds a SessionStart prefill block from hook stdin JSON", async () => {
    const { learn } = await import("../../index.js");
    const { buildHookOutput } = await import("../../cli/hook.js");

    learn({
      content: "SessionStart should restore this memory",
      category: "pattern",
      importance: 3,
      project_scope: "hook-project",
      skipExport: true,
    });

    const output = await buildHookOutput("SessionStart", JSON.stringify({ cwd: "/tmp/hook-project" }));
    expect(output).toContain("Prior Knowledge");
    expect(output).toContain("restore this memory");
  });

  it("keeps non-SessionStart hook events as safe no-ops", async () => {
    const { buildHookOutput } = await import("../../cli/hook.js");
    expect(await buildHookOutput("PreCompact", JSON.stringify({ cwd: "/tmp/hook-project" }))).toBe("");
    expect(await buildHookOutput("PostEditCheck", JSON.stringify({ cwd: "/tmp/hook-project" }))).toBe("");
  });
});
