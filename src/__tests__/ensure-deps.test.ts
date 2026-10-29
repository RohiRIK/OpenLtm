/**
 * ensure-deps.test.ts — the plugin installs its own packages when Claude Code
 * skipped them (bun.lock lists more than one workspace), once, without
 * writing to stdout, and run-hook.sh skips a hook quietly while they install.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEPS_LOCK, ensurePluginDeps, pluginDepsReady } from "../../scripts/ensure-deps.js";

const REPO = join(import.meta.dir, "..", "..");
const ENSURE_DEPS = join(REPO, "scripts", "ensure-deps.ts");
const SENTINELS = ["@rohirik/openltm-core", "@modelcontextprotocol/sdk", "zod"];

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function pluginRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ltm-ensure-deps-"));
  dirs.push(root);
  return root;
}

/** A stand-in `bun` whose `install` writes the sentinel packages after a short delay and counts runs. */
function fakeBun(root: string, delay = "0.3"): string {
  const bin = join(root, "fake-bun.sh");
  const mk = SENTINELS.map((p) => `mkdir -p node_modules/${p} && echo '{}' > node_modules/${p}/package.json`).join("\n");
  writeFileSync(bin, `#!/bin/sh\necho run >> installs.count\nsleep ${delay}\n${mk}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function installs(root: string): number {
  const f = join(root, "installs.count");
  return existsSync(f) ? readFileSync(f, "utf-8").trim().split("\n").length : 0;
}

describe("ensurePluginDeps", () => {
  it("returns at once and installs nothing when the packages are there", () => {
    const root = pluginRoot();
    for (const p of SENTINELS) {
      mkdirSync(join(root, "node_modules", p), { recursive: true });
      writeFileSync(join(root, "node_modules", p, "package.json"), "{}");
    }
    expect(ensurePluginDeps(root, { bun: fakeBun(root), logPath: join(root, "log") })).toBe(true);
    expect(installs(root)).toBe(0);
  });

  it("installs once when missing; a concurrent caller waits for that install", () => {
    const root = pluginRoot();
    const bun = fakeBun(root);
    const log = join(root, "log");
    expect(ensurePluginDeps(root, { bun, logPath: log })).toBe(false); // started, not waited for
    expect(existsSync(join(root, DEPS_LOCK))).toBe(true);
    expect(ensurePluginDeps(root, { bun, logPath: log, waitMs: 10_000 })).toBe(true);
    expect(installs(root)).toBe(1);
    expect(existsSync(join(root, DEPS_LOCK))).toBe(false); // the install released it
  });

  it("does not start a second install while a fresh lock is held", () => {
    const root = pluginRoot();
    mkdirSync(join(root, DEPS_LOCK));
    expect(ensurePluginDeps(root, { bun: fakeBun(root), logPath: join(root, "log"), waitMs: 300 })).toBe(false);
    expect(installs(root)).toBe(0);
  });

  it("takes over a stale lock left by an install that died", () => {
    const root = pluginRoot();
    const lock = join(root, DEPS_LOCK);
    mkdirSync(lock);
    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(lock, old, old);
    expect(ensurePluginDeps(root, { bun: fakeBun(root), logPath: join(root, "log"), waitMs: 10_000 })).toBe(true);
    expect(installs(root)).toBe(1);
  });

  it("writes nothing to stdout (hook stdout is injected; MCP stdout is the protocol)", () => {
    const root = pluginRoot();
    const bun = fakeBun(root, "0");
    const script = join(root, "run.ts");
    writeFileSync(
      script,
      `import { ensurePluginDeps } from ${JSON.stringify(ENSURE_DEPS)};\n` +
        `ensurePluginDeps(${JSON.stringify(root)}, { bun: ${JSON.stringify(bun)}, logPath: ${JSON.stringify(join(root, "log"))}, waitMs: 10000 });\n`,
    );
    const r = Bun.spawnSync([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("");
    expect(r.stderr.toString()).toContain("installing the plugin's packages");
    expect(pluginDepsReady(root)).toBe(true);
  });
});

describe("run-hook.sh while the packages install", () => {
  it("skips the hook quietly (exit 0, empty stdout) instead of crashing", () => {
    const root = pluginRoot();
    const plugin = join(root, "plugin");
    mkdirSync(join(plugin, "hooks", "bin"), { recursive: true });
    mkdirSync(join(plugin, "scripts"));
    cpSync(join(REPO, "hooks", "bin", "run-hook.sh"), join(plugin, "hooks", "bin", "run-hook.sh"));
    cpSync(ENSURE_DEPS, join(plugin, "scripts", "ensure-deps.ts"));
    cpSync(join(REPO, "scripts", "plugin-runtime.ts"), join(plugin, "scripts", "plugin-runtime.ts"));
    writeFileSync(join(plugin, "package.json"), "{}");
    mkdirSync(join(plugin, DEPS_LOCK)); // another launcher is mid-install
    const hook = join(root, "Probe.ts");
    writeFileSync(hook, "console.log('hook ran');\n");

    const r = Bun.spawnSync(["sh", join(plugin, "hooks", "bin", "run-hook.sh"), hook], {
      cwd: root,
      env: { ...process.env, CLAUDE_PLUGIN_DATA: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("");
  });
});
