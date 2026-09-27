#!/usr/bin/env bun
/**
 * catalog-sync.ts — repoint the Hermes catalog entry at the current commit.
 *
 * The catalog pins an exact reviewed commit, so the entry must be re-pinned
 * whenever the plugin changes, and each re-pin is a separate reviewed PR. This
 * script makes that a one-liner and refuses to guess: it resolves the target
 * from the git tag when HEAD is tagged, and otherwise from HEAD.
 *
 * Usage:
 *   bun run catalog:sync           # pin to HEAD (or its tag)
 *   bun run catalog:sync v2.15.0   # pin to a specific tag
 *   bun run catalog:sync --check   # report drift without writing
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const root = join(import.meta.dir, "..");
const entryPath = join(root, "hermes", "plugin-catalog", "openltm.yaml");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const target = args.find((a) => !a.startsWith("--"));

function git(...cmd: string[]): string {
  // Bun's execSync takes a single command string (unlike spawnSync), so args are
  // joined here. Every caller passes literals except the validated ref below.
  return execSync(["git", ...cmd].join(" "), {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString().trim();
}

let sha: string;
if (target) {
  // Reject anything that is not a plain ref name — this is interpolated into a
  // shell command, so it must not be able to smuggle in a second command.
  if (!/^[A-Za-z0-9._/-]+$/.test(target)) {
    console.error(`Refusing to use "${target}" as a git ref — unexpected characters.`);
    process.exit(1);
  }
  sha = git("rev-list", "-n", "1", target);
  console.log(`resolved ${target} → ${sha.slice(0, 7)}`);
} else {
  sha = git("rev-parse", "HEAD");
  const describe = git("describe", "--tags", "--exact-match", "HEAD");
  console.log(`resolved HEAD${describe ? ` (${describe})` : " (untagged)"} → ${sha.slice(0, 7)}`);
}

if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`Refusing to write: "${sha}" is not a 40-hex commit.`);
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version as string;
const before = readFileSync(entryPath, "utf-8");

const after = before
  .replace(/^sha:\s*[0-9a-f]{40}$/m, `sha: ${sha}`)
  .replace(/^version:\s*".*"$/m, `version: "${version}"`);

if (before === after) {
  console.log(`Entry already pinned to ${sha.slice(0, 7)} (v${version}) — no change.`);
  process.exit(0);
}

if (checkOnly) {
  console.log(`Entry is stale: expected sha ${sha.slice(0, 7)} / version ${version}.`);
  console.log("Run `bun run catalog:sync` to repoint it.");
  process.exit(1);
}

writeFileSync(entryPath, after, "utf-8");
console.log(`Updated entry → sha ${sha.slice(0, 7)}, version ${version}`);
console.log("\nNow run `bun run catalog:check`, commit, and open a pin-update PR against");
console.log("NousResearch/hermes-agent.");
