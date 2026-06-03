import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

const source = readFileSync("src/mcp-server.ts", "utf-8");

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
  it("ltm_recall: triggers on non-trivial task / unfamiliar area, skips trivial", () => {
    const desc = getDescription("ltm_recall");
    expect(desc).toContain("non-trivial task");
    expect(desc).toContain("prior decisions");
    expect(desc).toContain("starting work");
    expect(desc).toContain("Skip");
  });

  it("ltm_learn: triggers on non-obvious pattern / decision / gotcha", () => {
    const desc = getDescription("ltm_learn");
    expect(desc).toContain("architectural decision");
    expect(desc).toContain("gotcha");
    expect(desc).toContain("pattern");
    expect(desc).toContain("non-obvious");
  });

  it("ltm_relate: triggers when two memories connect", () => {
    const desc = getDescription("ltm_relate");
    expect(desc).toContain("two memories");
    expect(desc.toLowerCase()).toContain("decision caused a gotcha");
    expect(desc.toLowerCase()).toContain("pattern applies");
  });

  it("ltm_forget: triggers when memory is wrong, outdated, or user requests removal", () => {
    const desc = getDescription("ltm_forget");
    expect(desc).toContain("wrong");
    expect(desc).toContain("outdated");
    expect(desc).toContain("user requests removal");
  });

  it("ltm_context: triggers at session start or when switching projects", () => {
    const desc = getDescription("ltm_context");
    expect(desc).toContain("session start");
    expect(desc).toContain("switching projects");
  });

  it("ltm_graph: triggers when exploring connections or tracing decision chains", () => {
    const desc = getDescription("ltm_graph");
    expect(desc).toContain("exploring connections");
    expect(desc).toContain("tracing decision chains");
  });

  it("ltm_context_items: lists specific context types (goals, decisions)", () => {
    const desc = getDescription("ltm_context_items");
    expect(desc).toContain("specific context types");
    expect(desc).toContain("goals");
    expect(desc).toContain("decisions");
  });
});
