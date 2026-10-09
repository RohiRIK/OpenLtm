/**
 * SessionStart: source-aware behaviour, removed side effects, globals for new
 * projects, proposals notice, injectTopN, prompt-recall dedupe seeding.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  HOOKS_SRC, initSandboxDb, makeSandbox, markOnboarded, registerProject, runHook, seedMemory, writeConfig,
  type Sandbox,
} from "./hookHarness";

let sb: Sandbox;
let cwd: string;

beforeEach(() => {
  sb = makeSandbox("ss-sources");
  cwd = join(sb.base, "workspace", "demo-app");
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => sb.cleanup());

describe("SessionStart — removed side effects", () => {
  it("source no longer fetches the marketplace clone or patches known_marketplaces.json", () => {
    const src = readFileSync(join(HOOKS_SRC, "SessionStart.ts"), "utf-8");
    expect(src).not.toContain("known_marketplaces");
    expect(src).not.toContain('"fetch"');
    expect(src).not.toMatch(/spawnSync\("bun"/);
    expect(src).toContain("process.execPath");
  });

  it("never runs git and leaves the user's Claude config untouched", async () => {
    // A fake `git` first on PATH records any invocation.
    const fakeBin = join(sb.base, "fakebin");
    mkdirSync(fakeBin);
    const marker = join(sb.base, "git-was-called");
    writeFileSync(join(fakeBin, "git"), `#!/bin/sh\necho "$@" >> "${marker}"\n`);
    chmodSync(join(fakeBin, "git"), 0o755);

    // Shape the old patchMarketplaceSource() would have rewritten.
    const known = join(sb.home, ".claude", "plugins", "known_marketplaces.json");
    mkdirSync(join(sb.home, ".claude", "plugins"), { recursive: true });
    const before = JSON.stringify({ ltm: { source: { source: "git", url: "https://github.com/RohiRIK/OpenLtm.git" } } }, null, 2);
    writeFileSync(known, before);

    markOnboarded(sb);
    const { exitCode } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb,
      { PATH: `${fakeBin}:${process.env.PATH ?? ""}` });
    expect(exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(known, "utf-8")).toBe(before);
  }, 30_000);
});

describe("SessionStart — source handling", () => {
  const counter = () => join(sb.home, ".claude", "tmp", "session-tool-count.txt");

  it("resets the tool counter on startup/clear only", async () => {
    markOnboarded(sb);
    mkdirSync(join(sb.home, ".claude", "tmp"), { recursive: true });
    writeFileSync(counter(), "7");

    await runHook("SessionStart.ts", { cwd, source: "resume" }, sb);
    expect(readFileSync(counter(), "utf-8")).toBe("7");
    await runHook("SessionStart.ts", { cwd, source: "compact" }, sb);
    expect(readFileSync(counter(), "utf-8")).toBe("7");
    await runHook("SessionStart.ts", { cwd, source: "clear" }, sb);
    expect(readFileSync(counter(), "utf-8")).toBe("0");
  }, 60_000);

  for (const source of ["resume", "compact"] as const) {
    it(`${source}: skips onboarding and new-project prompts`, async () => {
      const { exitCode, stdout } = await runHook("SessionStart.ts", { cwd, source }, sb);
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain("auto-onboard");
      expect(stdout).not.toContain("New Project Detected");
      expect(stdout).not.toContain("Should I create");
      expect(existsSync(join(sb.data, "onboarded.flag"))).toBe(false);
    }, 30_000);
  }

  it("clear: shows the new-project prompt but does not onboard", async () => {
    const { stdout } = await runHook("SessionStart.ts", { cwd, source: "clear" }, sb);
    expect(stdout).toContain("New Project Detected");
    expect(stdout).not.toContain("auto-onboard");
  }, 30_000);

  it("compact: leads with the PreCompact snapshot instead of re-exporting over it", async () => {
    markOnboarded(sb);
    initSandboxDb(sb);
    const projectDir = registerProject(sb, cwd, "snap");
    const snapshot = [
      "# Context Summary",
      `**Project:** snap (${cwd})`,
      "**Compaction checkpoint:** 2026-10-04 10:00:00",
      "",
      "## Current Goal",
      "",
      "ship the source-aware SessionStart",
      "",
    ].join("\n");
    writeFileSync(join(projectDir, "context-summary.md"), snapshot);

    const { stdout } = await runHook("SessionStart.ts", { cwd, source: "compact" }, sb);
    expect(stdout.startsWith("## LTM Session: snap | compaction snapshot")).toBe(true);
    expect(stdout).toContain("**Compaction checkpoint:** 2026-10-04 10:00:00");
    expect(stdout).toContain("ship the source-aware SessionStart");
    expect(readFileSync(join(projectDir, "context-summary.md"), "utf-8")).toBe(snapshot);
  }, 30_000);
});

describe("SessionStart — injection", () => {
  it("brand-new project still gets the globals section", async () => {
    markOnboarded(sb);
    initSandboxDb(sb);
    seedMemory(sb, { content: "Global rule: never commit secrets to the repo", importance: 5, category: "constraint" });

    const { stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    expect(stdout).toContain("New Project Detected");
    expect(stdout).toContain('registered this project as **"demo-app"**');
    expect(stdout).toContain("globals:");
    expect(stdout).toContain("never commit secrets to the repo");
    const registry = JSON.parse(readFileSync(join(sb.data, "projects", "registry.json"), "utf-8"));
    expect(registry[cwd]).toBe("demo-app");
  }, 30_000);

  it("announces pending memory proposals", async () => {
    markOnboarded(sb);
    const none = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    expect(none.stdout).not.toContain("memory proposal");

    mkdirSync(join(sb.data, "proposals"), { recursive: true });
    writeFileSync(join(sb.data, "proposals", "sess-1.json"), JSON.stringify({
      generatedAt: Date.now(),
      proposals: [
        { content: "Use bun, not npm", category: "preference", importance: 3, source: "evaluate-session" },
        { content: "Hooks run with a stripped PATH", category: "gotcha", importance: 4, source: "evaluate-session" },
      ],
    }));
    const { stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    expect(stdout).toContain("💡 2 memory proposal(s) pending — review with /openltm:memory propose review");
  }, 60_000);

  it("ltm.injectTopN caps project-scoped memories", async () => {
    markOnboarded(sb);
    initSandboxDb(sb);
    registerProject(sb, cwd, "capped");
    for (let i = 0; i < 6; i++) seedMemory(sb, { content: `capped project fact number ${i}`, project: "capped", importance: 3 });
    writeConfig(sb, { ltm: { injectTopN: 2 } });

    const { stdout } = await runHook("SessionStart.ts", { cwd, source: "startup" }, sb);
    const projectBlock = stdout.split("project:\n")[1] ?? "";
    const bullets = projectBlock.split("\n\n")[0]!.split("\n").filter(l => l.startsWith("- ["));
    expect(bullets.length).toBe(2);
  }, 30_000);

  it("seeds the prompt-recall dedupe state with injected memory IDs", async () => {
    markOnboarded(sb);
    initSandboxDb(sb);
    const id = seedMemory(sb, { content: "Global gotcha: hooks run with a stripped PATH", importance: 4, category: "gotcha" });

    await runHook("SessionStart.ts", { cwd, source: "startup", session_id: "sess-abc" }, sb);
    const state = JSON.parse(readFileSync(join(sb.tmp, "ltm-prompt-recall-sess-abc.json"), "utf-8"));
    expect(state.ids).toContain(id);
  }, 30_000);
});
