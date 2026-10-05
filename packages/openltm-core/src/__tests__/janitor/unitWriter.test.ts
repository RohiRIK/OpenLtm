/**
 * unitWriter.test.ts — `schedule --write` must never clobber user files or
 * write through a symlink (Sam BLOCK on #27).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UNIT_FILE_MODE, preflightUnitFiles, writeUnitFiles } from "../../janitor/unitWriter.js";

describe("writeUnitFiles", () => {
  let dir: string;
  let unitDir: string;
  let service: string;
  let timer: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ltm-unitwriter-"));
    unitDir = join(dir, ".config", "systemd", "user");
    service = join(unitDir, "openltm-janitor.service");
    timer = join(unitDir, "openltm-janitor.timer");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const files = () => [
    { path: service, content: "[Service]\nNEW=1\n" },
    { path: timer, content: "[Timer]\nNEW=1\n" },
  ];

  it("writes new files with mode 0600 and leaves no temp files", () => {
    const r = writeUnitFiles(files());
    expect(r.ok).toBe(true);
    expect(readFileSync(service, "utf-8")).toBe("[Service]\nNEW=1\n");
    expect(statSync(service).mode & 0o777).toBe(UNIT_FILE_MODE);
    expect(statSync(timer).mode & 0o777).toBe(UNIT_FILE_MODE);
    expect(readdirSync(unitDir).sort()).toEqual(["openltm-janitor.service", "openltm-janitor.timer"]);
  });

  it("refuses to overwrite an existing unit without force — custom content survives, nothing written", () => {
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(service, "# my custom unit\n");
    const r = writeUnitFiles(files());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toEqual([{ path: service, reason: "exists" }]);
    expect(readFileSync(service, "utf-8")).toBe("# my custom unit\n");
    expect(existsSync(timer)).toBe(false); // all-or-nothing
    expect(existsSync(`${service}.bak`)).toBe(false);
  });

  it("with force: .bak holds the custom unit and the new unit is written", () => {
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(service, "# my custom unit\n");
    const r = writeUnitFiles(files(), { force: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backups).toEqual([{ path: service, backup: `${service}.bak` }]);
    expect(readFileSync(`${service}.bak`, "utf-8")).toBe("# my custom unit\n");
    expect(readFileSync(service, "utf-8")).toBe("[Service]\nNEW=1\n");
    expect(statSync(service).mode & 0o777).toBe(UNIT_FILE_MODE);
  });

  it("with force: never overwrites an existing .bak (uses a timestamped backup)", () => {
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(service, "# second custom\n");
    writeFileSync(`${service}.bak`, "# first backup\n");
    const r = writeUnitFiles(files(), { force: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readFileSync(`${service}.bak`, "utf-8")).toBe("# first backup\n");
    expect(r.backups[0]!.backup.startsWith(`${service}.bak-`)).toBe(true);
    expect(readFileSync(r.backups[0]!.backup, "utf-8")).toBe("# second custom\n");
  });

  for (const force of [false, true]) {
    it(`refuses a symlink at the unit path (force=${force}) — the victim behind the link is unchanged`, () => {
      mkdirSync(unitDir, { recursive: true });
      const victim = join(dir, "victim.txt");
      writeFileSync(victim, "do not touch\n");
      symlinkSync(victim, service);
      const r = writeUnitFiles(files(), { force });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.refused).toContainEqual({ path: service, reason: "symlink" });
      expect(readFileSync(victim, "utf-8")).toBe("do not touch\n");
      expect(lstatSync(service).isSymbolicLink()).toBe(true);
      expect(existsSync(timer)).toBe(false);
    });
  }

  it("refuses a dangling symlink (would otherwise create the target)", () => {
    mkdirSync(unitDir, { recursive: true });
    const victim = join(dir, "created-by-attacker-path.txt");
    symlinkSync(victim, timer);
    const r = writeUnitFiles(files(), { force: true });
    expect(r.ok).toBe(false);
    expect(existsSync(victim)).toBe(false);
  });

  it("refuses a directory at the unit path", () => {
    mkdirSync(service, { recursive: true });
    expect(preflightUnitFiles(files(), { force: true })).toEqual([{ path: service, reason: "not-a-file" }]);
  });
});
