/**
 * find-core.ts — locate the `@rohirik/openltm-core` CLI entry that runs `mcp-serve`.
 *
 * Kept dependency-free so a test can run it under Node: the host runs on Node,
 * which enforces core's `exports` map and refuses unlisted subpaths such as
 * `@rohirik/openltm-core/package.json` (ERR_PACKAGE_PATH_NOT_EXPORTED). Bun,
 * which runs the rest of the tests, does not — that gap shipped a plugin whose
 * every tool failed. So resolve core's main entry and walk up to its root.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export function findCoreCli(fromUrl: string): { script: string; args: string[] } | null {
  let entry: string;
  try {
    entry = createRequire(fromUrl).resolve("@rohirik/openltm-core");
  } catch {
    return null;
  }
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    const script = resolve(dir, "src", "cli", "bin.ts");
    if (existsSync(script)) return { script, args: ["mcp-serve"] };
  }
  return null;
}
