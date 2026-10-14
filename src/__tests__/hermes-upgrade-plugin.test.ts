/**
 * hermes-upgrade-plugin.test.ts — hermes/upgrade-plugin.sh must upgrade the
 * Hermes plugin whether it was installed as a copied directory or a symlink,
 * and never delete or copy over a symlinked install.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { createHash } from "crypto";
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

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
};
function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}
function runEnv(env: Record<string, string>, ...args: string[]) {
  const r = Bun.spawnSync(["bash", SCRIPT, ...args], { env: { ...GIT_ENV, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

/** upstream repo + clone; the plugin is a symlink into the clone; upstream is one commit ahead. */
function symlinkedCheckoutBehind() {
  const up = join(home, "upstream");
  const clone = join(home, "clone");
  mkdirSync(up);
  git(up, "init", "-q", "-b", "main");
  cpSync(SOURCE, join(up, "openltm_hermes"), { recursive: true });
  git(up, "add", "-A");
  git(up, "commit", "-qm", "one");
  Bun.spawnSync(["git", "clone", "-q", up, clone], { env: GIT_ENV });
  writeFileSync(join(up, "new.txt"), "two\n");
  git(up, "add", "-A");
  git(up, "commit", "-qm", "two");
  mkdirSync(join(home, "plugins"), { recursive: true });
  symlinkSync(join(clone, "openltm_hermes"), pluginDir);
  return { up, clone };
}

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

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

  it("--pull fast-forwards a clean symlinked checkout", () => {
    const { up, clone } = symlinkedCheckoutBehind();
    const r = run("--pull");
    expect(r.code).toBe(0);
    expect(git(clone, "rev-parse", "HEAD")).toBe(git(up, "rev-parse", "HEAD"));
  });

  it("--pull refuses a checkout with uncommitted changes and leaves HEAD alone", () => {
    const { up, clone } = symlinkedCheckoutBehind();
    const before = git(clone, "rev-parse", "HEAD");
    writeFileSync(join(clone, "openltm_hermes", "local.txt"), "mine\n");
    const r = run("--pull");
    expect(r.code).toBe(1);
    expect(r.out).toContain("uncommitted changes");
    expect(git(clone, "rev-parse", "HEAD")).toBe(before);
    expect(before).not.toBe(git(up, "rev-parse", "HEAD"));
    expect(readFileSync(join(clone, "openltm_hermes", "local.txt"), "utf8")).toBe("mine\n");
  });

  it("--pull on a symlink into a non-git directory exits 1", () => {
    const other = join(home, "other-checkout");
    cpSync(SOURCE, other, { recursive: true });
    mkdirSync(join(home, "plugins"), { recursive: true });
    symlinkSync(other, pluginDir);
    const r = run("--pull");
    expect(r.code).toBe(1);
    expect(r.out).toContain("not inside a git checkout");
  });

  it("a broken symlink is an error and the link is kept", () => {
    mkdirSync(join(home, "plugins"), { recursive: true });
    symlinkSync(join(home, "gone"), pluginDir);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("broken");
    expect(lstatSync(pluginDir).isSymbolicLink()).toBe(true);
    expect(readlinkSync(pluginDir)).toBe(join(home, "gone"));
  });

  it("an unknown flag prints usage and exits 1 without touching anything", () => {
    const r = run("--bogus");
    expect(r.code).toBe(1);
    expect(r.out).toContain("unknown option: --bogus");
    expect(existsSync(join(home, "plugins"))).toBe(false);
  });

  it("never touches openltm.json or the DB", () => {
    const files = ["openltm.json", "openltm.db", "openltm.db-wal", "openltm.db-shm"];
    for (const f of files) writeFileSync(join(home, f), `data ${f}\n`);
    const before = files.map((f) => [sha(join(home, f)), lstatSync(join(home, f)).mtimeMs]);
    installOldCopy();
    expect(run().code).toBe(0);
    expect(run("--link").code).toBe(0);
    expect(files.map((f) => [sha(join(home, f)), lstatSync(join(home, f)).mtimeMs])).toEqual(before);
  });

  it("skips the backup when the copied install is already current", () => {
    installOldCopy();
    expect(run().code).toBe(0);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("already matches");
    expect(readdirSync(join(home, "plugin-backups"))).toHaveLength(1);
  });

  it("keeps at most OPENLTM_KEEP_BACKUPS backups, dropping the oldest", () => {
    mkdirSync(join(home, "plugin-backups"), { recursive: true });
    const old = ["openltm-20200101-000000", "openltm-20200101-000000-2", "openltm-20200102-000000"];
    for (const b of old) mkdirSync(join(home, "plugin-backups", b));
    writeFileSync(join(home, "plugin-backups", "notes.txt"), "keep\n");
    installOldCopy();
    expect(runEnv({ HERMES_HOME: home, OPENLTM_KEEP_BACKUPS: "2" }).code).toBe(0);
    const left = readdirSync(join(home, "plugin-backups")).sort();
    expect(left).toHaveLength(3);
    expect(left).toContain("notes.txt");
    expect(left).toContain("openltm-20200102-000000");
    expect(left).not.toContain("openltm-20200101-000000");
  });

  it("refuses an empty or / HERMES_HOME and an unset HOME", () => {
    for (const h of ["", "/", "//"]) {
      const r = runEnv({ HERMES_HOME: h });
      expect(r.code).toBe(1);
      expect(r.out).toContain("HERMES_HOME");
    }
    const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
    const r = Bun.spawnSync(["bash", SCRIPT, "--check"], { env, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("HOME is not set");
  });
});
