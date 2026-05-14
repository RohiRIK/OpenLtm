/**
 * cli/pi.test.ts — Unit tests for the Pi installer.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";

function makeTmp(): string {
  const dir = join(
    os.tmpdir(),
    `ltm-pi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("installPi", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates ~/.pi/config.toml when no config exists", async () => {
    const { installPi } = await import("../../cli/pi.js");
    const result = await installPi({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    const configPath = join(tmpDir, ".pi", "config.toml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain("@rohirik/pi-ltm");
    expect(content).toContain("[[extensions]]");
  });

  it("appends extension block to existing ~/.pi/config.toml", async () => {
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const configPath = join(tmpDir, ".pi", "config.toml");
    const existingContent = `# Pi configuration\n[settings]\ntheme = "dark"\n`;
    writeFileSync(configPath, existingContent, "utf8");

    const { installPi } = await import("../../cli/pi.js");
    const result = await installPi({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    const content = readFileSync(configPath, "utf8");
    // Preserves existing content
    expect(content).toContain("# Pi configuration");
    expect(content).toContain('theme = "dark"');
    // Appended new block
    expect(content).toContain("[[extensions]]");
    expect(content).toContain("@rohirik/pi-ltm");
  });

  it("uses ~/pi.toml if that exists instead of ~/.pi/config.toml", async () => {
    const piToml = join(tmpDir, "pi.toml");
    writeFileSync(piToml, "# Root pi config\n", "utf8");

    const { installPi } = await import("../../cli/pi.js");
    const result = await installPi({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    const content = readFileSync(piToml, "utf8");
    expect(content).toContain("@rohirik/pi-ltm");
    // ~/.pi/config.toml should NOT have been created
    expect(existsSync(join(tmpDir, ".pi", "config.toml"))).toBe(false);
  });

  it("prefers ~/.pi/config.toml over ~/pi.toml when both exist", async () => {
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    writeFileSync(join(tmpDir, ".pi", "config.toml"), "# dot-pi config\n", "utf8");
    writeFileSync(join(tmpDir, "pi.toml"), "# root pi config\n", "utf8");

    const { installPi } = await import("../../cli/pi.js");
    await installPi({ homedir: tmpDir });

    // The dot-pi config should have the extension
    expect(readFileSync(join(tmpDir, ".pi", "config.toml"), "utf8")).toContain("@rohirik/pi-ltm");
    // The root pi.toml should be unchanged
    expect(readFileSync(join(tmpDir, "pi.toml"), "utf8")).not.toContain("@rohirik/pi-ltm");
  });

  it("skips if @rohirik/pi-ltm is already in the config file", async () => {
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const configPath = join(tmpDir, ".pi", "config.toml");
    writeFileSync(
      configPath,
      `[[extensions]]\npackage = "@rohirik/pi-ltm"\n`,
      "utf8",
    );

    const { installPi } = await import("../../cli/pi.js");
    const result = await installPi({ homedir: tmpDir });
    expect(result.status).toBe("skipped");
  });

  it("dryRun=true does not create any files", async () => {
    const { installPi } = await import("../../cli/pi.js");
    const result = await installPi({ homedir: tmpDir, dryRun: true });
    expect(result.status).toBe("installed");

    expect(existsSync(join(tmpDir, ".pi", "config.toml"))).toBe(false);
    expect(existsSync(join(tmpDir, "pi.toml"))).toBe(false);
  });

  it("dryRun=true does not modify existing files", async () => {
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const configPath = join(tmpDir, ".pi", "config.toml");
    const original = "# original content\n";
    writeFileSync(configPath, original, "utf8");

    const { installPi } = await import("../../cli/pi.js");
    await installPi({ homedir: tmpDir, dryRun: true });

    expect(readFileSync(configPath, "utf8")).toBe(original);
  });
});
