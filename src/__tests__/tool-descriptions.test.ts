import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

// The full server moved into the packaged module (src/mcp-server.ts is now a
// thin wrapper) — tool descriptions live in openltm-core's mcp/server.ts.
const source = readFileSync("packages/openltm-core/src/mcp/server.ts", "utf-8");

/** Extract the description string for a given tool name. */
function getDescription(toolName: string): string {
  // Match: server.tool(\n  "<name>",\n  "<description>",
  const pattern = new RegExp(
    `server\\.tool\\(\\s*"${toolName}",\\s*"([^"]+)"`,
    "s",
  );
  const match = pattern.exec(source);
  if (!match) throw new Error(`Tool "${toolName}" not found in mcp-server.ts`);
  return match[1];
}

describe("MCP tool descriptions — WHEN-triggers", () => {
  it("recall: triggers on non-trivial task / unfamiliar area, skips trivial", () => {
    const desc = getDescription("recall");
    expect(desc).toContain("non-trivial task");
    expect(desc).toContain("prior decisions");
    expect(desc).toContain("starting work");
    expect(desc).toContain("Skip");
  });

  it("learn: triggers on non-obvious pattern / decision / gotcha", () => {
    const desc = getDescription("learn");
    expect(desc).toContain("architectural decision");
    expect(desc).toContain("gotcha");
    expect(desc).toContain("pattern");
    expect(desc).toContain("non-obvious");
  });

  it("relate: triggers when two memories connect", () => {
    const desc = getDescription("relate");
    expect(desc).toContain("two memories");
    expect(desc.toLowerCase()).toContain("decision caused a gotcha");
    expect(desc.toLowerCase()).toContain("pattern applies");
  });

  it("forget: triggers when memory is wrong, outdated, or user requests removal", () => {
    const desc = getDescription("forget");
    expect(desc).toContain("wrong");
    expect(desc).toContain("outdated");
    expect(desc).toContain("user requests removal");
  });

  it("context: triggers at session start or when switching projects", () => {
    const desc = getDescription("context");
    expect(desc).toContain("session start");
    expect(desc).toContain("switching projects");
  });

  it("graph: triggers when exploring connections or tracing decision chains", () => {
    const desc = getDescription("graph");
    expect(desc).toContain("exploring connections");
    expect(desc).toContain("tracing decision chains");
  });

  it("context_items: lists specific context types (goals, decisions)", () => {
    const desc = getDescription("context_items");
    expect(desc).toContain("specific context types");
    expect(desc).toContain("goals");
    expect(desc).toContain("decisions");
  });
});
