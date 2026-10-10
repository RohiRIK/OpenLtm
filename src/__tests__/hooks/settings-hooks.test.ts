/**
 * OpenLTM hooks left in ~/.claude/settings.json next to the plugin (found by the
 * 2.17.0 release verification on a real machine): detection, the
 * unwire-legacy-hooks fix command, and SessionStart's warning.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { findLtmHooks, isLtmHookCommand, removeLtmHooks, type HooksSection } from "../../../hooks/lib/settingsHooks";
import { initSandboxDb, makeSandbox, markOnboarded, runHook } from "./hookHarness";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const DEV = "/home/me/src/OpenLtm";
const OTHER_TOOL = { matcher: "", hooks: [{ type: "command", command: "bun run /opt/other-tool/hooks/SessionEnd.ts" }] };

function settingsWithLegacy(): { hooks: HooksSection; theme: string } {
  return {
    theme: "dark",
    hooks: {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: `CLAUDE_PLUGIN_ROOT='${DEV}' bun run '${DEV}/hooks/src/SessionStart.ts'` }] },
        { matcher: "", hooks: [{ type: "command", command: "echo other-tool" }] },
      ],
      Stop: [{ matcher: "", hooks: [{ type: "command", command: `bun run ${DEV}/hooks/src/EvaluateSession.ts` }] }],
      SessionEnd: [
        OTHER_TOOL,
        { matcher: "", hooks: [{ type: "command", command: "LTM_DB_PATH=/x/openltm.db /usr/bin/bunx @rohirik/openltm-core hook --name SessionEnd" }] },
      ],
    },
  };
}

describe("settingsHooks matcher", () => {
  it("finds dev-install, original-path and bunx OpenLTM hooks, not other tools'", () => {
    expect(isLtmHookCommand(`CLAUDE_PLUGIN_ROOT=${DEV} bun run ${DEV}/hooks/src/UserPromptSubmit.ts`)).toBe(true);
    expect(isLtmHookCommand("bun run /opt/other-tool/hooks/SessionEnd.ts")).toBe(false);
    const found = findLtmHooks(settingsWithLegacy().hooks).map((f) => f.event);
    expect(found).toEqual(["SessionStart", "Stop", "SessionEnd"]);
  });

  it("removeLtmHooks keeps other tools' entries and drops emptied events", () => {
    const { hooks } = settingsWithLegacy();
    expect(removeLtmHooks(hooks)).toBe(3);
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.SessionStart).toEqual([{ matcher: "", hooks: [{ type: "command", command: "echo other-tool" }] }]);
    expect(hooks.SessionEnd).toEqual([OTHER_TOOL]);
  });
});

describe("scripts/unwire-legacy-hooks.ts", () => {
  const run = (home: string, ...args: string[]) => Bun.spawnSync(
    [process.execPath, "run", join(PROJECT_ROOT, "scripts", "unwire-legacy-hooks.ts"), ...args],
    { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }, stdout: "pipe", stderr: "pipe" },
  );

  it("--check lists without changing; the default removes with a backup", () => {
    const sb = makeSandbox("unwire");
    try {
      mkdirSync(join(sb.home, ".claude"), { recursive: true });
      const path = join(sb.home, ".claude", "settings.json");
      writeFileSync(path, JSON.stringify(settingsWithLegacy()));
      const original = readFileSync(path, "utf-8");

      const check = run(sb.home, "--check");
      expect(check.exitCode).toBe(3);
      expect(check.stdout.toString()).toContain("3 OpenLTM hook entries");
      expect(readFileSync(path, "utf-8")).toBe(original);

      const fix = run(sb.home);
      expect(fix.exitCode).toBe(0);
      const after = JSON.parse(readFileSync(path, "utf-8"));
      expect(after.theme).toBe("dark");
      expect(findLtmHooks(after.hooks)).toEqual([]);
      expect(after.hooks.SessionEnd).toEqual([OTHER_TOOL]);
      const backups = readdirSync(join(sb.home, ".claude")).filter((f) => f.startsWith("settings.json.bak-openltm-"));
      expect(backups.length).toBe(1);
      expect(readFileSync(join(sb.home, ".claude", backups[0]!), "utf-8")).toBe(original);
      expect(run(sb.home, "--check").exitCode).toBe(0);
    } finally {
      sb.cleanup();
    }
  });

  it("refuses a malformed settings.json without touching it", () => {
    const sb = makeSandbox("unwire-bad");
    try {
      mkdirSync(join(sb.home, ".claude"), { recursive: true });
      writeFileSync(join(sb.home, ".claude", "settings.json"), "{ not json");
      expect(run(sb.home).exitCode).toBe(1);
      expect(readFileSync(join(sb.home, ".claude", "settings.json"), "utf-8")).toBe("{ not json");
    } finally {
      sb.cleanup();
    }
  });
});

describe("SessionStart duplicate-hooks warning", () => {
  it("warns when running as the plugin with OpenLTM hooks in settings.json, and not otherwise", async () => {
    const sb = makeSandbox("dup-hooks");
    try {
      const cwd = join(sb.base, "code", "app");
      mkdirSync(join(cwd, ".git"), { recursive: true });
      markOnboarded(sb);
      initSandboxDb(sb);
      const start = async () => (await runHook("SessionStart.ts", { cwd, session_id: "s1", source: "startup" }, sb)).stdout;

      expect(await start()).not.toContain("also wired in");
      mkdirSync(join(sb.home, ".claude"), { recursive: true });
      writeFileSync(join(sb.home, ".claude", "settings.json"), JSON.stringify(settingsWithLegacy()));
      const out = await start();
      expect(out).toContain("3 OpenLTM hook entries are also wired in");
      expect(out).toContain("scripts/unwire-legacy-hooks.ts");
      expect(existsSync(join(sb.home, ".claude", "settings.json"))).toBe(true); // warns, never edits
      // A dev install's own hooks (no CLAUDE_PLUGIN_DATA) are the only hooks — no warning.
      const dev = await runHook("SessionStart.ts", { cwd, session_id: "s2", source: "startup" }, sb, { CLAUDE_PLUGIN_DATA: undefined });
      expect(dev.stdout).not.toContain("also wired in");
    } finally {
      sb.cleanup();
    }
  }, 60_000);
});
