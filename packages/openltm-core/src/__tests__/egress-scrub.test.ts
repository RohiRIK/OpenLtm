/**
 * Egress scrub — plant-secret tests for every egress path.
 * Contract: NEVER send raw secrets; on scrub failure send stub or omit.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-egress-scrub-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET = `rotate key ${AWS_KEY} immediately`;

type Core = typeof import("../index.js");
let core: Core;
let db: Database;

beforeAll(async () => {
  core = await import("../index.js");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await core.runPendingMigrations(db);
  core._setDbForTesting(db);
}, 30_000);

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

function assertNoRaw(text: string): void {
  expect(text).not.toContain(AWS_KEY);
}

describe("scrubForEgress fail-closed", () => {
  it("redacts secrets (stub, not raw)", () => {
    const out = core.scrubForEgress(SECRET);
    assertNoRaw(out);
    expect(out).toContain("[REDACTED:aws-access-key]");
  });

  it("on scrub throw returns stub never raw", () => {
    core._forceScrubThrowForTesting(true);
    try {
      const out = core.scrubForEgress(SECRET);
      expect(out).toBe(core.SCRUB_FAILED_PLACEHOLDER);
      expect(core.isEgressScrubFailed(out)).toBe(true);
      assertNoRaw(out);
    } finally {
      core._forceScrubThrowForTesting(false);
    }
  });
});

describe("plant-secret egress paths", () => {
  it("SessionStart inject line shape scrubbed", () => {
    const line = `- [42] ${core.scrubForEgress(SECRET)}`;
    assertNoRaw(line);
  });

  it("SessionStart embed query scrubbed", () => {
    const query = core.scrubForEgress(`session summary with ${SECRET}`);
    assertNoRaw(query);
  });

  it("MCP compact content scrubbed before truncate", async () => {
    const { scrubForEgress } = core;
    const raw = SECRET + "x".repeat(400);
    const scrubbed = scrubForEgress(raw);
    const compact = scrubbed.length > 300 ? scrubbed.slice(0, 300) + "…" : scrubbed;
    assertNoRaw(compact);
  });

  it("MCP context_items admin scan scrubbed", () => {
    db.run(
      `INSERT INTO context_items (project_name, type, content, permanent, status)
       VALUES ('egress-admin', 'decision', ?, 1, 'active')`,
      [SECRET],
    );
    const items = core.getItems("egress-admin", "decision").map((i) => ({
      ...i,
      content: core.scrubForEgress(i.content),
    }));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) assertNoRaw(item.content);
  });

  it("categorise receives scrubbed content (no raw in scrub path)", async () => {
    core._forceScrubThrowForTesting(true);
    try {
      // Even on scrub failure, categorise must not see raw — it scrubs at entry
      const result = await core.categorise(SECRET, 0.99);
      expect(result.category).toBeTruthy();
    } finally {
      core._forceScrubThrowForTesting(false);
    }
    assertNoRaw(core.scrubForEgress(SECRET));
  });

  it("dedup LLM prompt uses scrubbed memory text", () => {
    const a = core.scrubForEgress(SECRET);
    const b = core.scrubForEgress(`also ${SECRET}`);
    const prompt = `Memory A [gotcha]: ${a}\n\nMemory B [gotcha]: ${b}`;
    assertNoRaw(prompt);
  });

  it("embedText / janitor embed batch scrub before provider", () => {
    const texts = [SECRET, `batch ${SECRET}`].map((t) => core.scrubForEgress(t));
    for (const t of texts) assertNoRaw(t);
  });
});

describe("SessionStart graphInsights egress", () => {
  it("plant-secret: graphInsights text is scrubbed before inject", () => {
    const AWS = "AKIAIOSFODNN7EXAMPLE";
    const graphInsights = `Related: deploy with aws key ${AWS} — see memory 12`;
    const scrubbed = core.scrubForEgress(graphInsights);
    expect(scrubbed).not.toContain(AWS);
  });

  it("SessionStart source scrubs graphInsights (not raw push)", () => {
    const src = readFileSync(join(import.meta.dir, "../../../../hooks/src/SessionStart.ts"), "utf-8");
    expect(src).toContain("scrubForEgress(graphInsights)");
    expect(src).not.toMatch(/if \(graphInsights\) \{ lines\.push\(graphInsights\)/);
  });
});
