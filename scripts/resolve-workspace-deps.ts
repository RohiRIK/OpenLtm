#!/usr/bin/env bun
/**
 * resolve-workspace-deps.ts — make a workspace package publishable as a tarball.
 *
 * Bun workspaces use `workspace:*`, which npm cannot resolve when the package
 * is installed from a registry or an archive. The release workflow rewrote these
 * in place with `sed`, which only covered CI — `npm pack` anywhere else produced
 * a broken tarball that fails at install time with EUNSUPPORTEDPROTOCOL.
 *
 * This script is wired into each adapter's `prepack`/`postpack` lifecycle pair,
 * so a tarball is always correct and the working tree is left clean.
 *
 *   resolve-workspace-deps.ts rewrite <package.json...>   # back up + rewrite
 *   resolve-workspace-deps.ts restore <package.json...>   # restore backups
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { basename, dirname, join } from "path";
import { repoVersion } from "./repo-version.js";

const mode = process.argv[2];
const files = process.argv.slice(3).filter((a) => !a.startsWith("--"));

if ((mode !== "rewrite" && mode !== "restore") || files.length === 0) {
  console.error("Usage: resolve-workspace-deps.ts <rewrite|restore> <package.json...>");
  process.exit(1);
}

function backupPath(file: string): string {
  return join(dirname(file), `.${basename(file)}.workspace-backup`);
}

if (mode === "rewrite") {
  const version = repoVersion();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const before = readFileSync(file, "utf-8");
    if (!before.includes("workspace:")) continue;

    // Back up once, so nested invocations cannot clobber the original.
    const backup = backupPath(file);
    if (!existsSync(backup)) writeFileSync(backup, before, "utf-8");

    const after = before.replace(/"workspace:[^"]*"/g, `"^${version}"`);
    if (after !== before) {
      writeFileSync(file, after, "utf-8");
      console.log(`  resolved workspace deps in ${file} → ^${version}`);
    }
  }
} else {
  for (const file of files) {
    const backup = backupPath(file);
    if (!existsSync(backup)) continue;
    writeFileSync(file, readFileSync(backup, "utf-8"), "utf-8");
    unlinkSync(backup);
    console.log(`  restored ${file}`);
  }
}
