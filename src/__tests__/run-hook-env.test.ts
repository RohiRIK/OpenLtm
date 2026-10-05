/**
 * run-hook-env.test.ts — hooks/bin/run-hook.sh must not let Bun auto-load the
 * user's project .env into LTM hooks (security S6).
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
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
});
