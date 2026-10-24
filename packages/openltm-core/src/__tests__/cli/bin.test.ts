/**
 * bin.test.ts — top-level `ltm` argv handling (subprocess).
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("ltm bin (subprocess)", () => {
  let bin: string;

  function ltm(args: string[]): { code: number; stdout: string; stderr: string } {
    const r = Bun.spawnSync([process.execPath, bin, ...args], { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  }

  beforeAll(async () => {
    bin = (await import("../../cli/janitor.js")).LTM_BIN_PATH;
  });

  it("--version and -v print the package version", () => {
    const { version } = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "package.json"), "utf8")) as { version: string };
    for (const flag of ["--version", "-v"]) {
      const r = ltm([flag]);
      expect(r.code).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    }
  });

  it("`help` prints help", () => {
    const r = ltm(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Sub-commands:");
    expect(r.stdout).toContain("conflict");
  });

  it("an unknown option is a usage error, never an auto-detect install", () => {
    const r = ltm(["--claud"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option '--claud'");
    expect(r.stdout).not.toContain("LTM Installer");
  });
});
