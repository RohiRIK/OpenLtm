/**
 * Test preload (bunfig.toml [test].preload) — fail closed unless HOME is isolated.
 *
 * Bun caches os.homedir() at process start, so HOME cannot be redirected from
 * inside the test process: modules that compute `join(homedir(), ".claude")` at
 * load time would still hit the real ~/.claude. HOME must be set *before*
 * `bun test` starts — `bun run test` does that via scripts/test-isolated.ts.
 *
 * Accepted:
 *   bun run test                                  (full suite; wrapper sets LTM_TEST_ISOLATED_HOME)
 *   bun run test:isolated <paths>                 (same wrapper, chosen files)
 *   HOME=$(mktemp -d) bun test <paths>            (HOME under the OS temp dir)
 * CLAUDE_CONFIG_DIR and the XDG base dirs are forced inside that HOME.
 */
import { homedir, tmpdir } from "os";
import { join, resolve, sep } from "path";
import { realpathSync } from "fs";

function real(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function isUnder(child: string, parent: string): boolean {
  const c = real(child);
  const p = real(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

const home = process.env.HOME ?? "";
const cachedHome = homedir();
const wrapperHome = process.env.LTM_TEST_ISOLATED_HOME;

const isolated =
  home !== "" &&
  real(cachedHome) === real(home) &&
  (wrapperHome ? real(wrapperHome) === real(home) : isUnder(home, tmpdir()));

if (!isolated) {
  throw new Error(
    `[openltm tests] Refusing to run with a non-isolated HOME (${cachedHome}). ` +
      "Tests write ~/.claude/{projects,logs,tmp,...}. Use `bun run test` " +
      "(or `bun run test:isolated <paths>`), or `HOME=$(mktemp -d) bun test <paths>`.",
  );
}

// Spawned hooks/CLIs inherit process.env — keep Claude's config dir inside the temp HOME too.
if (!process.env.CLAUDE_CONFIG_DIR || !isUnder(process.env.CLAUDE_CONFIG_DIR, home)) {
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
}

// …and the XDG base dirs: an inherited XDG_CONFIG_HOME is the real user's config
// (OpenCode's installer honours it), so it would escape the temp HOME.
const XDG_DEFAULTS: Record<string, string> = {
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_CACHE_HOME: join(home, ".cache"),
};
for (const [key, fallback] of Object.entries(XDG_DEFAULTS)) {
  const value = process.env[key];
  if (!value || !isUnder(value, home)) process.env[key] = fallback;
}
