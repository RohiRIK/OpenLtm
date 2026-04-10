import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const CONFIG_MODULE = join(PROJECT_ROOT, "src", "config.ts");
const TMP_DIRS: string[] = [];

function runConfig(env: Record<string, string>) {
  return Bun.spawnSync(
    ["bun", "--eval", `
      import { loadConfig } from ${JSON.stringify(CONFIG_MODULE)};
      const cfg = await loadConfig();
      console.log(JSON.stringify(cfg));
    `],
    {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_ROOT,
    },
  );
}

afterEach(() => {
  for (const dir of TMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("autoRecall config", () => {
  it("defaults to true", () => {
    const home = mkdtempSync(join(tmpdir(), "auto-recall-home-"));
    TMP_DIRS.push(home);
    mkdirSync(join(home, ".claude"), { recursive: true });

    const result = runConfig({ HOME: home, LTM_DB_PATH: "/tmp/auto-recall-default.db" });
    expect(result.exitCode).toBe(0);

    const cfg = JSON.parse(new TextDecoder().decode(result.stdout)) as { ltm: { autoRecall: boolean } };
    expect(cfg.ltm.autoRecall).toBe(true);
  });

  it("can be set to false in config", () => {
    const home = mkdtempSync(join(tmpdir(), "auto-recall-home-"));
    TMP_DIRS.push(home);
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "config.json"),
      JSON.stringify({ ltm: { autoRecall: false } }, null, 2),
    );

    const result = runConfig({ HOME: home, LTM_DB_PATH: "/tmp/auto-recall-false.db" });
    expect(result.exitCode).toBe(0);

    const cfg = JSON.parse(new TextDecoder().decode(result.stdout)) as { ltm: { autoRecall: boolean } };
    expect(cfg.ltm.autoRecall).toBe(false);
  });

  it("keeps other config values alongside autoRecall", () => {
    const home = mkdtempSync(join(tmpdir(), "auto-recall-home-"));
    TMP_DIRS.push(home);
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "config.json"),
      JSON.stringify(
        {
          ltm: {
            autoRecall: false,
            injectTopN: 7,
            decayEnabled: false,
            gitLearnEnabled: true,
          },
          server: { apiPort: 7444, uiPort: 7445 },
        },
        null,
        2,
      ),
    );

    const result = runConfig({ HOME: home, LTM_DB_PATH: "/tmp/auto-recall-mixed.db" });
    expect(result.exitCode).toBe(0);

    const cfg = JSON.parse(new TextDecoder().decode(result.stdout)) as {
      ltm: { autoRecall: boolean; injectTopN: number; decayEnabled: boolean; gitLearnEnabled: boolean };
      server: { apiPort: number; uiPort: number };
    };

    expect(cfg.ltm.autoRecall).toBe(false);
    expect(cfg.ltm.injectTopN).toBe(7);
    expect(cfg.ltm.decayEnabled).toBe(false);
    expect(cfg.ltm.gitLearnEnabled).toBe(true);
    expect(cfg.server.apiPort).toBe(7444);
    expect(cfg.server.uiPort).toBe(7445);
  });
});
