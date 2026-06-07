import { describe, expect, it } from "bun:test";

import { categorise, type MemoryCategory } from "@rohirik/openltm-core";
const CASES: Array<[MemoryCategory, string]> = [
  ["gotcha",       "⚠ Never use npm in this project, it breaks bun lockfile"],
  ["architecture", "The system uses a layered architecture with a shared-db module as the single database interface."],
  ["workflow",     "Workflow: first run bun install, then bun run build, finally bun test. Checklist for every PR."],
  ["preference",   "Always prefer bun over npm. Convention: use camelCase naming for all variables."],
  ["constraint",   "Must use parameterized queries. Mandatory: rate limiting on all endpoints. Forbidden: hardcoded secrets."],
  ["pattern",      "Use the repository pattern: implement findAll, findById, create, update, delete methods."],
];

describe("categorise — heuristic", () => {
  it.each(CASES)("classifies %s content", async (expectedCategory, text) => {
    const r = await categorise(text, 0.4);
    expect(r.category).toBe(expectedCategory);
    expect(r.source).toBe("heuristic");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("returns confidence >= threshold when heuristic is confident", async () => {
    const r = await categorise(
      "⚠ Warning: avoid mutating objects directly. Bug found when spread was missing.",
      0.6,
    );
    expect(r.confidence).toBeGreaterThanOrEqual(0.1);
  });

  it("returns a valid category for empty content", async () => {
    const r = await categorise("", 0.6);
    expect(["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"]).toContain(r.category);
    expect(r.confidence).toBe(0);
  });

  it("source is always heuristic when ANTHROPIC_API_KEY is not set", async () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    const r = await categorise("some ambiguous content about things", 1.0);
    expect(r.source).toBe("heuristic");
    if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
  });

  it("falls back to heuristic when LLM fails (no API key, threshold very high)", async () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    const r = await categorise("mixed content with pattern and workflow and constraint", 1.0);
    expect(r.source).toBe("heuristic");
    if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
  });
});
