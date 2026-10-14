/**
 * hermes-upgrade-plugin.test.ts — hermes/upgrade-plugin.sh must upgrade the
 * Hermes plugin whether it was installed as a copied directory or a symlink,
 * and never delete or copy over a symlinked install.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..");
const SCRIPT = join(REPO, "hermes", "upgrade-plugin.sh");
const SOURCE = join(REPO, "hermes", "openltm_hermes");
const SOURCE_VERSION = readFileSync(join(SOURCE, "plugin.yaml"), "utf8").match(/^version:\s*"?([^"\s]+)/m)![1];

let home: string;
let pluginDir: string;

function run(...args: string[]) {
  const r = Bun.spawnSync(["bash", SCRIPT, ...args], {
    env: { ...process.env, HERMES_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

function installOldCopy() {
  mkdirSync(join(home, "plugins"), { recursive: true });
  cpSync(SOURCE, pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.yaml"), 'name: openltm\nversion: "0.0.1"\n');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ltm-hermes-upgrade-"));
  pluginDir = join(home, "plugins", "openltm");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("hermes/upgrade-plugin.sh", () => {
  it("--check reports a missing install and an outdated copy with exit 3", () => {
    expect(run("--check").code).toBe(3);
    installOldCopy();
    const r = run("--check");
    expect(r.code).toBe(3);
    expect(r.out).toContain("install:     copy");
    expect(r.out).toContain("status:      outdated");
  });

  it("upgrades a copied install, keeping the old copy outside plugins/", () => {
    installOldCopy();
    const r = run();
    expect(r.code).toBe(0);
    expect(lstatSync(pluginDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(pluginDir, "plugin.yaml"), "utf8")).toContain(SOURCE_VERSION);
    expect(readdirSync(join(home, "plugins"))).toEqual(["openltm"]);
    const backups = readdirSync(join(home, "plugin-backups"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(home, "plugin-backups", backups[0], "plugin.yaml"), "utf8")).toContain("0.0.1");
    expect(run("--check").code).toBe(0);
  });

  it("--dry-run changes nothing", () => {
    installOldCopy();
    expect(run("--dry-run").code).toBe(0);
    expect(readFileSync(join(pluginDir, "plugin.yaml"), "utf8")).toContain("0.0.1");
    expect(existsSync(join(home, "plugin-backups"))).toBe(false);
  });

  it("installs a fresh copy when none exists", () => {
    expect(run().code).toBe(0);
    expect(readFileSync(join(pluginDir, "plugin.yaml"), "utf8")).toContain(SOURCE_VERSION);
  });

  it("leaves a symlinked install in place and does not copy over it", () => {
    const other = join(home, "other-checkout");
    cpSync(SOURCE, other, { recursive: true });
    mkdirSync(join(home, "plugins"), { recursive: true });
    symlinkSync(other, pluginDir);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("install:     symlink");
    expect(lstatSync(pluginDir).isSymbolicLink()).toBe(true);
    expect(readlinkSync(pluginDir)).toBe(other);
    expect(existsSync(join(home, "plugin-backups"))).toBe(false);
  });

  it("--link replaces a copy with a symlink to this checkout", () => {
    installOldCopy();
    expect(run("--link").code).toBe(0);
    expect(lstatSync(pluginDir).isSymbolicLink()).toBe(true);
    expect(realpathSync(pluginDir)).toBe(realpathSync(SOURCE));
    expect(readdirSync(join(home, "plugin-backups"))).toHaveLength(1);
  });
});
