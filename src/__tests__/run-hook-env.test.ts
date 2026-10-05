/**
 * run-hook-env.test.ts — hooks/bin/run-hook.sh must not let Bun auto-load the
 * user's project .env into LTM hooks (security S6).
 */
import { describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const RUN_HOOK = join(import.meta.dir, "..", "..", "hooks", "bin", "run-hook.sh");

describe("run-hook.sh", () => {
  it("runs the hook with --no-env-file: a planted project .env is not loaded", () => {
    const project = mkdtempSync(join(tmpdir(), "ltm-runhook-env-"));
    try {
      writeFileSync(join(project, ".env"), "OLLAMA_BASE_URL=http://evil.example:11434\nGEMINI_API_KEY=stolen\n");
      const probe = join(project, "probe.ts");
      writeFileSync(probe, "console.log(JSON.stringify({ o: process.env.OLLAMA_BASE_URL ?? null, g: process.env.GEMINI_API_KEY ?? null }));\n");
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "OLLAMA_BASE_URL" && k !== "GEMINI_API_KEY") env[k] = v;
      const r = Bun.spawnSync(["sh", RUN_HOOK, probe], { cwd: project, env, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.toString().trim())).toEqual({ o: null, g: null });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("pins Bun to the plugin bunfig: a hostile project bunfig.toml preload does not run", () => {
    const project = mkdtempSync(join(tmpdir(), "ltm-runhook-bunfig-"));
    try {
      const marker = join(project, "PRELOAD_RAN");
      writeFileSync(join(project, "evil-preload.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "pwned");\n`);
      writeFileSync(join(project, "bunfig.toml"), `preload = ["./evil-preload.js"]\n`);
      const probe = join(project, "probe.ts");
      writeFileSync(probe, "console.log('hook ran');\n");

      // Sanity: plain bun from this cwd DOES run the hostile preload.
      Bun.spawnSync([process.execPath, "run", probe], { cwd: project, stdout: "pipe", stderr: "pipe" });
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);

      const r = Bun.spawnSync(["sh", RUN_HOOK, probe], { cwd: project, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain("hook ran");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("falls back to an empty config (never the project's) when the plugin bunfig.toml is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ltm-runhook-nobunfig-"));
    try {
      const plugin = join(root, "plugin");
      mkdirSync(join(plugin, "hooks", "bin"), { recursive: true });
      cpSync(RUN_HOOK, join(plugin, "hooks", "bin", "run-hook.sh")); // plugin copy with no bunfig.toml
      const project = join(root, "project");
      mkdirSync(project);
      const marker = join(project, "PRELOAD_RAN");
      writeFileSync(join(project, "evil-preload.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "pwned");\n`);
      writeFileSync(join(project, "bunfig.toml"), `preload = ["./evil-preload.js"]\n`);
      const probe = join(project, "probe.ts");
      writeFileSync(probe, "console.log('hook ran');\n");

      const r = Bun.spawnSync(["sh", join(plugin, "hooks", "bin", "run-hook.sh"), probe], { cwd: project, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain("hook ran");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
