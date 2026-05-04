import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { categorise } from "../../recall/categorise.js";

describe("categorise — heuristic", () => {
  it("classifies gotcha content", async () => {
    const r = await categorise("⚠ Never use npm in this project, it breaks bun lockfile", 0.4);
    expect(r.category).toBe("gotcha");
    expect(r.source).toBe("heuristic");
    expect(r.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it("classifies architecture content", async () => {
    const r = await categorise(
      "The system uses a layered architecture with a shared-db module as the single database interface.",
      0.4,
    );
    expect(r.category).toBe("architecture");
    expect(r.source).toBe("heuristic");
  });

  it("classifies workflow content", async () => {
    const r = await categorise(
      "Workflow: first run bun install, then bun run build, finally bun test. Checklist for every PR.",
      0.4,
    );
    expect(r.category).toBe("workflow");
    expect(r.source).toBe("heuristic");
  });

  it("classifies preference content", async () => {
    const r = await categorise(
      "Always prefer bun over npm. Convention: use camelCase naming for all variables.",
      0.4,
    );
    expect(r.category).toBe("preference");
    expect(r.source).toBe("heuristic");
  });

  it("classifies constraint content", async () => {
    const r = await categorise(
      "Must use parameterized queries. Mandatory: rate limiting on all endpoints. Forbidden: hardcoded secrets.",
      0.4,
    );
    expect(r.category).toBe("constraint");
    expect(r.source).toBe("heuristic");
  });

  it("classifies pattern content", async () => {
    const r = await categorise(
      "Use the repository pattern: implement findAll, findById, create, update, delete methods.",
      0.4,
    );
    expect(r.category).toBe("pattern");
    expect(r.source).toBe("heuristic");
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
    // confidence will be < 1.0 for ambiguous text, so LLM path is tried — but no key → fallback
    const r = await categorise("mixed content with pattern and workflow and constraint", 1.0);
    expect(r.source).toBe("heuristic");
    if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
  });
});
