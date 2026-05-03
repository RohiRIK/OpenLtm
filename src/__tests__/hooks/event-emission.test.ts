/**
 * Verify that hook source files import and emit the expected structured events.
 * This is a static analysis test — it checks source code, not runtime behaviour.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const HOOKS_SRC = join(import.meta.dir, "..", "..", "..", "hooks", "src");

function hookSrc(name: string): string {
  return readFileSync(join(HOOKS_SRC, name), "utf-8");
}

describe("structured event emission", () => {
  it("SessionStart imports logEvent and EVENTS", () => {
    const src = hookSrc("SessionStart.ts");
    expect(src).toContain("logEvent");
    expect(src).toContain("EVENTS");
    expect(src).toContain("eventNames.js");
  });

  it("SessionStart emits SESSION_START event", () => {
    const src = hookSrc("SessionStart.ts");
    expect(src).toContain("EVENTS.SESSION_START");
  });

  it("UpdateContext imports logEvent and EVENTS", () => {
    const src = hookSrc("UpdateContext.ts");
    expect(src).toContain("logEvent");
    expect(src).toContain("EVENTS");
    expect(src).toContain("eventNames.js");
  });

  it("UpdateContext emits CONTEXT_UPDATED event", () => {
    const src = hookSrc("UpdateContext.ts");
    expect(src).toContain("EVENTS.CONTEXT_UPDATED");
  });

  it("UpdateContext imports from dao/index.js not context.js for writes", () => {
    const src = hookSrc("UpdateContext.ts");
    expect(src).toContain("dao/index.js");
    expect(src).not.toContain('from "../../src/context.js"');
  });

  it("PreCompact imports logEvent and EVENTS", () => {
    const src = hookSrc("PreCompact.ts");
    expect(src).toContain("logEvent");
    expect(src).toContain("EVENTS");
    expect(src).toContain("eventNames.js");
  });

  it("PreCompact emits COMPACT_PRE event", () => {
    const src = hookSrc("PreCompact.ts");
    expect(src).toContain("EVENTS.COMPACT_PRE");
  });

  it("EvaluateSession imports logEvent and EVENTS", () => {
    const src = hookSrc("EvaluateSession.ts");
    expect(src).toContain("logEvent");
    expect(src).toContain("EVENTS");
    expect(src).toContain("eventNames.js");
  });

  it("EvaluateSession emits SESSION_EVALUATED event", () => {
    const src = hookSrc("EvaluateSession.ts");
    expect(src).toContain("EVENTS.SESSION_EVALUATED");
  });

  it("logEvent entries have event field matching the EVENTS constant value", () => {
    // Verify the EVENTS constants are the canonical strings used by /ltm:health aggregation
    const eventNamesSrc = readFileSync(
      join(HOOKS_SRC, "..", "lib", "eventNames.ts"),
      "utf-8"
    );
    expect(eventNamesSrc).toContain('"session.start"');
    expect(eventNamesSrc).toContain('"session.evaluated"');
    expect(eventNamesSrc).toContain('"context.updated"');
    expect(eventNamesSrc).toContain('"compact.pre"');
  });
});
