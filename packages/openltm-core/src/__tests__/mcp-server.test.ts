/**
 * mcp-server.test.ts — smoke tests for packages/openltm-core/src/mcp/server.ts
 *
 * The full stdio handshake is covered by manual smoke tests; here we assert the
 * module loads, the factory builds a connectable server, and the tool surface
 * matches the documented contract.
 */
import { describe, it, expect } from "bun:test";

describe("mcp/server — buildMcpServer", () => {
  it("exports buildMcpServer and startMcpServer", async () => {
    const mod = await import("../mcp/server.js");
    expect(typeof mod.buildMcpServer).toBe("function");
    expect(typeof mod.startMcpServer).toBe("function");
  });

  it("builds a server exposing the documented tool set", async () => {
    const { buildMcpServer } = await import("../mcp/server.js");
    const server = buildMcpServer();
    expect(typeof server.connect).toBe("function");
    // McpServer keeps registered tools in a private map — assert via the
    // public-ish _registeredTools record the SDK maintains.
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    const names = Object.keys(tools);
    for (const expected of ["recall", "learn", "relate", "forget", "revalidate", "admin_audit", "context", "graph", "context_items"]) {
      expect(names).toContain(expected);
    }
  });

  it("accepts host config hooks without invoking them at build time", async () => {
    const { buildMcpServer } = await import("../mcp/server.js");
    let called = false;
    buildMcpServer({
      isEnabled: async () => { called = true; return true; },
      categoriseThreshold: async () => { called = true; return 0.6; },
    });
    expect(called).toBe(false);
  });
});
