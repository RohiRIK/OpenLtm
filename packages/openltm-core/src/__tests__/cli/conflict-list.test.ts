/**
 * `ltm conflict list` — staging terms are scrubbed before printing.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

describe("ltm conflict list (subprocess)", () => {
  let dir: string;
  let bin: string;
  let dbPath: string;
  const env: Record<string, string> = {};

  function ltm(args: string[]): { code: number; stdout: string; stderr: string } {
    const r = Bun.spawnSync([process.execPath, bin, ...args], {
      env: { ...env, LTM_DB_PATH: dbPath }, stdout: "pipe", stderr: "pipe",
    });
    return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ltm-conflict-list-"));
    dbPath = join(dir, "openltm.db");
    bin = (await import("../../cli/janitor.js")).LTM_BIN_PATH;
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !["LTM_DB_PATH", "CLAUDE_PLUGIN_DATA"].includes(k)) env[k] = v;
    }
    env.LTM_LLAMA_CPP_URL = "http://127.0.0.1:9";
    env.LTM_EMBED_PROVIDER = "disabled";
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("raw AKIA term inserted via SQL prints redacted", () => {
    // Create + migrate the DB through the real CLI.
    expect(ltm(["memory", "learn", "--text", "conflict list older memory"]).code).toBe(0);
    expect(ltm(["memory", "learn", "--text", "conflict list newer memory body"]).code).toBe(0);
    const db = new Database(dbPath);
    const ids = db.query<{ id: number }, []>("SELECT id FROM memories ORDER BY id").all().map((r) => r.id);
    db.run(
      "INSERT INTO memory_conflict_staging (older_id, newer_id, term) VALUES (?, ?, ?)",
      [ids[0]!, ids[1]!, `csv vs parquet ${AWS_KEY}`],
    );
    db.close();

    const r = ltm(["conflict", "list"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(AWS_KEY);
    expect(r.stdout).toContain("[REDACTED:aws-access-key]");
  });
});
