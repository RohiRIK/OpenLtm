/**
 * UserPromptSubmit relevance on a realistic, labelled corpus (fixtures/promptRecallCorpus.ts):
 * the per-prompt injection must stay precise (little noise) without missing what
 * the prompt is plainly about. Measured with scripts/qa/prompt-recall-eval.ts —
 * before the stemmed, IDF-weighted scoring: precision 85.5%, recall 67.3%.
 */
import { describe, expect, it } from "bun:test";
import { stem } from "../../../hooks/lib/promptRecall";
import { evaluate } from "../../../scripts/qa/prompt-recall-eval";

describe("prompt recall stemming", () => {
  it("maps inflections to one stem and leaves short words alone", () => {
    const same = [["running", "runs", "run"], ["merged", "merge", "merging"], ["queries", "query"], ["errors", "error"],
      ["duplicates", "duplicate"], ["stored", "store"], ["flagged", "flagging", "flag"], ["boxes", "box"], ["strings", "string"]];
    for (const group of same) expect(new Set(group.map(stem)).size).toBe(1);
    expect(stem("status")).toBe("status");
    expect(stem("address")).toBe("address");
    expect(stem("ci")).toBe("ci");
    expect(stem("v2.18")).toBe("v2.18");
  });
});

describe("prompt recall relevance (labelled corpus)", () => {
  const r = evaluate();
  const precision = (r.hits - r.noise) / r.hits;
  const recall = r.found / r.wanted;

  it("injects little noise", () => {
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });

  it("surfaces the memories a prompt is plainly about", () => {
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it("stays silent on chit-chat and generic task prompts", () => {
    for (const prompt of ["ok thanks, looks good to me", "let's continue with the next item on the list",
      "please fix the bug on this page", "add a test for the new function and run it", "explain how the code is organized"]) {
      const row = r.rows.find((line) => line.includes(`] ${prompt}\n`));
      expect(row).toBeDefined();
      expect(row).toContain("hits=-");
    }
  });
});
