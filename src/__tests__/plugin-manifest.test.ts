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
  it("does not pin the MCP server's LTM_DB_PATH; passes the data dir under a non-reserved key", () => {
    const env = manifest.mcpServers.memory?.env ?? {};
    expect(env.LTM_DB_PATH).toBeUndefined();
    // A self-referential "CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}" reaches the
    // server unexpanded (live, Claude Code 2.1.295) — the DB then landed in a
    // directory literally named "${CLAUDE_PLUGIN_DATA}" inside the project.
    expect(env.CLAUDE_PLUGIN_DATA).toBeUndefined();
    expect(env.LTM_PLUGIN_DATA).toBe("${CLAUDE_PLUGIN_DATA}");
  });
});

describe("normalizePluginEnv (src/pluginEnv.ts)", () => {
  it("prefers a real CLAUDE_PLUGIN_DATA, falls back to LTM_PLUGIN_DATA, drops placeholders", async () => {
    const { normalizePluginEnv } = await import("../pluginEnv.js");
    const run = (env: Record<string, string>) => { const e: NodeJS.ProcessEnv = { ...env }; normalizePluginEnv(e); return e; };
    expect(run({ CLAUDE_PLUGIN_DATA: "/d/real", LTM_PLUGIN_DATA: "/d/other" }).CLAUDE_PLUGIN_DATA).toBe("/d/real");
    expect(run({ CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}", LTM_PLUGIN_DATA: "/d/expanded" }).CLAUDE_PLUGIN_DATA).toBe("/d/expanded");
    expect(run({ CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}" }).CLAUDE_PLUGIN_DATA).toBeUndefined();
    expect(run({ LTM_DB_PATH: "${LTM_DB_PATH}" }).LTM_DB_PATH).toBeUndefined();
    expect(run({ LTM_DB_PATH: "/x/openltm.db" }).LTM_DB_PATH).toBe("/x/openltm.db");
  });

  it("core getDbPath never returns a path built from an unexpanded placeholder", async () => {
    const saved = { db: process.env.LTM_DB_PATH, data: process.env.CLAUDE_PLUGIN_DATA };
    try {
      process.env.LTM_DB_PATH = "${LTM_DB_PATH}";
      process.env.CLAUDE_PLUGIN_DATA = "${CLAUDE_PLUGIN_DATA}";
      const { getDbPath, getDataDir } = await import("../../packages/openltm-core/src/paths.js");
      expect(getDbPath()).not.toContain("${");
      expect(getDataDir(() => "/fallback/openltm.db")).toBe("/fallback");
    } finally {
      if (saved.db === undefined) delete process.env.LTM_DB_PATH; else process.env.LTM_DB_PATH = saved.db;
      if (saved.data === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = saved.data;
    }
  });
});
