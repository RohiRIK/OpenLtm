/**
 * Packaging tests.
 *
 * The published npm tarball is the install path the README advertises, so a
 * missing runtime file is a shipping bug — not a cosmetic one. These tests
 * guard the files that must be inside the tarball and keep the duplicated
 * migration copies from drifting.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CORE_ROOT = join(REPO_ROOT, "packages", "openltm-core");

describe("migration files are shipped with the package", () => {
  it("keeps a package-local copy of every root migration", () => {
    const rootDir = join(REPO_ROOT, "migrations");
    const pkgDir = join(CORE_ROOT, "migrations");

    const rootFiles = readdirSync(rootDir).filter((f) => f.endsWith(".sql")).sort();
    const pkgFiles = readdirSync(pkgDir).filter((f) => f.endsWith(".sql")).sort();

    expect(pkgFiles).toEqual(rootFiles);
  });

  it("keeps the two migration copies byte-identical", () => {
    for (const file of readdirSync(join(REPO_ROOT, "migrations")).filter((f) => f.endsWith(".sql"))) {
      const root = readFileSync(join(REPO_ROOT, "migrations", file), "utf-8");
      const packaged = readFileSync(join(CORE_ROOT, "migrations", file), "utf-8");
      expect(`${file}:${packaged === root}`).toBe(`${file}:true`);
    }
  });

  it("resolves the packaged copy first, not the monorepo root", async () => {
    const { getMigrationsDir } = await import("../paths.js");
    const resolved = getMigrationsDir();
    expect(existsSync(resolved)).toBe(true);
    expect(resolved).toBe(join(CORE_ROOT, "migrations"));
  });
});

describe("package manifest includes runtime files", () => {
  it("does not exclude migrations from the published tarball", async () => {
    const pkg = JSON.parse(readFileSync(join(CORE_ROOT, "package.json"), "utf-8"));
    const files = pkg.files as string[] | undefined;
    // An explicit `files` allowlist that omits migrations/ would reintroduce the
    // bug this suite exists to prevent.
    if (files) {
      expect(files.some((entry) => entry.includes("migrations"))).toBe(true);
    }
  });

  it("exposes the same runtime entrypoints npm consumers need", () => {
    const pkg = JSON.parse(readFileSync(join(CORE_ROOT, "package.json"), "utf-8"));
    for (const entry of [".", "./cli", "./mcp"]) {
      expect(Object.keys(pkg.exports)).toContain(entry);
    }
    for (const bin of ["ltm", "openltm", "openltm-core"]) {
      expect(Object.keys(pkg.bin)).toContain(bin);
    }
  });
});
