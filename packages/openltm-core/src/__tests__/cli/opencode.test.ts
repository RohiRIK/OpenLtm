/**
 * cli/opencode.test.ts — Unit tests for the OpenCode installer.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";

function makeTmp(): string {
  const dir = join(
    os.tmpdir(),
    `ltm-opencode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultConfigPath(tmpDir: string): string {
  // Tests run on linux in CI or darwin locally — always use .config path since
  // we're not in a real darwin environment with ~/Library
  return join(tmpDir, ".config", "opencode", "opencode.json");
}

describe("installOpenCode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates new config with correct shape when no config exists", async () => {
    const { installOpenCode } = await import("../../cli/opencode.js");
    const result = await installOpenCode({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    // Find the created file (either .config or Library path)
    const linuxPath = join(tmpDir, ".config", "opencode", "opencode.json");
    const darwinPath = join(tmpDir, "Library", "Application Support", "opencode", "opencode.json");
    const created = existsSync(linuxPath) ? linuxPath : darwinPath;
    expect(existsSync(created)).toBe(true);

    const cfg = JSON.parse(readFileSync(created, "utf8")) as Record<string, unknown>;
    expect(cfg["$schema"]).toBe("https://opencode.ai/config.json");
    expect(Array.isArray(cfg["plugin"])).toBe(true);
    expect((cfg["plugin"] as string[]).some((p) => p.includes("@rohirik/opencode-ltm"))).toBe(true);
  });

  it("patches existing config by adding to plugin array", async () => {
    // Create existing config
    const configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeFileSync(
      configPath,
      JSON.stringify({ $schema: "https://opencode.ai/config.json", theme: "dark", plugin: [] }),
      "utf8",
    );

    const { installOpenCode } = await import("../../cli/opencode.js");
    const result = await installOpenCode({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(cfg["theme"]).toBe("dark");
    const plugins = cfg["plugin"] as string[];
    expect(plugins.some((p) => p.includes("@rohirik/opencode-ltm"))).toBe(true);
  });

  it("preserves other keys in existing config", async () => {
    const configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        model: "claude-opus-4",
        keybindings: "vim",
        plugin: ["@other/tool@1.0.0"],
      }),
      "utf8",
    );

    const { installOpenCode } = await import("../../cli/opencode.js");
    await installOpenCode({ homedir: tmpDir });

    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(cfg["model"]).toBe("claude-opus-4");
    expect(cfg["keybindings"]).toBe("vim");
    const plugins = cfg["plugin"] as string[];
    expect(plugins).toContain("@other/tool@1.0.0");
    expect(plugins.some((p) => p.includes("@rohirik/opencode-ltm"))).toBe(true);
  });

  // Pre-deploy the customization components so the skip path can be exercised:
  // status is only "skipped" when the plugin is registered AND every component
  // is already present.
  function preDeployComponents(configDir: string): void {
    for (const comp of ["agents", "skills", "plugins"]) {
      const dir = join(configDir, comp);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".installed"), "", "utf8");
    }
  }

  it("skips when plugin is registered and components are already deployed", async () => {
    const configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "opencode.json"),
      JSON.stringify({ plugin: ["@rohirik/opencode-ltm@latest"] }),
      "utf8",
    );
    preDeployComponents(configDir);

    const { installOpenCode } = await import("../../cli/opencode.js");
    const result = await installOpenCode({ homedir: tmpDir });
    expect(result.status).toBe("skipped");
  });

  it("skips even if version differs (matches on substring @rohirik/opencode-ltm)", async () => {
    const configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "opencode.json"),
      JSON.stringify({ plugin: ["@rohirik/opencode-ltm@2.0.0"] }),
      "utf8",
    );
    preDeployComponents(configDir);

    const { installOpenCode } = await import("../../cli/opencode.js");
    const result = await installOpenCode({ homedir: tmpDir });
    expect(result.status).toBe("skipped");
  });

  it("deploys agents, skills, and plugins from the bundled assets", async () => {
    const { installOpenCode } = await import("../../cli/opencode.js");
    const result = await installOpenCode({ homedir: tmpDir });
    expect(result.status).toBe("installed");

    // Components co-locate with the resolved config (.config on linux,
    // Library/Application Support on darwin).
    const linuxDir = join(tmpDir, ".config", "opencode");
    const darwinDir = join(tmpDir, "Library", "Application Support", "opencode");
    const configDir = existsSync(join(linuxDir, "agents")) ? linuxDir : darwinDir;

    // The bundled assets ship an aegis agent, three skills, and an aegis plugin.
    expect(existsSync(join(configDir, "agents", "aegis.md"))).toBe(true);
    expect(existsSync(join(configDir, "skills", "AgentTrustBoundaries", "SKILL.md"))).toBe(true);
    expect(existsSync(join(configDir, "plugins", "aegis.ts"))).toBe(true);
    // Lockfiles and node_modules must never be copied into the user's config.
    expect(existsSync(join(configDir, "skills", "node_modules"))).toBe(false);
  });

  it("dryRun=true does not write any files", async () => {
    const { installOpenCode } = await import("../../cli/opencode.js");
    const result = await installOpenCode({ homedir: tmpDir, dryRun: true });
    expect(result.status).toBe("installed");

    const linuxPath = join(tmpDir, ".config", "opencode", "opencode.json");
    const darwinPath = join(tmpDir, "Library", "Application Support", "opencode", "opencode.json");
    expect(existsSync(linuxPath)).toBe(false);
    expect(existsSync(darwinPath)).toBe(false);
  });
});
