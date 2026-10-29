import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pluginRuntimeRoot } from "../../scripts/plugin-runtime.js";

const REPO = join(import.meta.dir, "..", "..");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ltm-codex-runtime-")));
  dirs.push(dir);
  const root = join(dir, "plugin with spaces");
  const data = join(dir, "plugin data");
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const file of ["plugin-runtime.ts", "ensure-deps.ts"]) cpSync(join(REPO, "scripts", file), join(root, "scripts", file));
  writeFileSync(join(root, "package.json"), '{"name":"test","version":"1.0.0"}');
  writeFileSync(join(root, "bun.lock"), "test-lock");
  const env = { ...process.env, PLUGIN_DATA: data, CLAUDE_PLUGIN_DATA: data, LTM_CODEX_RUNTIME: "" };
  const runtime = pluginRuntimeRoot(root, env);
  return { dir, root, data, env, runtime };
}

function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).sort();
}

describe("Codex plugin runtime", () => {
  it("installs once outside the cache, keeping symlinks and lifecycle side effects out of the source", () => {
    const f = fixture();
    const before = snapshot(f.root);
    const bun = join(f.dir, "fake-bun");
    writeFileSync(bun, `#!/bin/sh
echo run >> installs.count
sleep 0.2
test "$LTM_CODEX_RUNTIME" = "$PWD" || exit 1
mkdir -p node_modules/@rohirik/openltm-core node_modules/@modelcontextprotocol/sdk node_modules/zod node_modules/.bin
for p in @rohirik/openltm-core @modelcontextprotocol/sdk zod; do echo '{}' > "node_modules/$p/package.json"; done
echo 'export const value = 42;' > node_modules/zod/index.js
ln -s ../zod/index.js node_modules/.bin/probe
`);
    chmodSync(bun, 0o755);
    const run = join(f.dir, "prepare.ts");
    writeFileSync(run, `import { preparePluginRuntime } from ${JSON.stringify(join(f.root, "scripts", "plugin-runtime.ts"))};
const opts = {bun:${JSON.stringify(bun)}, logPath:${JSON.stringify(join(f.data, "install.log"))}};
preparePluginRuntime(${JSON.stringify(f.root)}, opts);
const runtime = preparePluginRuntime(${JSON.stringify(f.root)}, {...opts,waitMs:10000});
if (!runtime) process.exit(1);
console.log(runtime);
`);
    const r = Bun.spawnSync([process.execPath, run], { env: f.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim()).toBe(f.runtime);
    expect(readFileSync(join(f.runtime, "installs.count"), "utf8").trim()).toBe("run");
    expect(lstatSync(join(f.runtime, "node_modules", ".bin", "probe")).isSymbolicLink()).toBe(true);
    expect(snapshot(f.root)).toEqual(before);
    expect(existsSync(join(f.root, "node_modules"))).toBe(false);
  });

  it("relocates a hook and resolves its imports from the runtime, preserving cwd and arguments", () => {
    const f = fixture();
    mkdirSync(join(f.root, "hooks", "bin"), { recursive: true });
    cpSync(join(REPO, "hooks", "bin", "run-hook.sh"), join(f.root, "hooks", "bin", "run-hook.sh"));
    const hook = join(f.root, "hooks", "Probe.ts");
    writeFileSync(hook, "import {value} from 'zod'; console.log(JSON.stringify({value,cwd:process.cwd(),arg:process.argv[2],data:process.env.CLAUDE_PLUGIN_DATA}));");
    // Seed an already installed external runtime; the launcher must use it,
    // even when the cache has no node_modules and the project's config is hostile.
    cpSync(f.root, f.runtime, { recursive: true });
    for (const p of ["@rohirik/openltm-core", "@modelcontextprotocol/sdk", "zod"]) {
      mkdirSync(join(f.runtime, "node_modules", p), { recursive: true });
      writeFileSync(join(f.runtime, "node_modules", p, "package.json"), '{"main":"index.js"}');
    }
    writeFileSync(join(f.runtime, "node_modules", "zod", "index.js"), "export const value=42;");
    writeFileSync(join(f.dir, ".env"), "RUNTIME_TEST_SECRET=planted");
    writeFileSync(join(f.dir, "evil.js"), "throw new Error('project preload ran');");
    writeFileSync(join(f.dir, "bunfig.toml"), 'preload=["./evil.js"]');
    const before = snapshot(f.root);
    const r = Bun.spawnSync(["sh", join(f.root, "hooks", "bin", "run-hook.sh"), hook, "arg with spaces"], { cwd: f.dir, env: f.env });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual({ value: 42, cwd: f.dir, arg: "arg with spaces", data: f.data });
    expect(snapshot(f.root)).toEqual(before);
    const alias = join(f.dir, "plugin-alias");
    symlinkSync(f.root, alias);
    const aliased = Bun.spawnSync(["sh", join(alias, "hooks", "bin", "run-hook.sh"), join(alias, "hooks", "Probe.ts"), "aliased"], { cwd: f.dir, env: f.env });
    expect(aliased.exitCode).toBe(0);
    expect(JSON.parse(aliased.stdout.toString()).value).toBe(42);
  });

  it("keys runtime by plugin source, package and lockfile, and refuses data inside the cache", () => {
    const f = fixture();
    writeFileSync(join(f.root, "bun.lock"), "changed-lock");
    expect(pluginRuntimeRoot(f.root, f.env)).not.toBe(f.runtime);
    expect(() => pluginRuntimeRoot(f.root, { ...f.env, PLUGIN_DATA: join(f.root, "data") })).toThrow("outside the plugin cache");
    expect(pluginRuntimeRoot(f.root, { PLUGIN_DATA: f.data, LTM_CODEX_RUNTIME: f.root })).toBe(f.root);
  });

  it("does not wire Claude configuration from a Codex dependency install", () => {
    const f = fixture();
    const r = Bun.spawnSync([process.execPath, join(REPO, "scripts", "update-wiring.ts")], {
      env: { ...f.env, HOME: f.dir, LTM_CODEX_RUNTIME: f.runtime },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("Claude hook wiring skipped");
    expect(existsSync(join(f.dir, ".claude"))).toBe(false);
  });
});
