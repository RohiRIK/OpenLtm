#!/usr/bin/env bun
/**
 * bump-version.ts — rewrite the version in every canonical location.
 *
 * Source of truth: package.json (written first; everything else derives from it).
 *
 * The file list lives in `scripts/version-targets.ts`, shared with
 * `verify-version-sync.ts`, so bumping and verifying can never cover different
 * sets of files. Running `bun run verify-version` after a bump is the gate.
 *
 * Usage:
 *   bun run scripts/bump-version.ts <new-version>
 *   bun run bump 2.13.0
 *   bun run bump patch        # bumps the patch component of the current version
 *   bun run bump minor        # bumps the minor component
 *   bun run bump major        # bumps the major component
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { VERSION_TARGETS, VERSION_OCCURRENCE_COUNT } from "./version-targets.js";

const root = join(import.meta.dir, "..");

function usage(): never {
  console.error("Usage: bun run bump <version|patch|minor|major>");
  console.error("Example: bun run bump 2.13.0   |   bun run bump patch");
  process.exit(1);
}

function currentVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  return pkg.version;
}

function resolveVersion(arg: string): string {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;

  const current = currentVersion();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    console.error(`Cannot parse current version "${current}"`);
    process.exit(1);
  }
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];

  switch (arg) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      console.error(`Invalid version: "${arg}" — expected X.Y.Z, patch, minor, or major`);
      process.exit(1);
  }
}

const newVersion = resolveVersion(process.argv[2] ?? usage());

if (newVersion === currentVersion()) {
  console.error(`Already at ${newVersion} — nothing to do.`);
  process.exit(1);
}

let updatedOccurrences = 0;
let missingFiles = 0;

for (const target of VERSION_TARGETS) {
  const filePath = join(root, target.file);

  if (!existsSync(filePath)) {
    if (target.required) {
      console.error(`FAIL  ${target.label} — file not found (required)`);
      missingFiles++;
    } else {
      console.log(`SKIP  ${target.label} — file not found`);
    }
    continue;
  }

  const before = readFileSync(filePath, "utf-8");
  let after = before;
  let fileFailures = 0;

  for (const patch of target.patches) {
    const expectedCount = patch.expectedCount ?? 1;

    // Fresh lastIndex per patch so repeated /g patterns are safe.
    patch.pattern.lastIndex = 0;
    const found = before.match(new RegExp(patch.pattern.source, patch.pattern.flags));
    if (!found || found.length !== expectedCount) {
      console.error(
        `FAIL  ${target.label} — expected ${expectedCount} occurrence(s) of ${patch.describe}, found ${found?.length ?? 0}`,
      );
      missingFiles++;
      fileFailures++;
      continue;
    }

    patch.pattern.lastIndex = 0;
    after = after.replace(patch.pattern, (match) => patch.replace(match, newVersion));
  }

  if (fileFailures > 0) continue;

  if (before === after) {
    console.log(`SKIP  ${target.label} — already at ${newVersion}`);
    continue;
  }

  writeFileSync(filePath, after, "utf-8");
  updatedOccurrences += target.patches.reduce((n, patch) => n + (patch.expectedCount ?? 1), 0);
  console.log(`  OK  ${target.label} → ${newVersion}`);
}

console.log(
  `\n${currentVersion()} → ${newVersion}: updated ${updatedOccurrences}/${VERSION_OCCURRENCE_COUNT} version reference(s).`,
);

if (updatedOccurrences === 0) {
  console.error("Nothing was updated.");
  process.exit(1);
}

if (missingFiles > 0) {
  console.error(`\n${missingFiles} target(s) could not be patched — fix before releasing.`);
  process.exit(1);
}
