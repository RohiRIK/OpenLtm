/**
 * Fail-closed scrub on durable writes (W1–W5 + learn).
 * Secrets must never land in SQLite; scrub throw must never store original.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

const dbPath = `/tmp/test-openltm-scrub-writes-${process.pid}-${Date.now()}.db`;
const SCHEMA_PATH = join(import.meta.dir, "..", "schema.sql");

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET_BLOB = `deploy with aws key ${AWS_KEY} please`;

type Core = typeof import("../index.js");
let core: Core;
let db: Database;

beforeAll(async () => {
  const mod = await import("../index.js");
  core = mod;
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  await mod.runPendingMigrations(db);
  mod._setDbForTesting(db);
}, 30_000);

afterEach(() => {
  core._forceScrubThrowForTesting(false);
});

afterAll(() => {
  core._forceScrubThrowForTesting(false);
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

function assertNoSecret(text: string | null | undefined): void {
  expect(text ?? "").not.toContain(AWS_KEY);
}

describe("scrubSecrets / scrubOrRefuse fail-closed", () => {
  it("redacts known secrets", () => {
    const r = core.scrubOrRefuse(SECRET_BLOB);
    expect(r.redactions).toContain("aws-access-key");
    assertNoSecret(r.scrubbed);
    expect(r.scrubbed).toContain("[REDACTED:aws-access-key]");
  });

  it("on scrub throw never returns original — placeholder only", () => {
    core._forceScrubThrowForTesting(true);
    const r = core.scrubSecrets(SECRET_BLOB);
    expect(r.scrubbed).toBe(core.SCRUB_FAILED_PLACEHOLDER);
    expect(r.redactions).toEqual(["scrub-failed"]);
    assertNoSecret(r.scrubbed);
  });
});

describe("learn() fail-closed write", () => {
  it("stores redacted content, not the secret", () => {
    const result = core.learn({
      content: SECRET_BLOB,
      category: "gotcha",
      importance: 3,
      skipExport: true,
    });
    const row = db.query<{ content: string }, [number]>(
      "SELECT content FROM memories WHERE id = ?",
    ).get(result.id);
    assertNoSecret(row?.content);
    expect(row?.content).toContain("[REDACTED:aws-access-key]");
  });

  it("on scrub throw stores placeholder, never original", () => {
    core._forceScrubThrowForTesting(true);
    const result = core.learn({
      content: `unique scrub-fail learn ${Date.now()} ${SECRET_BLOB}`,
      category: "pattern",
      importance: 2,
      skipExport: true,
    });
    const row = db.query<{ content: string }, [number]>(
      "SELECT content FROM memories WHERE id = ?",
    ).get(result.id);
    expect(row?.content).toBe(core.SCRUB_FAILED_PLACEHOLDER);
    assertNoSecret(row?.content);
  });
});

describe("W4 context.addItem", () => {
  it("scrubs before INSERT into context_items", () => {
    const project = `scrub-w4-${Date.now()}`;
    core.addItem(project, "decision", SECRET_BLOB, undefined, true);
    const row = db.query<{ content: string }, [string]>(
      "SELECT content FROM context_items WHERE project_name=? AND type='decision' ORDER BY id DESC LIMIT 1",
    ).get(project);
    assertNoSecret(row?.content);
  });
});

describe("W5 dao/contextItems", () => {
  it("upsertGoal / addDecision / appendProgress scrub", async () => {
    const project = `scrub-w5-${Date.now()}`;
    core.upsertGoal(project, `goal ${SECRET_BLOB}`);
    core.addDecision(project, `decision ${SECRET_BLOB}`);
    core.appendProgress(project, `progress ${SECRET_BLOB}`, "sess-scrub");
    // drain writeQueue
    await core.writeQueue.enqueue(() => undefined);
    const rows = db.query<{ content: string }, [string]>(
      "SELECT content FROM context_items WHERE project_name=?",
    ).all(project);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) assertNoSecret(r.content);
  });
});

describe("W1 janitor promote", () => {
  it("scrubs context_items content when inserting pending memory", async () => {
    const { runPromote } = await import("../janitor/promote.js");
    const project = `scrub-w1-${Date.now()}`;
    // Raw insert bypasses scrub to simulate legacy unscrubbed context row
    db.run(
      `INSERT INTO context_items (project_name, type, content, permanent, status)
       VALUES (?, 'gotcha', ?, 1, 'active')`,
      [project, SECRET_BLOB],
    );
    const result = runPromote();
    expect(result.promoted + result.skipped).toBeGreaterThanOrEqual(1);
    const mem = db.query<{ content: string }, [string]>(
      `SELECT content FROM memories WHERE project_scope=? AND source='auto-promote' ORDER BY id DESC LIMIT 1`,
    ).get(project);
    // If promoted, must be scrubbed; if skipped via dedup against scrubbed learn, still no secret in memories for this project
    if (mem) assertNoSecret(mem.content);
    const anySecret = db.query<{ c: number }, [string]>(
      `SELECT COUNT(*) as c FROM memories WHERE content LIKE ?`,
    ).get(`%${AWS_KEY}%`);
    expect(anySecret?.c ?? 0).toBe(0);
  });
});

describe("W2/W3 janitor dedup", () => {
  it("saveDedupCandidates scrubs pending candidate content", async () => {
    const { saveDedupCandidates } = await import("../janitor/dedup.js");
    const idA = Number(
      db.run(
        `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
         VALUES (?, 'pattern', 3, 1.0, 'active', ?)`,
        [`dedup-a-${Date.now()}`, `dedup-a-${Date.now()}`],
      ).lastInsertRowid,
    );
    const idB = Number(
      db.run(
        `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
         VALUES (?, 'pattern', 3, 1.0, 'active', ?)`,
        [`dedup-b-${Date.now()}`, `dedup-b-${Date.now()}`],
      ).lastInsertRowid,
    );
    saveDedupCandidates([
      {
        memoryA: { id: idA, content: SECRET_BLOB, category: "pattern" },
        memoryB: { id: idB, content: `also ${SECRET_BLOB}`, category: "pattern" },
        similarity: 0.95,
        verdict: "duplicate",
        reasoning: "same",
        mergedContent: `merged ${SECRET_BLOB}`,
      },
    ]);
    const pending = db.query<{ content: string }, [string]>(
      "SELECT content FROM memories WHERE source=? AND status='pending'",
    ).get(`dedup:${idA}:${idB}`);
    expect(pending).toBeTruthy();
    assertNoSecret(pending?.content);
  });

  it("mergeMemories scrubs updated content", () => {
    const keepId = Number(
      db.run(
        `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
         VALUES (?, 'pattern', 4, 1.0, 'active', ?)`,
        [`keep-${Date.now()}`, `keep-${Date.now()}`],
      ).lastInsertRowid,
    );
    const dropId = Number(
      db.run(
        `INSERT INTO memories (content, category, importance, confidence, status, dedup_key)
         VALUES (?, 'pattern', 2, 1.0, 'active', ?)`,
        [`drop-${Date.now()}`, `drop-${Date.now()}`],
      ).lastInsertRowid,
    );
    core.mergeMemories(keepId, dropId, `merged keep ${SECRET_BLOB}`);
    const row = db.query<{ content: string }, [number]>(
      "SELECT content FROM memories WHERE id=?",
    ).get(keepId);
    assertNoSecret(row?.content);
    expect(row?.content).toContain("[REDACTED:aws-access-key]");
  });
});
