/**
 * Adaptive cutoff and query intent in recall (memvid-inspired, 2.23.0).
 * Pure functions first, then recall() end to end with embeddings disabled.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { adaptiveCutoff, matchStrengths } from "../recall/adaptive.js";
import { detectQueryIntent, recencyRanks } from "../recall/intent.js";

describe("detectQueryIntent", () => {
  it("finds recency, aggregate, or nothing", () => {
    expect(detectQueryIntent("what is the current embedding model")).toBe("recency");
    expect(detectQueryIntent("which port does the API use now?")).toBe("recency");
    expect(detectQueryIntent("list all release steps")).toBe("aggregate");
    expect(detectQueryIntent("how many hosts run llama.cpp")).toBe("aggregate");
    expect(detectQueryIntent("list all current hosts")).toBe("aggregate");
    expect(detectQueryIntent("how do we handle migrations")).toBeNull();
    expect(detectQueryIntent("")).toBeNull();
    expect(detectQueryIntent(undefined)).toBeNull();
  });
  it("does not match inside words", () => {
    expect(detectQueryIntent("snowflake knowledge base")).toBeNull();
    expect(detectQueryIntent("ballistic installer")).toBeNull();
  });
});

describe("recencyRanks", () => {
  it("ranks newest 1, oldest 0, event time before created_at", () => {
    const r = recencyRanks([
      { id: 1, created_at: "2026-01-01 00:00:00" },
      { id: 2, created_at: "2026-06-01 00:00:00" },
      { id: 3, created_at: "2026-09-01 00:00:00", occurred_at: "2025-01-01 00:00:00" },
    ]);
    expect(r.get(2)).toBe(1);
    expect(r.get(3)).toBe(0);
    expect(r.get(1)).toBe(0.5);
  });
  it("gives a single candidate 1", () => {
    expect(recencyRanks([{ id: 9, created_at: "2026-01-01 00:00:00" }]).get(9)).toBe(1);
  });
});

describe("adaptiveCutoff", () => {
  const ranked = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));
  it("drops hits weaker than 30% of the best, keeping at least 3", () => {
    const s = new Map([[1, 1], [2, 0.9], [3, 0.1], [4, 0.5], [5, 0.2], [6, 0.29]]);
    expect(adaptiveCutoff(ranked, s).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
  it("keeps the order it was given", () => {
    const s = new Map([[1, 0.4], [2, 1], [3, 0.9], [4, 0.95], [5, 0.01], [6, 0.01]]);
    expect(adaptiveCutoff(ranked, s).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
  it("returns everything when nothing has a strength", () => {
    expect(adaptiveCutoff(ranked, new Map())).toHaveLength(6);
  });
  it("matchStrengths takes the stronger retriever, semantic relative to its best", () => {
    const s = matchStrengths([1, 2, 3], new Map([[1, 1], [2, 0.2]]), new Map([[2, 0.4], [3, 0.8]]));
    expect(s.get(1)).toBe(1);
    expect(s.get(2)).toBe(0.5);
    expect(s.get(3)).toBe(1);
  });
});

describe("recall() — adaptive cutoff and intent end to end", () => {
  let core: typeof import("../index.js");
  const tmpRoot = mkdtempSync(join(tmpdir(), "ltm-adaptive-"));
  const saved = process.env.LTM_EMBED_PROVIDER;

  beforeAll(async () => {
    process.env.LTM_EMBED_PROVIDER = "disabled";
    core = await import("../index.js");
    const db = new Database(join(tmpRoot, "t.db"), { create: true });
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    db.exec(readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf-8"));
    await core.runPendingMigrations(db);
    core._setDbForTesting(db);
  }, 30_000);
  afterAll(() => {
    if (saved === undefined) delete process.env.LTM_EMBED_PROVIDER; else process.env.LTM_EMBED_PROVIDER = saved;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns fewer than limit when only a few memories really match", async () => {
    core.learn({ content: "The quokka deploy pipeline signs every quokka artifact with cosign before upload.", category: "workflow", skipExport: true });
    core.learn({ content: "Quokka artifacts are uploaded to the quokka bucket in eu-west-1.", category: "architecture", skipExport: true });
    for (let i = 0; i < 8; i++) {
      core.learn({ content: `Unrelated note ${i}: the pipeline for service number ${i} runs lint before tests, then deploys.`, category: "workflow", skipExport: true });
    }
    const adaptive = await core.recall({ query: "quokka artifact signing pipeline", limit: 10, semantic: false });
    const fixed = await core.recall({ query: "quokka artifact signing pipeline", limit: 10, semantic: false, adaptive: false });
    expect(fixed.length).toBeGreaterThan(adaptive.length);
    expect(adaptive[0]!.content).toContain("cosign");
    expect(adaptive.length).toBeGreaterThanOrEqual(3);
  });

  it("does not trim a 'list all' query", async () => {
    const all = await core.recall({ query: "list all pipeline quokka notes", limit: 10, semantic: false });
    const fixed = await core.recall({ query: "list all pipeline quokka notes", limit: 10, semantic: false, adaptive: false });
    expect(all.length).toBe(fixed.length);
    expect(all[0]!.explainer?.intent).toBe("aggregate");
  });

  it("puts the newest of two close matches first for a 'current' query", async () => {
    const db = core.getDb();
    const old = core.learn({ content: "The embedding model for the wombat service is nomic-embed.", category: "architecture", skipExport: true });
    const neu = core.learn({ content: "The embedding model for the wombat service is bge-m3.", category: "architecture", skipExport: true });
    db.run("UPDATE memories SET created_at='2026-01-01 00:00:00' WHERE id=?", [old.id]);
    db.run("UPDATE memories SET created_at='2026-09-01 00:00:00' WHERE id=?", [neu.id]);
    const current = await core.recall({ query: "current wombat embedding model", limit: 5, semantic: false });
    expect(current[0]!.id).toBe(neu.id);
    expect(current[0]!.explainer?.intent).toBe("recency");
  });
});
