import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "fs";

const dbPath = `/tmp/test-ltm-decay-${Date.now()}.db`;
process.env.LTM_DB_PATH = dbPath;

let computeDecayScore: (memory: import("../db.js").Memory) => number;

/** Build a minimal Memory object for testing decay. */
function makeMemory(
  overrides: Partial<import("../db.js").Memory> = {}
): import("../db.js").Memory {
  const now = new Date().toISOString();
  return {
    id: 1,
    content: "test memory",
    category: "pattern",
    importance: 3,
    confidence: 1.0,
    source: null,
    project_scope: null,
    dedup_key: null,
    created_at: now,
    last_confirmed_at: now,
    last_used_at: now,
    confirm_count: 1,
    status: "active",
    ...overrides,
  };
}

/** Return ISO string for N days ago. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

beforeAll(async () => {
  const db = await import("../db.js");
  computeDecayScore = db.computeDecayScore;
});

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
});

describe("computeDecayScore()", () => {
  it("returns a number", () => {
    const score = computeDecayScore(makeMemory());
    expect(typeof score).toBe("number");
  });

  it("importance=5 returns importance × confidence (no decay, Infinity half-life)", () => {
    const memory = makeMemory({ importance: 5, confidence: 0.8, last_used_at: daysAgo(365) });
    const score = computeDecayScore(memory);
    expect(score).toBeCloseTo(5 * 0.8, 6);
  });

  it("importance=5 with confidence=1.0 returns exactly 5", () => {
    const memory = makeMemory({ importance: 5, confidence: 1.0, last_used_at: daysAgo(1000) });
    expect(computeDecayScore(memory)).toBeCloseTo(5, 6);
  });

  it("importance=1 + 30-day-old access gives score < importance × confidence", () => {
    const memory = makeMemory({
      importance: 1,
      confidence: 1.0,
      last_used_at: daysAgo(30),
      last_confirmed_at: daysAgo(30),
      created_at: daysAgo(30),
    });
    const score = computeDecayScore(memory);
    const maxScore = 1 * 1.0;
    expect(score).toBeLessThan(maxScore);
  });

  it("score decreases as last_used_at ages (non-importance-5 memories)", () => {
    const fresh = makeMemory({
      importance: 3,
      confidence: 1.0,
      last_used_at: daysAgo(1),
      last_confirmed_at: daysAgo(1),
      created_at: daysAgo(1),
    });
    const stale = makeMemory({
      importance: 3,
      confidence: 1.0,
      last_used_at: daysAgo(60),
      last_confirmed_at: daysAgo(60),
      created_at: daysAgo(60),
    });
    expect(computeDecayScore(fresh)).toBeGreaterThan(computeDecayScore(stale));
  });

  it("formula: score = importance × confidence × 0.5^(days/halfLife)", () => {
    // importance=4, halfLife=180 days, 180 days old → decay=0.5 → score=4×1×0.5=2
    const memory = makeMemory({
      importance: 4,
      confidence: 1.0,
      last_used_at: daysAgo(180),
      last_confirmed_at: daysAgo(180),
      created_at: daysAgo(180),
    });
    const score = computeDecayScore(memory);
    // Allow small floating-point tolerance
    expect(score).toBeCloseTo(2.0, 1);
  });

  it("score is always positive (never zero or negative)", () => {
    const ancient = makeMemory({
      importance: 1,
      confidence: 0.5,
      last_used_at: daysAgo(1000),
      last_confirmed_at: daysAgo(1000),
      created_at: daysAgo(1000),
    });
    expect(computeDecayScore(ancient)).toBeGreaterThan(0);
  });
});
