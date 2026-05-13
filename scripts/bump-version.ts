#!/usr/bin/env bun
/**
 * bump-version.ts — Update version in all canonical locations.
 *
 * Source of truth: package.json (written first; others derived from it).
 *
 * Patched files:
 *   package.json              → "version": "X.Y.Z"
 *   .claude-plugin/plugin.json → "version": "X.Y.Z"
 *   README.md                 → badge  version-X.Y.Z-blue
 *   docs/ARCHITECTURE.md      → "against plugin vX.Y.Z"
 *
 * Usage:
 *   bun run scripts/bump-version.ts <new-version>
 *   bun run scripts/bump-version.ts 1.11.0
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

function usage(): never {
  console.error("Usage: bun run scripts/bump-version.ts <new-version>");
  console.error("Example: bun run scripts/bump-version.ts 1.11.0");
  process.exit(1);
}

const newVersion = process.argv[2];
if (!newVersion) usage();
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Invalid version: "${newVersion}" — must be semver X.Y.Z`);
  process.exit(1);
}

interface Patch {
  file: string;
  pattern: RegExp;
  replace: (match: string) => string;
  label: string;
}

const patches: Patch[] = [
  {
    file: "package.json",
    pattern: /("version"\s*:\s*")[^"]+(")/,
    replace: (_, pre, post) => `${pre}${newVersion}${post}`,
    label: "package.json",
  },
  {
    file: ".claude-plugin/plugin.json",
    pattern: /("version"\s*:\s*")[^"]+(")/,
    replace: (_, pre, post) => `${pre}${newVersion}${post}`,
    label: ".claude-plugin/plugin.json",
  },
  {
    file: "README.md",
    pattern: /(version-)[0-9]+\.[0-9]+\.[0-9]+(-blue)/,
    replace: (_, pre, post) => `${pre}${newVersion}${post}`,
    label: "README.md badge",
  },
  {
    file: "docs/ARCHITECTURE.md",
    pattern: /(against plugin v)[0-9]+\.[0-9]+\.[0-9]+/,
    replace: (_, pre) => `${pre}${newVersion}`,
    label: "docs/ARCHITECTURE.md",
  },
];

let updated = 0;
let skipped = 0;

for (const p of patches) {
  const filePath = join(root, p.file);
  if (!existsSync(filePath)) {
    console.log(`SKIP  ${p.label} — file not found`);
    skipped++;
    continue;
  }

  const before = readFileSync(filePath, "utf-8");
  const after = before.replace(p.pattern, p.replace as Parameters<string["replace"]>[1]);

  if (before === after) {
    console.log(`SKIP  ${p.label} — pattern not found or already at ${newVersion}`);
    skipped++;
    continue;
  }

  writeFileSync(filePath, after, "utf-8");
  console.log(`  OK  ${p.label} → ${newVersion}`);
  updated++;
}

console.log(`\nUpdated ${updated} file(s), skipped ${skipped}.`);
if (updated === 0) process.exit(1);
