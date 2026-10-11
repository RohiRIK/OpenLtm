/**
 * cli/install.test.ts — Integration tests for the install orchestrator.
 *
 * Tests the runInstallCli function end-to-end using a tmp homedir so no real
 * config files are touched.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";

function makeTmp(): string {
  const dir = join(
    os.tmpdir(),
    `ltm-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A fake `pi` CLI in the tmp dir: `list` prints what was installed, `install`
 * records it. The real Pi on the machine is never run (it would do a network
 * install into the real user's Pi).
 */
function fakePi(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const state = join(dir, "pi-installed.txt");
  const cmd = join(bin, "pi");
  writeFileSync(cmd, `#!/bin/sh\ncase "$1" in\n  list) cat "${state}" 2>/dev/null; exit 0;;\n  install) echo "@rohirik/pi-ltm" >> "${state}";;\nesac\n`);
  chmodSync(cmd, 0o755);
  return cmd;
}

describe("runInstallCli — orchestration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs into Claude when --claude flag given", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    const result = await runInstallCli({
      targets: { claude: true, opencode: false, pi: false },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.target).toBe("claude");
    expect(result.results[0]!.status).toBe("installed");
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
  });

  it("installs into OpenCode when --opencode flag given", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    const result = await runInstallCli({
      targets: { claude: false, opencode: true, pi: false },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]!.target).toBe("opencode");
    expect(result.results[0]!.status).toBe("installed");
  });

  it("installs into Pi when --pi flag given", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    const result = await runInstallCli({
      targets: { claude: false, opencode: false, pi: true },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
      piCmd: fakePi(tmpDir),
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]!.target).toBe("pi");
    expect(result.results[0]!.status).toBe("installed");
    expect(readFileSync(join(tmpDir, "pi-installed.txt"), "utf8")).toContain("@rohirik/pi-ltm");
  });

  it("e2e: installs all three targets when all flags given", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    const result = await runInstallCli({
      targets: { claude: true, opencode: true, pi: true },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
      piCmd: fakePi(tmpDir),
    });
    expect(result.exitCode).toBe(0);
    expect(result.results.length).toBe(3);
    expect(result.results.map((r) => r.status)).toEqual(["installed", "installed", "installed"]);
    expect(existsSync(join(tmpDir, ".config", "opencode", "opencode.json"))).toBe(true);

    // Verify Claude and OpenCode config files were created
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
  });

  it("second run → all skipped", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    const opts = {
      targets: { claude: true, opencode: true, pi: true },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
      piCmd: fakePi(tmpDir),
    };
    await runInstallCli(opts);
    const second = await runInstallCli(opts);
    expect(second.exitCode).toBe(0);
    const statuses = second.results.map((r) => r.status);
    expect(statuses.every((s) => s === "skipped")).toBe(true);
  });

  it("no flags + empty homedir → exit code 2 (nothing detected)", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    const result = await runInstallCli({
      targets: { claude: false, opencode: false, pi: false },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
    });
    expect(result.exitCode).toBe(2);
    expect(result.results.length).toBe(0);
  });

  it("auto-detects Claude when .claude/ exists and no flags given", async () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    const { runInstallCli } = await import("../../cli/install.js");
    const result = await runInstallCli({
      targets: { claude: false, opencode: false, pi: false },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results.some((r) => r.target === "claude")).toBe(true);
  });

  it("dryRun propagates to all installers — no files written", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    await runInstallCli({
      targets: { claude: true, opencode: true, pi: true },
      dryRun: true,
      homedir: tmpDir,
      silent: true,
    });
    // No files should be written
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(tmpDir, ".pi", "config.toml"))).toBe(false);
  });

  it("Claude MCP entry lands in ~/.claude.json (where Claude Code reads it)", async () => {
    const { runInstallCli } = await import("../../cli/install.js");
    await runInstallCli({
      targets: { claude: true, opencode: false, pi: false },
      dryRun: false,
      homedir: tmpDir,
      silent: true,
    });
    const claudeJson = JSON.parse(readFileSync(join(tmpDir, ".claude.json"), "utf8")) as Record<string, unknown>;
    const ltm = (claudeJson["mcpServers"] as Record<string, unknown>)["openltm"] as { command: string; args: string[] };
    expect(ltm.command.endsWith("bunx")).toBe(true);
    expect(ltm.args).toEqual(["@rohirik/openltm-core", "mcp-serve"]);
  });
});
