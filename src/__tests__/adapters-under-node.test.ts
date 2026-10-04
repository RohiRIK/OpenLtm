/**
 * The OpenClaw and Pi hosts run adapters under Node, but every other test runs
 * under Bun — and Bun ignores `exports` restrictions that Node enforces. That gap
 * shipped 2.15.1 with an OpenClaw (and Pi) plugin that could not find its own
 * memory engine. These tests run each adapter's core lookup under real Node.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dir, "..", "..");
const ADAPTERS = ["adapter-openclaw", "adapter-pi"] as const;

const hasNode = spawnSync("node", ["--version"]).status === 0;
// CI must exercise this; a Bun-only dev machine may skip it.
const describeNode = hasNode || process.env["CI"] ? describe : describe.skip;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Bundle the adapter's find-core.ts to plain ESM inside `dir`, so Node resolves
 * from there. Built in a child `bun build`: an in-process Bun.build disturbs
 * module resolution for the other test files in the same run.
 */
function buildFindCore(adapter: string, dir: string): string {
  const outfile = join(dir, "find-core.mjs");
  const out = spawnSync(
    process.execPath,
    ["build", join(ROOT, "packages", adapter, "src", "find-core.ts"), "--target=node", "--format=esm", "--outfile", outfile],
    { encoding: "utf-8" },
  );
  if (out.status !== 0) throw new Error(out.stderr);
  return outfile;
}

function runUnderNode(modulePath: string): { script: string } | null {
  const url = pathToFileURL(modulePath).href;
  const out = spawnSync(
    "node",
    ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(m.findCoreCli(${JSON.stringify(url)})));`],
    { encoding: "utf-8" },
  );
  if (out.status !== 0) throw new Error(out.stderr);
  return JSON.parse(out.stdout.trim());
}

describeNode("adapter core lookup under Node", () => {
  for (const adapter of ADAPTERS) {
    it(`${adapter} finds core even when core's exports map hides package.json`, () => {
      // Stand-in for core 2.15.1: `exports` lists only ".", like the published package.
      const dir = mkdtempSync(join(tmpdir(), `openltm-node-${adapter}-`));
      tempDirs.push(dir);
      const core = join(dir, "node_modules", "@rohirik", "openltm-core");
      mkdirSync(join(core, "src", "cli"), { recursive: true });
      writeFileSync(
        join(core, "package.json"),
        JSON.stringify({ name: "@rohirik/openltm-core", type: "module", exports: { ".": "./src/index.ts" } }),
      );
      writeFileSync(join(core, "src", "index.ts"), "export {};\n");
      writeFileSync(join(core, "src", "cli", "bin.ts"), "export {};\n");

      const found = runUnderNode(buildFindCore(adapter, dir));
      expect(found?.script).toBe(join(core, "src", "cli", "bin.ts"));
    });

    it(`${adapter} finds the real workspace core`, () => {
      const dir = join(ROOT, "packages", adapter, ".node-test");
      tempDirs.push(dir);
      const found = runUnderNode(buildFindCore(adapter, dir));
      expect(found?.script).toBe(join(ROOT, "packages", "openltm-core", "src", "cli", "bin.ts"));
    });
  }
});
