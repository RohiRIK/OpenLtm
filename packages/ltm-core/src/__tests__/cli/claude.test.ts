/**
 * cli/claude.test.ts — Unit tests for the Claude Code installer.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";

function makeTmp(): string {
  const dir = join(
    os.tmpdir(),
    `ltm-claude-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readSettings(tmpDir: string): Record<string, unknown> {
  const p = join(tmpDir, ".claude", "settings.json");
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

describe("installClaude", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates settings.json with MCP entry and all 3 hooks", async () => {
    const { installClaude } = await import("../../cli/claude.js");
    const result = await installClaude({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    const s = readSettings(tmpDir);
    const servers = s["mcpServers"] as Record<string, unknown>;
    expect(servers).toBeDefined();
    expect(servers["ltm"]).toBeDefined();

    const hooks = s["hooks"] as Record<string, unknown[]>;
    expect(hooks).toBeDefined();
    expect(Array.isArray(hooks["SessionStart"])).toBe(true);
    expect(Array.isArray(hooks["PreCompact"])).toBe(true);
    expect(Array.isArray(hooks["PostEditCheck"])).toBe(true);
  });

  it("second run returns status skipped (idempotent)", async () => {
    const { installClaude } = await import("../../cli/claude.js");
    const first = await installClaude({ homedir: tmpDir });
    expect(first.status).toBe("installed");

    const second = await installClaude({ homedir: tmpDir });
    expect(second.status).toBe("skipped");
  });

  it("preserves existing mcpServers entries from other tools", async () => {
    // Pre-create a settings.json with another MCP server
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { existingTool: { command: "npx", args: ["some-tool"] } } }),
      "utf8",
    );

    const { installClaude } = await import("../../cli/claude.js");
    await installClaude({ homedir: tmpDir });

    const s = readSettings(tmpDir);
    const servers = s["mcpServers"] as Record<string, unknown>;
    expect(servers["existingTool"]).toBeDefined();
    expect(servers["ltm"]).toBeDefined();
  });

  it("dryRun=true does not write any files", async () => {
    const { installClaude } = await import("../../cli/claude.js");
    const result = await installClaude({ homedir: tmpDir, dryRun: true });
    expect(result.status).toBe("installed");

    const settingsFile = join(tmpDir, ".claude", "settings.json");
    expect(existsSync(settingsFile)).toBe(false);
  });

  it("creates settings.json when .claude/ directory does not exist", async () => {
    const { installClaude } = await import("../../cli/claude.js");
    // tmpDir has no .claude subdirectory
    const result = await installClaude({ homedir: tmpDir });
    expect(result.status).toBe("installed");
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
  });

  it("includes the correct MCP command and args", async () => {
    const { installClaude } = await import("../../cli/claude.js");
    await installClaude({ homedir: tmpDir });

    const s = readSettings(tmpDir);
    const ltm = (s["mcpServers"] as Record<string, unknown>)["ltm"] as {
      command: string;
      args: string[];
    };
    expect(ltm.command).toBe("bunx");
    expect(ltm.args).toEqual(["@rohirik/ltm-core", "mcp-serve"]);
  });

  it("includes all 3 hook events with correct command", async () => {
    const { installClaude } = await import("../../cli/claude.js");
    await installClaude({ homedir: tmpDir });

    const s = readSettings(tmpDir);
    const hooks = s["hooks"] as Record<string, Array<{ command: string; args: string[] }>>;

    for (const event of ["SessionStart", "PreCompact", "PostEditCheck"]) {
      const entries = hooks[event];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]!.command).toBe("bunx");
      expect(entries[0]!.args[0]).toBe("@rohirik/ltm-core");
    }
  });
});
