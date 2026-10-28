/**
 * concurrent-writers.test.ts — hooks, the MCP server and the CLI are separate
 * processes writing one WAL database. Concurrent learn() calls from several
 * processes must all land, with no SQLITE_BUSY escaping to the caller.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CORE = join(import.meta.dir, "..", "index.ts");
const WRITERS = 3;
const PER_WRITER = 25;

describe("multi-process writers on one WAL database", () => {
  let base: string;
  let env: Record<string, string | undefined>;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "ltm-concurrent-"));
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    env = {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      LTM_DB_PATH: join(base, "ltm.db"),
      LTM_EMBED_PROVIDER: "disabled",
    };
    // Migrate once up front: this test covers steady-state writes, not
    // concurrent first-run migrations.
    const init = Bun.spawnSync([process.execPath, "-e", `const c = await import(${JSON.stringify(CORE)}); await c.waitForInit();`], { env });
    if (init.exitCode !== 0) throw new Error(`DB init failed: ${init.stderr.toString()}`);
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("keeps every row from 3 concurrent writer processes", async () => {
    // Token sets are disjoint across rows so near-dedup never merges two writes.
    const script = (w: number) => `
      const c = await import(${JSON.stringify(CORE)});
      await c.waitForInit();
      for (let i = 0; i < ${PER_WRITER}; i++) {
        const words = Array.from({ length: 8 }, () => crypto.randomUUID().slice(0, 8)).join(" ");
        c.learn({ content: "concurrent writer ${w} note " + i + " " + words, category: "pattern", skipExport: true });
      }`;
    const procs = Array.from({ length: WRITERS }, (_, w) =>
      Bun.spawn([process.execPath, "-e", script(w)], { env, stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(procs.map(async (p) => ({
      exitCode: await p.exited,
      stderr: await new Response(p.stderr).text(),
    })));
    for (const r of results) expect(r).toMatchObject({ exitCode: 0 });
    expect(results.map((r) => r.stderr).join("")).not.toContain("SQLITE_BUSY");

    const db = new Database(env.LTM_DB_PATH!, { readonly: true });
    try {
      for (let w = 0; w < WRITERS; w++) {
        const { n } = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM memories WHERE content LIKE ?")
          .get(`concurrent writer ${w} note %`)!;
        expect({ w, n }).toEqual({ w, n: PER_WRITER });
      }
    } finally {
      db.close();
    }
  }, 60_000);

  it("migrates a brand-new database once when 3 processes open it at once", async () => {
    const dbPath = join(base, "fresh.db");
    const freshEnv = { ...env, LTM_DB_PATH: dbPath };
    const script = `const c = await import(${JSON.stringify(CORE)}); await c.waitForInit();`;
    const procs = Array.from({ length: WRITERS }, () =>
      Bun.spawn([process.execPath, "-e", script], { env: freshEnv, stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(procs.map(async (p) => ({
      exitCode: await p.exited,
      stderr: await new Response(p.stderr).text(),
    })));
    for (const r of results) expect(r).toEqual({ exitCode: 0, stderr: "" });

    const db = new Database(dbPath, { readonly: true });
    try {
      const { n } = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM _schema_version").get()!;
      expect(n).toBe(readdirSync(join(import.meta.dir, "..", "..", "migrations")).filter((f) => f.endsWith(".sql")).length);
    } finally {
      db.close();
    }
  }, 60_000);
});
