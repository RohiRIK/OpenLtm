/**
 * .claude-plugin/plugin.json — the MCP server must open the same database as the
 * hooks. Hooks resolve LTM_DB_PATH → ${CLAUDE_PLUGIN_DATA}/openltm.db; Claude
 * Code passes the user's environment to plugin MCP servers, so forcing
 * LTM_DB_PATH in the manifest split hooks and MCP onto two databases whenever
 * the user exported LTM_DB_PATH (found by the 2.17.0 release verification;
 * verified live with Claude Code 2.1.295).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", ".claude-plugin", "plugin.json"), "utf-8")) as {
  mcpServers: Record<string, { env?: Record<string, string> }>;
};

describe("plugin manifest", () => {
  it("does not pin the MCP server's LTM_DB_PATH; passes CLAUDE_PLUGIN_DATA through", () => {
    const env = manifest.mcpServers.memory?.env ?? {};
    expect(env.LTM_DB_PATH).toBeUndefined();
    expect(env.CLAUDE_PLUGIN_DATA).toBe("${CLAUDE_PLUGIN_DATA}");
  });
});
