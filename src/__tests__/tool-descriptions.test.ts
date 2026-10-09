import { describe, expect, it } from "bun:test";
import { buildMcpServer } from "@rohirik/openltm-core/mcp";

// The full server moved into the packaged module (src/mcp-server.ts is now a
// thin wrapper) — tool descriptions live in openltm-core's mcp/server.ts.
// Read them from the registered tools (building the server touches no DB).
const tools = (buildMcpServer() as unknown as {
  _registeredTools: Record<string, { description?: string }>;
})._registeredTools;

/** The registered description for a given tool name. */
function getDescription(toolName: string): string {
  const description = tools[toolName]?.description;
  if (!description) throw new Error(`Tool "${toolName}" not registered in mcp/server.ts`);
  return description;
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

  it("context_add: records goals, decisions, gotchas, progress", () => {
    const desc = getDescription("context_add");
    for (const word of ["goal", "decision", "gotcha", "progress"]) expect(desc).toContain(word);
  });

  it("proposals: reviews pending proposals (list / accept / reject)", () => {
    const desc = getDescription("proposals");
    expect(desc).toContain("proposals");
    expect(desc).toContain("accept");
    expect(desc).toContain("reject");
  });
});
