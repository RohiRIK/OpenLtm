import { describe, expect, it } from "bun:test";

import { buildExplainer, computeTemperature } from "@rohirik/openltm-core";
const now = new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("computeTemperature", () => {
  it("hot: recall_count >= 10", () => {
    expect(computeTemperature(10, null)).toBe("hot");
    expect(computeTemperature(100, null)).toBe("hot");
  });

  it("hot: recalled within 7 days", () => {
    expect(computeTemperature(0, daysAgo(3))).toBe("hot");
    expect(computeTemperature(0, daysAgo(7))).toBe("hot");
  });

  it("warm: recall_count >= 3", () => {
    expect(computeTemperature(3, null)).toBe("warm");
    expect(computeTemperature(5, null)).toBe("warm");
  });

  it("warm: recalled within 30 days", () => {
    expect(computeTemperature(0, daysAgo(15))).toBe("warm");
  });

  it("cool: recall_count >= 1", () => {
    expect(computeTemperature(1, null)).toBe("cool");
  });

  it("cool: recalled within 90 days", () => {
    expect(computeTemperature(0, daysAgo(60))).toBe("cool");
  });

  it("cold: never recalled and no last_recalled_at", () => {
    expect(computeTemperature(0, null)).toBe("cold");
  });

  it("cold: recalled > 90 days ago with count 0", () => {
    expect(computeTemperature(0, daysAgo(100))).toBe("cold");
  });
});

describe("buildExplainer", () => {
  it("importanceBoost is importance/5", () => {
    const e = buildExplainer({ importance: 5, recall_count: 0, last_recalled_at: null });
    expect(e.importanceBoost).toBeCloseTo(1.0);

    const e2 = buildExplainer({ importance: 1, recall_count: 0, last_recalled_at: null });
    expect(e2.importanceBoost).toBeCloseTo(0.2);
  });

  it("recencyBoost is 0 when never recalled", () => {
    const e = buildExplainer({ importance: 3, recall_count: 0, last_recalled_at: null });
    expect(e.recencyBoost).toBe(0);
  });

  it("recencyBoost is ~1 when recalled today", () => {
    const e = buildExplainer({ importance: 3, recall_count: 1, last_recalled_at: now });
    expect(e.recencyBoost).toBeGreaterThan(0.98);
  });

  it("recencyBoost is 0 at exactly 90 days", () => {
    const e = buildExplainer({ importance: 3, recall_count: 1, last_recalled_at: daysAgo(90) });
    expect(e.recencyBoost).toBeCloseTo(0, 1);
  });

  it("ftsRank and semanticScore are null when not provided", () => {
    const e = buildExplainer({ importance: 3, recall_count: 0, last_recalled_at: null });
    expect(e.ftsRank).toBeNull();
    expect(e.semanticScore).toBeNull();
  });

  it("totalScore uses FTS-only weights when semantic is null", () => {
    const e = buildExplainer({ importance: 5, recall_count: 0, last_recalled_at: null, ftsRank: 1.0 });
    // fts*0.75 + importance*0.15 + recency*0.10
    expect(e.totalScore).toBeCloseTo(0.75 * 1.0 + 0.15 * 1.0 + 0.10 * 0, 5);
  });

  it("totalScore uses combined weights when both fts and semantic are present", () => {
    const e = buildExplainer({
      importance: 5,
      recall_count: 0,
      last_recalled_at: null,
      ftsRank: 1.0,
      semanticScore: 0.9,
    });
    expect(e.totalScore).toBeCloseTo(0.40 * 1.0 + 0.35 * 0.9 + 0.15 * 1.0 + 0.10 * 0, 5);
  });

  it("higher importance produces higher totalScore (all else equal)", () => {
    const low = buildExplainer({ importance: 1, recall_count: 0, last_recalled_at: null, ftsRank: 0.5 });
    const high = buildExplainer({ importance: 5, recall_count: 0, last_recalled_at: null, ftsRank: 0.5 });
    expect(high.totalScore).toBeGreaterThan(low.totalScore);
  });

  it("temperature is attached correctly", () => {
    const e = buildExplainer({ importance: 3, recall_count: 15, last_recalled_at: now });
    expect(e.temperature).toBe("hot");
  });

  it("identical inputs produce identical outputs (deterministic)", () => {
    const input = { importance: 3, recall_count: 2, last_recalled_at: daysAgo(45), ftsRank: 0.7 };
    const e1 = buildExplainer(input);
    const e2 = buildExplainer(input);
    expect(e1).toEqual(e2);
  });
});
