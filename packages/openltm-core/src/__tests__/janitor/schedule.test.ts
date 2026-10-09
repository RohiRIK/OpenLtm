/**
 * schedule.test.ts — portable (non-Honker) janitor scheduling helpers.
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_JANITOR_RUN_INTERVAL_MINUTES,
  defaultScheduleKind,
  isJanitorDue,
  nextJanitorDueAt,
  renderCron,
  renderLaunchd,
  renderSystemd,
  resolveRunIntervalMinutes,
  type ScheduleSpec,
} from "../../janitor/schedule.js";

const spec: ScheduleSpec = {
  runtime: "/opt/bun/bin/bun",
  bin: "/home/me/OpenLtm/packages/openltm-core/src/cli/bin.ts",
  dbPath: "/home/me/data dir/openltm.db",
  runIntervalMinutes: 360,
  checkMinutes: 60,
  pathEnv: "/usr/bin:/bin",
};

describe("resolveRunIntervalMinutes", () => {
  it("defaults to 6h", () => {
    expect(resolveRunIntervalMinutes({})).toBe(DEFAULT_JANITOR_RUN_INTERVAL_MINUTES);
    expect(DEFAULT_JANITOR_RUN_INTERVAL_MINUTES).toBe(360);
  });
  it("treats the server's 0 ('auto-run off') setting as unset", () => {
    expect(resolveRunIntervalMinutes({ setting: "0" })).toBe(360);
  });
  it("flag > env > setting", () => {
    expect(resolveRunIntervalMinutes({ flag: 15, env: "30", setting: "45" })).toBe(15);
    expect(resolveRunIntervalMinutes({ env: "30", setting: "45" })).toBe(30);
    expect(resolveRunIntervalMinutes({ env: "nope", setting: "45" })).toBe(45);
  });
});

describe("isJanitorDue / nextJanitorDueAt", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("is due when never run or unparsable", () => {
    expect(isJanitorDue(null, 360, now)).toBe(true);
    expect(isJanitorDue("", 360, now)).toBe(true);
    expect(isJanitorDue("garbage", 360, now)).toBe(true);
  });
  it("respects the interval boundary", () => {
    expect(isJanitorDue("2026-10-05T06:00:01Z", 360, now)).toBe(false);
    expect(isJanitorDue("2026-10-05T06:00:00Z", 360, now)).toBe(true);
  });
  it("computes the next due time", () => {
    expect(nextJanitorDueAt("2026-10-05T06:00:00.000Z", 360)).toBe("2026-10-05T12:00:00.000Z");
    expect(nextJanitorDueAt(null, 360)).toBeNull();
  });
});

describe("renderers", () => {
  it("systemd: oneshot service + timer, if-due run, lock-held is success", () => {
    const r = renderSystemd(spec, "/home/me");
    expect(r.files.map((f) => f.path)).toEqual([
      "/home/me/.config/systemd/user/openltm-janitor.service",
      "/home/me/.config/systemd/user/openltm-janitor.timer",
    ]);
    const [service, timer] = r.files.map((f) => f.content);
    expect(service).toContain("Type=oneshot");
    expect(service).toContain(`ExecStart=/opt/bun/bin/bun --no-env-file ${spec.bin} janitor run --if-due --quiet --interval-minutes 360`);
    expect(service).toContain(`Environment="LTM_DB_PATH=/home/me/data dir/openltm.db"`);
    expect(service).toContain("SuccessExitStatus=4");
    expect(timer).toContain("OnUnitActiveSec=60min");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("WantedBy=timers.target");
    expect(r.activate.join("\n")).toContain("systemctl --user enable --now openltm-janitor.timer");
  });

  it("launchd: plist with escaped args, StartInterval from check cadence", () => {
    const r = renderLaunchd({ ...spec, dbPath: "/Users/me/a&b/openltm.db" }, "/Users/me");
    expect(r.files[0]!.path).toBe("/Users/me/Library/LaunchAgents/com.rohirik.openltm.janitor.plist");
    const plist = r.files[0]!.content;
    expect(plist).toContain("<string>--if-due</string>");
    expect(plist).toContain("<integer>3600</integer>");
    expect(plist).toContain("/Users/me/a&amp;b/openltm.db");
    expect(plist).not.toContain("a&b");
    expect(r.activate[0]).toContain("launchctl bootstrap gui/$(id -u)");
  });

  it("cron: hourly line with quoted paths", () => {
    const r = renderCron(spec);
    const line = r.activate.find((l) => !l.startsWith("#"))!;
    expect(line.startsWith("0 * * * * ")).toBe(true);
    expect(line).toContain("LTM_DB_PATH='/home/me/data dir/openltm.db'");
    expect(line).toContain("janitor run --if-due --quiet");
    expect(renderCron({ ...spec, checkMinutes: 15 }).activate[1]!.startsWith("*/15 * * * * ")).toBe(true);
    expect(renderCron({ ...spec, checkMinutes: 180 }).activate[1]!.startsWith("0 */3 * * * ")).toBe(true);
  });

  it("S6: every unit runs bun with --no-env-file from the DB directory, never $HOME or /", () => {
    const service = renderSystemd(spec, "/home/me").files[0]!.content;
    expect(service).toContain("WorkingDirectory=/home/me/data dir\n");
    expect(service).toMatch(/^ExecStart=\/opt\/bun\/bin\/bun --no-env-file /m);

    const plist = renderLaunchd(spec, "/Users/me").files[0]!.content;
    expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/home/me/data dir</string>");
    expect(plist).toMatch(/<string>\/opt\/bun\/bin\/bun<\/string>\s*<string>--no-env-file<\/string>/);

    const cron = renderCron(spec).activate[1]!;
    expect(cron).toContain("cd '/home/me/data dir' && LTM_DB_PATH=");
    expect(cron).toContain("/opt/bun/bin/bun --no-env-file ");
  });

  it("escapes systemd specifiers/variables and cron's % in paths", () => {
    const odd = { ...spec, dbPath: "/home/me/100% $HOME/openltm.db" };
    const service = renderSystemd(odd, "/home/me").files[0]!.content;
    expect(service).toContain("WorkingDirectory=/home/me/100%% $HOME\n");
    expect(service).toContain(`Environment="LTM_DB_PATH=/home/me/100%% $HOME/openltm.db"`);
    const exec = renderSystemd({ ...odd, bin: "/opt/$x/bin.ts" }, "/home/me").files[0]!.content;
    expect(exec).toContain(` "/opt/$$x/bin.ts" janitor run`);
    const cron = renderCron(odd).activate[1]!;
    expect(cron).toContain("cd '/home/me/100\\% $HOME' && LTM_DB_PATH='/home/me/100\\% $HOME/openltm.db'");
    expect(cron.replace(/\\%/g, "")).not.toContain("%");
  });

  it("bakes --interval-minutes in only when one was chosen", () => {
    const { runIntervalMinutes: _omit, ...unset } = spec;
    const service = renderSystemd(unset, "/home/me").files[0]!.content;
    expect(service).toMatch(/janitor run --if-due --quiet\n/);
    expect(service).not.toContain("--interval-minutes");
  });

  it("platform default: launchd on macOS, systemd elsewhere", () => {
    expect(defaultScheduleKind("darwin")).toBe("launchd");
    expect(defaultScheduleKind("linux")).toBe("systemd");
  });
});
