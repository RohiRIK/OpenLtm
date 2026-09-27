#!/usr/bin/env bun
/**
 * verify-version-sync.ts — assert every version reference matches package.json.
 *
 * Checks the same `VERSION_TARGETS` list that `bump-version.ts` writes, and
 * checks *every* occurrence in each file (the marketplace carries two), so a
 * half-bumped file fails instead of passing on its first match.
 *
 * Usage: bun run verify-version
 * Exit code: 0 if all match, 1 if any mismatch.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { VERSION_TARGETS, VERSION_OCCURRENCE_COUNT } from "./version-targets.js";

const root = join(import.meta.dir, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const expected: string = pkg.version;

/** Pull the version-ish value out of one match for comparison. */
function extract(patch: { extract: (match: string) => string }, match: string): string {
  return patch.extract(match);
}

let failed = 0;
let checked = 0;
let skippedFiles = 0;

console.log(`Source of truth: package.json → ${expected}\n`);

for (const target of VERSION_TARGETS) {
  const filePath = join(root, target.file);

  if (!existsSync(filePath)) {
    if (target.required) {
      console.log(`FAIL  ${target.label} → file not found (required)`);
      failed++;
    } else {
      console.log(`SKIP  ${target.label} → file not found`);
      skippedFiles++;
    }
    continue;
  }

  const content = readFileSync(filePath, "utf-8");
  let targetOk = true;

  for (const patch of target.patches) {
    const expectedCount = patch.expectedCount ?? 1;
    const found = content.match(new RegExp(patch.pattern.source, patch.pattern.flags));

    if (!found || found.length === 0) {
      console.log(`FAIL  ${target.label} → no match for ${patch.describe}`);
      failed++;
      targetOk = false;
      continue;
    }

    if (found.length !== expectedCount) {
      console.log(
        `FAIL  ${target.label} → expected ${expectedCount} occurrence(s) of ${patch.describe}, found ${found.length}`,
      );
      failed++;
      targetOk = false;
    }

    for (const match of found) {
      checked++;
      const value = extract(patch, match);
      if (value === expected) {
        console.log(`  OK  ${target.label} → ${value} (${patch.describe})`);
      } else {
        console.log(`FAIL  ${target.label} → ${value} (${patch.describe}, expected ${expected})`);
        failed++;
        targetOk = false;
      }
    }
  }

  if (targetOk) checked++; // count the file itself as covered
}

console.log();
if (checked < VERSION_OCCURRENCE_COUNT) {
  console.log(`Only ${checked}/${VERSION_OCCURRENCE_COUNT} version references were reachable.`);
}

// The Release workflow extracts notes with
//   awk "/^## \[<version>\]/{flag=1; next} /^## \[/{flag=0} flag" CHANGELOG.md
// so a version bump with no matching section silently ships an EMPTY release.
// Checked separately because only the first heading is meaningful.
let changelogVersion: string | null = null;
try {
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
  changelogVersion = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1] ?? null;
} catch {
  changelogVersion = null;
}

if (changelogVersion === null) {
  console.log(`FAIL  CHANGELOG.md → no "## [X.Y.Z]" heading (release notes would be empty)`);
  failed++;
} else if (changelogVersion === expected) {
  console.log(`  OK  CHANGELOG.md → ${changelogVersion} (release notes present)`);
} else {
  console.log(
    `FAIL  CHANGELOG.md → top section is ${changelogVersion}, expected ${expected} — tagging v${expected} would ship empty release notes`,
  );
  failed++;
}

console.log();

if (failed > 0) {
  console.log(`${failed} check(s) failed. Run \`bun run bump <version>\` to realign.`);
  process.exit(1);
}

console.log(
  skippedFiles > 0
    ? `All reachable version references in sync (${skippedFiles} optional file(s) absent).`
    : "All version references in sync.",
);
process.exit(0);
