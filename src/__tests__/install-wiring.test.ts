/**
 * install-wiring.test.ts — scripts/install-wiring.ts hook wiring (Sam lows on #27):
 * quoted roots, exact-match SessionEnd cleanup, clear malformed-JSON failure.
 * Runs the script in a subprocess with an isolated HOME (also isolates git --global).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "install-wiring.ts");
const OTHER_SESSION_END = "bun run /opt/other-tool/hooks/src/SessionEnd.ts";

describe("install-wiring hooks", () => {
  let home: string;
  let root: string;
  let settingsPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ltm-wiring-"));
    root = join(home, "My Plugins", "OpenLtm");
    mkdirSync(join(root, "hooks", "bin"), { recursive: true });
    writeFileSync(join(root, "hooks", "bin", "run-hook.sh"), "#!/bin/sh\n");
    mkdirSync(join(home, ".claude"), { recursive: true });
    settingsPath = join(home, ".claude", "settings.json");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function run(extraEnv: Record<string, string> = {}): { code: number; out: string } {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "CLAUDE_PLUGIN_DATA") env[k] = v;
    const r = Bun.spawnSync([process.execPath, SCRIPT, root], {
      env: { ...env, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), ...extraEnv }, stdout: "pipe", stderr: "pipe",
    });
    return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
  }
  const commands = (event: string): string[] =>
    (JSON.parse(readFileSync(settingsPath, "utf-8")).hooks?.[event] ?? []).flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));

  it("dev install quotes a root with spaces, upgrades the legacy unquoted entry in place, keeps other tools' SessionEnd", () => {
    const legacy = `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/SessionStart.ts`;
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: "", hooks: [{ type: "command", command: legacy }] }],
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: OTHER_SESSION_END }] }],
        // pre-2.17 dev installs ran EvaluateSession on Stop (every turn)
        Stop: [{ matcher: "", hooks: [{ type: "command", command: `CLAUDE_PLUGIN_ROOT=${root} bun run ${root}/hooks/src/EvaluateSession.ts` }] }],
      },
    }));
    const r = run();
    expect(r.code).toBe(0);
    const quoted = `CLAUDE_PLUGIN_ROOT='${root}' bun run '${root}/hooks/src/SessionStart.ts'`;
    expect(commands("SessionStart")).toEqual([quoted]); // upgraded, not duplicated
    const ltm = (file: string) => `CLAUDE_PLUGIN_ROOT='${root}' bun run '${root}/hooks/src/${file}'`;
    expect(commands("SessionEnd")).toEqual([OTHER_SESSION_END, ltm("EvaluateSession.ts"), ltm("SessionEnd.ts")]);
    expect(commands("Stop")).toEqual([ltm("UpdateContext.ts")]); // stale Stop→EvaluateSession removed
    expect(commands("UserPromptSubmit")).toEqual([ltm("UserPromptSubmit.ts")]);
    expect(commands("PostToolUse")).toEqual([ltm("PostToolUse.ts")]);
    expect(JSON.parse(readFileSync(settingsPath, "utf-8")).hooks.PostToolUse[0].matcher).toBe("Bash");
    // idempotent
    expect(run().code).toBe(0);
    expect(commands("SessionEnd").length).toBe(3);
    expect(commands("Stop").length).toBe(1);
    expect(readFileSync(join(home, ".claude", "hooks", "git", "post-commit"), "utf-8")).toContain(`bun '${root}/hooks/GitCommit.bundle.mjs'`);
  });

  it("marketplace cleanup removes only LTM's exact SessionEnd command, not another tool's SessionEnd.ts", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionEnd: [
          { matcher: "", hooks: [{ type: "command", command: OTHER_SESSION_END }] },
          { matcher: "", hooks: [{ type: "command", command: `CLAUDE_PLUGIN_ROOT='${root}' bun run '${root}/hooks/src/SessionEnd.ts'` }] },
        ],
      },
    }));
    const r = run({ CLAUDE_PLUGIN_DATA: join(home, "plugdata") });
    expect(r.code).toBe(0);
    expect(commands("SessionEnd")).toEqual([OTHER_SESSION_END]);
  });

  it("malformed settings.json fails with a clear message and is left untouched", () => {
    writeFileSync(settingsPath, "{ not json");
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${settingsPath} is not valid JSON`);
    expect(r.out).toContain("nothing was changed");
    expect(readFileSync(settingsPath, "utf-8")).toBe("{ not json");
  });

  it("malformed ~/.claude.json is skipped with a warning, install continues", () => {
    writeFileSync(join(home, ".claude.json"), "nope{");
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Skipping");
    expect(readFileSync(join(home, ".claude.json"), "utf-8")).toBe("nope{");
  });
});
