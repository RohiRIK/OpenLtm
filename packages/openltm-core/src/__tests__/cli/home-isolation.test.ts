/**
 * cli/home-isolation.test.ts — installers stay inside the home they are given.
 *
 * Found by the 2.17.0 release verification: with the real user's
 * XDG_CONFIG_HOME inherited, detection reported OpenCode in an empty temp home,
 * installOpenCode({ homedir }) wrote the real ~/.config/opencode/opencode.json,
 * and the Pi tests ran the real `pi install` from PATH.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import { join } from "path";
import { configHomeFor, isProcessHome } from "../../cli/configHome.js";

describe("configHomeFor", () => {
  it("uses XDG_CONFIG_HOME only for the process home, and only when absolute", () => {
    const env = { XDG_CONFIG_HOME: "/xdg/config" };
    expect(configHomeFor(os.homedir(), env)).toBe("/xdg/config");
    expect(configHomeFor("/some/other/home", env)).toBe("/some/other/home/.config");
    expect(configHomeFor(os.homedir(), { XDG_CONFIG_HOME: "relative/dir" })).toBe(join(os.homedir(), ".config"));
    expect(configHomeFor(os.homedir(), {})).toBe(join(os.homedir(), ".config"));
    expect(isProcessHome(os.homedir() + "/")).toBe(true);
  });
});

describe("installers with an inherited XDG_CONFIG_HOME outside the given home", () => {
  let root: string;
  let home: string;
  let outside: string;
  let saved: { xdg?: string; path?: string };

  beforeEach(() => {
    root = mkdtempSync(join(os.tmpdir(), "ltm-home-isolation-"));
    home = join(root, "fake-home");
    outside = join(root, "outside-home-config");
    mkdirSync(home, { recursive: true });
    mkdirSync(join(outside, "opencode"), { recursive: true });
    writeFileSync(join(outside, "opencode", "opencode.json"), JSON.stringify({ plugin: [] }));
    saved = { xdg: process.env.XDG_CONFIG_HOME, path: process.env.PATH };
    process.env.XDG_CONFIG_HOME = outside;
  });

  afterEach(() => {
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
    process.env.PATH = saved.path;
    rmSync(root, { recursive: true, force: true });
  });

  it("detection does not see OpenCode in an empty home", async () => {
    const { detectAgents } = await import("../../cli/detect.js");
    expect(detectAgents(home)).toEqual({ claude: false, opencode: false, pi: false });
  });

  it("installOpenCode writes inside the given home and never touches the outside config", async () => {
    const { installOpenCode } = await import("../../cli/opencode.js");
    const before = readFileSync(join(outside, "opencode", "opencode.json"), "utf8");
    const res = await installOpenCode({ homedir: home });
    expect(res.status).toBe("installed");
    expect(readFileSync(join(outside, "opencode", "opencode.json"), "utf8")).toBe(before);
    expect(existsSync(join(outside, "opencode", "agents"))).toBe(false);
    const own = JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")) as { plugin: string[] };
    expect(own.plugin.some((p) => p.includes("@rohirik/opencode-ltm"))).toBe(true);
  });

  it("installPi for another home never runs the Pi CLI on PATH", async () => {
    const bin = join(root, "bin");
    const marker = join(root, "pi-was-run");
    mkdirSync(bin);
    writeFileSync(join(bin, "pi"), `#!/bin/sh\necho "$@" >> "${marker}"\n`);
    chmodSync(join(bin, "pi"), 0o755);
    process.env.PATH = `${bin}:${saved.path}`;

    const { installPi } = await import("../../cli/pi.js");
    const res = await installPi({ homedir: home });
    expect(res.status).toBe("skipped");
    expect(res.detail).toContain("another home");
    expect(existsSync(marker)).toBe(false);

    const { runInstallCli } = await import("../../cli/install.js");
    await runInstallCli({ targets: { claude: false, opencode: false, pi: true }, dryRun: false, homedir: home, silent: true });
    expect(existsSync(marker)).toBe(false);
  });
});
