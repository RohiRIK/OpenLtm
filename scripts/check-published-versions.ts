#!/usr/bin/env bun
/**
 * check-published-versions.ts — compare npm's published versions to the repo.
 *
 * Motivation: v2.15.0 shipped a package whose `package.json` was missing
 * `publishConfig.access`, which only surfaced when publishing by hand long after
 * the tag. A release gate that compares what is *published* against what is *in
 * the repo* catches that class of drift before it becomes a release problem.
 *
 * The only state treated as a failure is a published version NEWER than the repo
 * version — that means the registry holds code the repo does not, which is an
 * integrity problem. Everything else (published behind the repo, or a brand-new
 * package that has never shipped) is expected between releases and is reported
 * as information.
 *
 * Usage: bun run check:published [--strict]
 *   --strict  also fail when a package is published behind the repo
 */
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { repoVersion } from "./repo-version.js";

const root = join(import.meta.dir, "..");
const strict = process.argv.includes("--strict");

interface PackageEntry {
  dir: string;
  name: string;
  version: string;
}

function readPackages(): PackageEntry[] {
  const out: PackageEntry[] = [];
  for (const dir of ["openltm-core", "adapter-opencode", "adapter-pi", "adapter-openclaw"]) {
    const pkg = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf-8")) as {
      name?: string;
      version?: string;
      private?: boolean;
    };
    if (pkg.private || !pkg.name || !pkg.version) continue;
    out.push({ dir, name: pkg.name, version: pkg.version });
  }
  return out;
}

function published(name: string): string | null {
  // execSync returns null when stdio is ignored, so use a pipe and read stdout.
  const out = execSync(`npm view ${name} version`, {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  return out || null;
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const repo = repoVersion();
const packages = readPackages();

console.log(`Published-version check — repo at ${repo}\n`);
console.log(`  ${"package".padEnd(30)} ${"repo".padEnd(10)} ${"npm".padEnd(10)} state`);
console.log(`  ${"-".repeat(30)} ${"-".repeat(10)} ${"-".repeat(10)} -----`);

let failures = 0;
let drift = 0;

for (const pkg of packages) {
  let live: string | null = null;
  let state: string;
  let bad = false;

  try {
    live = published(pkg.name);
  } catch {
    live = null; // 404 — never published
  }

  if (live === null) {
    state = "never published";
  } else if (pkg.version !== repo) {
    // A package versioned independently of the repo tag; compare like for like.
    state = cmp(live, pkg.version) > 0 ? "AHEAD OF REPO" : "behind";
  } else if (live === repo) {
    state = "in sync";
  } else {
    const order = cmp(live, repo);
    state = order > 0 ? "AHEAD OF REPO" : "behind (tagged release)";
  }

  if (state === "AHEAD OF REPO") {
    failures++;
    bad = true;
  } else if (state.startsWith("behind")) {
    drift++;
  }

  if (state === "in sync") state = "in sync ✓";
  console.log(
    `  ${pkg.name.padEnd(30)} ${pkg.version.padEnd(10)} ${(live ?? "—").padEnd(10)} ${state}`,
  );
  if (bad) {
    console.log(`      ↳ npm has a version this repo does not contain — investigate before releasing`);
  }
}

console.log();

if (failures > 0) {
  console.log(`${failures} package(s) are published ahead of the repo. Not safe to release.`);
  process.exit(1);
}

if (drift > 0 && strict) {
  console.log(`${drift} package(s) are behind the repo and --strict was requested.`);
  process.exit(1);
}

console.log(
  drift > 0
    ? `No integrity problems. ${drift} package(s) trail the repo, which is expected before a release.`
    : "All published packages match the repo version.",
);
