import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { applyInjectTopN } from "../../../hooks/lib/injectTopN.js";

const SRC = join(import.meta.dir, "..", "..", "..", "hooks", "src", "SessionStart.ts");

describe("SessionStart compact index", () => {
  it("builds compact index lines (not full content dumps)", () => {
    const src = readFileSync(SRC, "utf-8");
    expect(src).toContain("LTM index (use MCP get <id> for full memory)");
    expect(src).toContain("indexLine");
    expect(src).toContain("applyInjectTopN");
    expect(src).toContain("buildLtmSection(name, sessionContext, injectTopN");
    expect(src).toContain("scrubForEgress");
    expect(src).toContain("scrubForEgress(graphInsights)");
  });

  it("honors injectTopN when compacting", () => {
    const globals = Array.from({ length: 10 }, (_, i) => ({ id: i, content: `g${i}` }));
    const scoped = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, content: `s${i}` }));
    const capped = applyInjectTopN(globals, scoped, 3);
    expect(capped.globals.length + capped.scoped.length).toBe(3);
  });
});
