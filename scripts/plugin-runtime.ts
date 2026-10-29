/**
 * Codex fingerprints every entry in a plugin before running its hooks and
 * rejects symlinks. Bun's bin/workspace links therefore belong in PLUGIN_DATA,
 * never in the immutable plugin cache. Execute a versioned source copy there
 * so normal module resolution still works (NODE_PATH cannot resolve workspaces).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import { join, relative, resolve, sep } from "path";
import { ensurePluginDeps, type EnsureDepsOptions } from "./ensure-deps.js";

export function isCodexPlugin(root: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const cache = join(resolve(env.CODEX_HOME || join(homedir(), ".codex")), "plugins", "cache");
  return resolve(root).startsWith(cache + sep) || !!env.PLUGIN_DATA;
}

export function pluginRuntimeRoot(root: string, env: NodeJS.ProcessEnv = process.env): string {
  if ((env.LTM_CODEX_RUNTIME && existsSync(env.LTM_CODEX_RUNTIME) && realpathSync(env.LTM_CODEX_RUNTIME) === realpathSync(root)) || !isCodexPlugin(root, env)) return root;
  const data = [env.PLUGIN_DATA, env.CLAUDE_PLUGIN_DATA, env.LTM_PLUGIN_DATA]
    .find((p) => p && !p.includes("${"));
  if (!data) throw new Error("Codex plugin data directory is missing; refusing to install into the plugin cache");
  if (resolve(data).startsWith(resolve(root) + sep) || resolve(data) === resolve(root)) {
    throw new Error("Codex plugin data directory must be outside the plugin cache");
  }
  const hash = createHash("sha256");
  hash.update(realpathSync(root));
  for (const file of ["package.json", "bun.lock"]) hash.update(readFileSync(join(root, file)));
  return join(resolve(data), "runtime", hash.digest("hex").slice(0, 20));
}

export function preparePluginRuntime(root: string, opts: EnsureDepsOptions = {}): string | undefined {
  const runtime = pluginRuntimeRoot(root);
  if (runtime !== root) {
    if (!existsSync(runtime)) {
      mkdirSync(join(runtime, ".."), { recursive: true });
      const staging = mkdtempSync(runtime + ".copy-");
      try {
        cpSync(root, staging, {
          recursive: true,
          filter: (path) => {
            const parts = relative(root, path).split(sep);
            return !parts.includes("node_modules") && ![".git", "data", ".deps-install.lock"].includes(parts[0]);
          },
        });
        try { renameSync(staging, runtime); }
        catch (err) { if (!existsSync(runtime)) throw err; }
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    }
  }
  // The detached install's postinstall must skip Claude's global hook wiring.
  return ensurePluginDeps(runtime, {
    ...opts,
    env: runtime !== root ? { ...process.env, ...opts.env, LTM_CODEX_RUNTIME: runtime } : opts.env,
  }) ? runtime : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--wait-ms");
  try {
    const runtime = preparePluginRuntime(resolve(args[0] ?? join(import.meta.dir, "..")), {
      waitMs: i >= 0 ? Number(args[i + 1]) || 0 : 0,
    });
    if (!runtime) process.exit(1);
    process.stdout.write(runtime + "\n");
  } catch (err) {
    process.stderr.write(`openltm: runtime preparation failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
