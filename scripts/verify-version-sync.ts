#!/usr/bin/env bun
/**
 * Verifies that all version references across the repo match package.json.
 *
 * Source of truth: package.json → version
 *
 * Checked files:
 *   - .claude-plugin/plugin.json     →  "version": "X.Y.Z"
 *   - README.md                      →  badge version-X.Y.Z-blue
 *   - docs/ARCHITECTURE.md           →  "against plugin vX.Y.Z"
 *   - packages/ltm-core/package.json      →  "version": "X.Y.Z"
 *   - packages/adapter-pi/package.json    →  "version": "X.Y.Z"
 *   - packages/adapter-opencode/package.json →  "version": "X.Y.Z"
 *
 * Usage: bun run scripts/verify-version-sync.ts
 * Exit code: 0 if all match, 1 if any mismatch.
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

interface Check {
  file: string;
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => string;
  label: string;
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const expected: string = pkg.version;

const checks: Check[] = [
  {
    file: ".claude-plugin/plugin.json",
    pattern: /"version"\s*:\s*"([^"]+)"/,
    extract: (m) => m[1],
    label: ".claude-plugin/plugin.json",
  },
  {
    file: "README.md",
    pattern: /version-([0-9]+\.[0-9]+\.[0-9]+)-blue/,
    extract: (m) => m[1],
    label: "README.md badge",
  },
  {
    file: "docs/ARCHITECTURE.md",
    pattern: /against plugin v([0-9]+\.[0-9]+\.[0-9]+)/,
    extract: (m) => m[1],
    label: "docs/ARCHITECTURE.md",
  },
  {
    file: "packages/ltm-core/package.json",
    pattern: /"version"\s*:\s*"([^"]+)"/,
    extract: (m) => m[1],
    label: "packages/ltm-core",
  },
  {
    file: "packages/adapter-pi/package.json",
    pattern: /"version"\s*:\s*"([^"]+)"/,
    extract: (m) => m[1],
    label: "packages/adapter-pi",
  },
  {
    file: "packages/adapter-opencode/package.json",
    pattern: /"version"\s*:\s*"([^"]+)"/,
    extract: (m) => m[1],
    label: "packages/adapter-opencode",
  },
];

let failed = 0;

console.log(`Source of truth: package.json → ${expected}\n`);

for (const check of checks) {
  const filePath = join(root, check.file);
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    console.log(`SKIP  ${check.label} → file not found`);
    continue;
  }

  const match = content.match(check.pattern);
  if (!match) {
    console.log(`FAIL  ${check.label} → pattern not found`);
    failed++;
    continue;
  }

  const found = check.extract(match);
  if (found === expected) {
    console.log(`  OK  ${check.label} → ${found}`);
  } else {
    console.log(`FAIL  ${check.label} → ${found} (expected ${expected})`);
    failed++;
  }
}

console.log();
if (failed > 0) {
  console.log(`${failed} check(s) failed. Update stale files to match package.json.`);
  process.exit(1);
} else {
  console.log("All version references in sync.");
  process.exit(0);
}
