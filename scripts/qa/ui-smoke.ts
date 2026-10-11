#!/usr/bin/env bun
/**
 * qa/ui-smoke.ts — the graph UI in a real Chromium: starts the API server
 * (:7331) on a seeded sandbox DB, lets Playwright start the Next UI (:7332),
 * and runs the existing e2e suite plus the 2.17 security spec. Never touches
 * the real ~/.claude. Needs `bun install` in graph-app/ first; ports 7331/7332 free.
 *
 * Usage (repo root): bun run scripts/qa/ui-smoke.ts [playwright args, e.g. a spec filter]
 * Uses PLAYWRIGHT_CHROMIUM (default /opt/pw-browsers/chromium if present).
 */
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const T = mkdtempSync(join(tmpdir(), "ltm-ui-smoke-"));
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  HOME: T, CLAUDE_CONFIG_DIR: join(T, ".claude"), LTM_DB_PATH: join(T, "openltm.db"),
  CLAUDE_PLUGIN_DATA: T, LTM_EMBED_PROVIDER: "disabled",
};
const chromium = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "");

// Seed a few memories so the UI has something to render.
const seed = Bun.spawnSync([process.execPath, "-e", `
  const c = await import("@rohirik/openltm-core"); await c.waitForInit();
  for (const [content, category, project] of [
    ["UI smoke: graph renders memories as nodes", "pattern", "ui-smoke"],
    ["UI smoke: settings never show raw API keys", "constraint", "ui-smoke"],
    ["UI smoke: prefer bun over npm", "preference", null],
  ]) c.learn({ content, category, importance: 4, project_scope: project ?? undefined, skipExport: true });`], { env, cwd: ROOT });
if (seed.exitCode !== 0) { console.log("FAIL  seeding the sandbox DB\n" + seed.stderr.toString()); process.exit(1); }

const api = Bun.spawn([process.execPath, "run", join(ROOT, "src", "graph-server.ts")], { env, cwd: ROOT, stdout: "ignore", stderr: "ignore" });
let code = 1;
try {
  for (let i = 0; i < 40; i++) {
    if (await fetch("http://127.0.0.1:7331/api/stats").then((r) => r.ok, () => false)) break;
    await Bun.sleep(250);
  }
  const pw = Bun.spawn([join(ROOT, "graph-app", "node_modules", ".bin", "playwright"), "test", "--reporter=line", "--retries=0", ...process.argv.slice(2)], {
    cwd: join(ROOT, "graph-app"),
    env: { ...env, ...(chromium ? { PLAYWRIGHT_CHROMIUM: chromium } : {}) },
    stdout: "inherit", stderr: "inherit",
  });
  code = await pw.exited;
} finally {
  api.kill("SIGTERM");
  await api.exited;
  rmSync(T, { recursive: true, force: true });
}
console.log(code === 0 ? "\nAll UI smoke checks passed." : `\nUI smoke failed (playwright exit ${code}).`);
process.exit(code);
