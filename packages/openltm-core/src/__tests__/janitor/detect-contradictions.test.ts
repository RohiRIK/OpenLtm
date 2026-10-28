/**
 * detectContradictions matches whole words only, and each memory must take one
 * side. Substring matching staged "js vs ts" for two unrelated gotchas in real use
 * (".mjs" and "its"/"fails").
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { learn } from "../../db.js";
import { _setDbForTesting } from "../../shared-db.js";
import { getSchemaPath } from "../../paths.js";
import { runPendingMigrations } from "../../migrations.js";
import { detectContradictions } from "../../janitor/supersedes.js";

let db: Database;
beforeEach(async () => {
  db = new Database(":memory:");
  db.exec(readFileSync(getSchemaPath(), "utf-8"));
  await runPendingMigrations(db);
  _setDbForTesting(db);
});

const add = (content: string, category: "gotcha" | "workflow" = "gotcha") =>
  learn({ content, category, project_scope: "p", skipExport: true }).id;

describe("detectContradictions", () => {
  it("ignores substrings and file extensions (the real false positive)", () => {
    add("hooks/GitCommit.bundle.mjs is built by esbuild; core's import.meta.dir then points at hooks/, so the DB open fails");
    add("A WAL-mode SQLite DB whose last writer closed has no -shm file and a readonly connection fails; its tests passed on Linux");
    add("hooks/lib/promptRecall.ts opens the database query-only through openQueryOnly in sql.ts");
    expect(detectContradictions("p")).toEqual([]);
  });

  it("ignores a memory that mentions both sides", () => {
    add("Install packages with npm ci in CI", "workflow");
    add("We moved from npm to bun for every script", "workflow");
    expect(detectContradictions("p")).toEqual([]);
  });

  it("still stages a real stance change on whole words", () => {
    const older = add("Install packages with npm ci", "workflow");
    const newer = add("Install packages with bun install", "workflow");
    db.run("UPDATE memories SET created_at = datetime('now', '-1 hour') WHERE id = ?", [older]); // order needs distinct seconds
    expect(detectContradictions("p").map((c) => [c.olderId, c.newerId, c.term])).toEqual([[older, newer, "npm vs bun"]]);
  });
});
