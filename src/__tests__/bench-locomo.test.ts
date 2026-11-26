/** scripts/bench/locomo.ts — the parsing that decides what is scored. */
import { describe, expect, it } from "bun:test";
import { evidenceIds, parseSessionDate } from "../../scripts/bench/locomo";

describe("LoCoMo bench parsing", () => {
  it("parses session dates to SQLite UTC format", () => {
    expect(parseSessionDate("1:56 pm on 8 May, 2023")).toBe("2023-05-08 13:56:00");
    expect(parseSessionDate("12:04 am on 20 January, 2024")).toBe("2024-01-20 00:04:00");
    expect(parseSessionDate("sometime")).toBeUndefined();
  });
  it("normalises evidence ids and drops malformed ones", () => {
    expect(evidenceIds({ question: "", category: 1, evidence: ["D8:6; D9:17", "D", "D:11:26", "D9:1 D4:4"] })).toEqual(["D8:6", "D9:17", "D9:1", "D4:4"]);
  });
});
