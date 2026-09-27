/**
 * repo-version.ts — the single source of truth for the repo version.
 *
 * Kept separate so tooling (release scripts, packaging) can read the version
 * without duplicating the file lookup or shelling out to git.
 */
import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

export function repoVersion(): string {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
    version?: string;
  };
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`package.json has no valid semver version (got ${JSON.stringify(pkg.version)})`);
  }
  return pkg.version;
}
