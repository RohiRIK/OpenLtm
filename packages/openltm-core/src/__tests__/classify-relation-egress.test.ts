/**
 * classifyRelation egress — memory text is scrubbed before the LLM request;
 * on scrub failure the call is skipped entirely.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-classify-egress-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

let core: typeof import("../index.js");
let emb: typeof import("../embeddings.js");
let db: Database;
const prevFetch = globalThis.fetch;
const prevProvider = process.env.LTM_LLM_PROVIDER;
let bodies: string[] = [];

beforeAll(async () => {
  process.env.LTM_LLM_PROVIDER = "ollama";
  core = await import("../index.js");
  emb = await import("../embeddings.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ choices: [{ message: { content: "supports" } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}, 30_000);

afterEach(() => {
  bodies = [];
  core._forceScrubThrowForTesting(false);
});

afterAll(() => {
  globalThis.fetch = prevFetch;
  if (prevProvider === undefined) delete process.env.LTM_LLM_PROVIDER;
  else process.env.LTM_LLM_PROVIDER = prevProvider;
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("classifyRelation egress scrub", () => {
  it("plant-secret in two related memories never appears in the LLM request body", async () => {
    const a = `deploy uses aws key ${AWS_KEY} in prod`;
    const b = `rotate aws key ${AWS_KEY} monthly`;
    db.run(`INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
            VALUES (?, 'gotcha', 3, 1, 'active', 'cls-a'), (?, 'gotcha', 3, 1, 'active', 'cls-b')`, [a, b]);
    const rows = db.query<{ content: string }, []>(
      "SELECT content FROM memories WHERE dedup_key IN ('cls-a','cls-b') ORDER BY id",
    ).all();
    const rel = await emb.classifyRelation(rows[0]!.content, rows[1]!.content);
    expect(rel).toBe("supports");
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toContain(AWS_KEY);
    expect(bodies[0]).toContain("[REDACTED:aws-access-key]");
  });

  it("forced scrub throw: no LLM call is made and result is null", async () => {
    core._forceScrubThrowForTesting(true);
    const rel = await emb.classifyRelation(`key ${AWS_KEY}`, `other ${AWS_KEY}`);
    expect(rel).toBeNull();
    expect(bodies.length).toBe(0);
  });
});
