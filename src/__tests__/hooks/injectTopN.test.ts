import { describe, expect, it } from "bun:test";
import { applyInjectTopN } from "../../../hooks/lib/injectTopN.js";


function ids(n: number): Array<{ id: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
}

describe("applyInjectTopN", () => {
  it("limits total memories to injectTopN: 3", () => {
    const { globals, scoped } = applyInjectTopN(ids(10), ids(10), 3);
    expect(globals.length + scoped.length).toBe(3);
    expect(globals.length).toBe(1);
    expect(scoped.length).toBe(2);
  });

  it("defaults to 15 when unset / invalid", () => {
    const a = applyInjectTopN(ids(20), ids(20), undefined);
    expect(a.globals.length + a.scoped.length).toBe(15);

    const b = applyInjectTopN(ids(20), ids(20), null);
    expect(b.globals.length + b.scoped.length).toBe(15);

    const c = applyInjectTopN(ids(20), ids(20), 0);
    expect(c.globals.length + c.scoped.length).toBe(15);
  });

  it("uses full budget for scoped when globals are empty", () => {
    const { globals, scoped } = applyInjectTopN([], ids(20), 3);
    expect(globals.length).toBe(0);
    expect(scoped.length).toBe(3);
  });

  it("does not invent memories when fewer than topN exist", () => {
    const { globals, scoped } = applyInjectTopN(ids(1), ids(1), 15);
    expect(globals.length + scoped.length).toBe(2);
  });
});

// SessionStart's use of injectTopN is asserted on real hook output in sessionstart-compact.test.ts.
