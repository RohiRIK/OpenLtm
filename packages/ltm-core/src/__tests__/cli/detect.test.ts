/**
 * cli/detect.test.ts — Unit tests for the agent detection logic.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

function makeTmp(): string {
  const dir = join(os.tmpdir(), `ltm-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectAgents", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns all false for an empty directory", async () => {
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result).toEqual({ claude: false, opencode: false, pi: false });
  });

  it("detects Claude when .claude/ exists", async () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result.claude).toBe(true);
    expect(result.opencode).toBe(false);
    expect(result.pi).toBe(false);
  });

  it("detects OpenCode when ~/.config/opencode exists", async () => {
    mkdirSync(join(tmpDir, ".config", "opencode"), { recursive: true });
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result.claude).toBe(false);
    expect(result.opencode).toBe(true);
    expect(result.pi).toBe(false);
  });

  it("detects Pi when ~/.pi/ directory exists", async () => {
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result.claude).toBe(false);
    expect(result.opencode).toBe(false);
    expect(result.pi).toBe(true);
  });

  it("detects Pi when ~/pi.toml file exists", async () => {
    const { writeFileSync } = await import("fs");
    writeFileSync(join(tmpDir, "pi.toml"), "# Pi config\n");
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result.pi).toBe(true);
  });

  it("detects multiple agents when multiple dirs exist", async () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    mkdirSync(join(tmpDir, ".config", "opencode"), { recursive: true });
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result).toEqual({ claude: true, opencode: true, pi: true });
  });

  it("detects Claude + Pi but not OpenCode", async () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(result).toEqual({ claude: true, opencode: false, pi: true });
  });

  it("exports DetectResult shape (type check via runtime properties)", async () => {
    const { detectAgents } = await import("../../cli/detect.js");
    const result = detectAgents(tmpDir);
    expect(typeof result.claude).toBe("boolean");
    expect(typeof result.opencode).toBe("boolean");
    expect(typeof result.pi).toBe("boolean");
  });
});
