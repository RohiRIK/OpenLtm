import { describe, expect, it } from "bun:test";
import { trimSummary } from "../../../hooks/lib/summaryTrim";

const items = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

describe("trimSummary", () => {
  it("returns content unchanged when within budget", () => {
    const text = "# p | 2026-10-04\n\nGOAL:\nship it\n";
    expect(trimSummary(text, 60)).toBe(text);
  });

  it("keeps the header and goal of a PreCompact snapshot; trims the oldest entries of the largest section", () => {
    const text = [
      "# Context Summary",
      "**Project:** demo (/w/demo)",
      "**Compaction checkpoint:** 2026-10-04 10:00:00",
      "",
      "## Current Goal", "", "ship the hooks", "",
      "## Recent Progress", "", ...items("progress", 30), "",
      "## Key Decisions", "", ...items("decision", 5), "",
    ].join("\n");
    const out = trimSummary(text, 30).split("\n").filter((l, i, a) => i < a.length - 1 || l !== "");

    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.slice(0, 3)).toEqual([
      "# Context Summary",
      "**Project:** demo (/w/demo)",
      "**Compaction checkpoint:** 2026-10-04 10:00:00",
    ]);
    expect(out).toContain("ship the hooks");
    expect(out).toContain("## Recent Progress");
    expect(out).toContain("decision 1");
    expect(out).toContain("progress 30");   // newest progress kept
    expect(out).not.toContain("progress 1"); // oldest progress dropped first
    expect(out[out.length - 1]).toMatch(/^… \(\d+ older summary lines trimmed\)$/);
  });

  it("understands the exportContextMarkdown format (GOAL:/PROGRESS:/DEC:/WATCH:)", () => {
    const text = [
      "# demo | 2026-10-04", "",
      "GOAL:", "the goal", "",
      "PROGRESS:", ...items("p", 20), "",
      "DEC:", ...items("d", 15), "",
      "WATCH:", ...items("w", 15), "",
    ].join("\n");
    const out = trimSummary(text, 40).split("\n");
    expect(out[0]).toBe("# demo | 2026-10-04");
    for (const h of ["GOAL:", "PROGRESS:", "DEC:", "WATCH:", "the goal", "w 15", "d 15", "p 20"]) expect(out).toContain(h);
  });
});
