/**
 * cli/claude.test.ts — the `bunx @rohirik/openltm-core --claude` installer.
 *
 * Verified against a real Claude Code: the MCP server must live in ~/.claude.json
 * (settings.json `mcpServers` is never loaded) and hooks must use the
 * `{ matcher, hooks: [{ type, command }] }` shape (the old `{ command, args }`
 * entries registered 0 hooks).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";

type HookEntry = { matcher?: string; hooks?: Array<{ type: string; command: string; timeout?: number }>; command?: string };

describe("installClaude", () => {
  let home: string;
  const settingsPath = () => join(home, ".claude", "settings.json");
  const claudeJsonPath = () => join(home, ".claude.json");
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
  const install = async (dryRun = false) => (await import("../../cli/claude.js")).installClaude({ homedir: home, dryRun });

  beforeEach(() => { home = mkdtempSync(join(os.tmpdir(), "ltm-claude-install-")); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("writes the MCP server to ~/.claude.json with an absolute shared DB path", async () => {
    expect((await install()).status).toBe("installed");
    const mcp = read(claudeJsonPath()).mcpServers.openltm;
    expect(mcp.type).toBe("stdio");
    expect(mcp.args).toEqual(["@rohirik/openltm-core", "mcp-serve"]);
    expect(mcp.command.endsWith("bunx")).toBe(true);
    expect(mcp.env.LTM_DB_PATH).toBe(join(home, ".claude", "plugins", "data", "OpenLtm-openltm", "openltm.db"));
    expect(read(settingsPath()).mcpServers).toBeUndefined();
  });

  it("wires SessionStart and SessionEnd in Claude Code's hook format with LTM_DB_PATH", async () => {
    await install();
    const hooks = read(settingsPath()).hooks as Record<string, HookEntry[]>;
    expect(Object.keys(hooks).sort()).toEqual(["SessionEnd", "SessionStart"]);
    for (const event of ["SessionStart", "SessionEnd"]) {
      const [entry] = hooks[event]!;
      expect(entry!.matcher).toBe("");
      expect(entry!.hooks![0]!.type).toBe("command");
      expect(entry!.hooks![0]!.command).toContain(`LTM_DB_PATH=${join(home, ".claude", "plugins", "data", "OpenLtm-openltm", "openltm.db")}`);
      expect(entry!.hooks![0]!.command).toContain(`@rohirik/openltm-core hook --name ${event}`);
    }
  });

  it("is idempotent", async () => {
    await install();
    const first = readFileSync(settingsPath(), "utf8") + readFileSync(claudeJsonPath(), "utf8");
    expect((await install()).status).toBe("skipped");
    expect(readFileSync(settingsPath(), "utf8") + readFileSync(claudeJsonPath(), "utf8")).toBe(first);
  });

  it("replaces the legacy entries Claude Code ignored and keeps other tools' config", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify({
      mcpServers: { openltm: { command: "bunx" }, other: { command: "x" } },
      hooks: {
        SessionStart: [
          { command: "bunx", args: ["@rohirik/openltm-core", "hook", "--name", "SessionStart"] },
          { matcher: "", hooks: [{ type: "command", command: "echo other-tool" }] },
        ],
        PostEditCheck: [{ command: "bunx", args: ["@rohirik/openltm-core", "hook", "--name", "PostEditCheck"] }],
      },
      theme: "dark",
    }));
    writeFileSync(claudeJsonPath(), JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } }, numStartups: 3 }));
    await install();
    const settings = read(settingsPath());
    expect(settings.theme).toBe("dark");
    expect(settings.mcpServers).toEqual({ other: { command: "x" } });
    expect(settings.hooks.PostEditCheck).toBeUndefined();
    const start = settings.hooks.SessionStart as HookEntry[];
    expect(start.length).toBe(2);
    expect(start[0]!.hooks![0]!.command).toBe("echo other-tool");
    expect(start.some((e) => e.command === "bunx")).toBe(false);
    const claudeJson = read(claudeJsonPath());
    expect(claudeJson.numStartups).toBe(3);
    expect(Object.keys(claudeJson.mcpServers).sort()).toEqual(["github", "openltm"]);
  });

  it("dryRun writes nothing", async () => {
    expect((await install(true)).detail).toContain("dry-run");
    expect(existsSync(settingsPath())).toBe(false);
    expect(existsSync(claudeJsonPath())).toBe(false);
  });

  it("refuses to overwrite a malformed settings.json", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath(), "{ not json");
    const res = await install();
    expect(res.status).toBe("error");
    expect(readFileSync(settingsPath(), "utf8")).toBe("{ not json");
  });
});
