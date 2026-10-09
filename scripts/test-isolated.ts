#!/usr/bin/env bun
/**
 * test-isolated.ts — run `bun test` with HOME and CLAUDE_CONFIG_DIR pointed at a
 * fresh mkdtemp dir, then assert the real ~/.claude was not written.
 *
 * Usage (via package.json): bun run test [-- <extra bun test args/paths>]
 * All args are forwarded to `bun test`.
 *
 * Bun caches os.homedir() at process start, so isolation must happen here,
 * before the test process starts (see src/__tests__/setup/isolate-home.ts).
 *
 * Real-home drift check covers the paths OpenLTM code writes. Set
 * LTM_TEST_ALLOW_HOME_DRIFT=1 to downgrade a detected drift to a warning (e.g.
 * when a live Claude Code session is writing ~/.claude concurrently).
 */
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

const realHome = homedir();
const realClaude = join(realHome, ".claude");

// Paths under ~/.claude that OpenLTM code (hooks, onboard, wiring, logger) writes.
const WATCHED = [
  "settings.json",
  "config.json",
  "projects",
  "logs",
  "tmp",
  "memory",
  "hooks",
  join("plugins", "data"),
  join("plugins", "known_marketplaces.json"),
];

type Snapshot = Map<string, string>;

const SESSION_DIR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function walk(path: string, out: Snapshot): void {
  let st;
  try { st = statSync(path); } catch { return; }
  if (st.isDirectory()) {
    out.set(path, "dir");
    let entries: string[] = [];
    try { entries = readdirSync(path); } catch { return; }
    for (const name of entries) {
      // Claude Code session transcripts live in projects/<slug>/*.jsonl — written by
      // live sessions, never by OpenLTM tests. Skip to avoid false drift.
      if (name.endsWith(".jsonl")) continue;
      // …and per-session state dirs projects/<slug>/<session-uuid>/ (e.g. ccr-tip.json).
      if (SESSION_DIR_RE.test(name)) continue;
      walk(join(path, name), out);
    }
  } else {
    out.set(path, `${st.size}:${st.mtimeMs}`);
  }
}

function snapshot(): Snapshot {
  const snap: Snapshot = new Map();
  for (const rel of WATCHED) walk(join(realClaude, rel), snap);
  return snap;
}

function diff(before: Snapshot, after: Snapshot): string[] {
  const changes: string[] = [];
  for (const [p, v] of after) {
    if (!before.has(p)) changes.push(`+ ${p}`);
    else if (before.get(p) !== v) changes.push(`~ ${p}`);
  }
  for (const p of before.keys()) if (!after.has(p)) changes.push(`- ${p}`);
  return changes;
}

const testRoot = mkdtempSync(join(tmpdir(), "openltm-test-home-"));
const fakeHome = join(testRoot, "home");
mkdirSync(fakeHome, { recursive: true });

const before = snapshot();

const proc = Bun.spawnSync([process.execPath, "test", ...process.argv.slice(2)], {
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CLAUDE_CONFIG_DIR: join(fakeHome, ".claude"),
    LTM_TEST_ISOLATED_HOME: fakeHome,
    LTM_TEST_REAL_HOME: realHome,
  },
});

const changes = diff(before, snapshot());
try { rmSync(testRoot, { recursive: true, force: true }); } catch {}

let exitCode = proc.exitCode ?? 1;
if (changes.length > 0) {
  const msg = `[openltm tests] real ${realClaude} changed during the test run:\n  ${changes.join("\n  ")}`;
  if (process.env.LTM_TEST_ALLOW_HOME_DRIFT === "1") {
    console.warn(`${msg}\n(LTM_TEST_ALLOW_HOME_DRIFT=1 — not failing)`);
  } else {
    console.error(`${msg}\nTests must not write the real ~/.claude. (Set LTM_TEST_ALLOW_HOME_DRIFT=1 if a live session caused this.)`);
    if (exitCode === 0) exitCode = 1;
  }
} else if (existsSync(realClaude)) {
  console.log(`[openltm tests] real ${realClaude} untouched (HOME isolated to a temp dir).`);
}

process.exit(exitCode);
