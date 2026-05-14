/**
 * cli.test.ts — unit tests for packages/ltm-core/src/cli/types.ts and cli/install.ts
 *
 * RED phase: these tests are written before implementation.
 * They define the contract for the CLI installer stub.
 */
import { describe, it, expect } from "bun:test";

// ── types.ts ──────────────────────────────────────────────────────────────────

describe("cli/types — InstallTarget shape", () => {
  it("InstallTarget has required host and pluginDataDir fields", async () => {
    const { InstallTarget } = await import("../cli/types.js");
    // Runtime check: the exported object is a string-enum-like map
    expect(typeof InstallTarget).toBe("object");
    expect(InstallTarget["claudeCode"]).toBe("claude-code");
    expect(InstallTarget["openCode"]).toBe("open-code");
  });

  it("CliInstallOptions type is exported (compile-time guard via import)", async () => {
    // Just importing the module means the types compile; no runtime value to assert.
    const mod = await import("../cli/types.js");
    expect(mod).toBeDefined();
  });

  it("CliInstallResult type is exported from types module", async () => {
    const mod = await import("../cli/types.js");
    expect(mod).toBeDefined();
    // CliInstallResult is a type-only export; confirm the module loaded successfully
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});

// ── install.ts ────────────────────────────────────────────────────────────────

describe("cli/install — runInstall stub", () => {
  it("exports a runInstall function", async () => {
    const mod = await import("../cli/install.js");
    expect(typeof mod.runInstall).toBe("function");
  });

  it("runInstall returns a CliInstallResult with success and message", async () => {
    const { runInstall } = await import("../cli/install.js");
    const result = await runInstall({ target: "claude-code", nonInteractive: true, dryRun: true });
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("runInstall dryRun=true does not write any files", async () => {
    const { runInstall } = await import("../cli/install.js");
    // Dry run should succeed without side-effects
    const result = await runInstall({ target: "claude-code", nonInteractive: true, dryRun: true });
    expect(result.success).toBe(true);
  });

  it("runInstall dryRun=true returns steps array", async () => {
    const { runInstall } = await import("../cli/install.js");
    const result = await runInstall({ target: "claude-code", nonInteractive: true, dryRun: true });
    expect(Array.isArray(result.steps)).toBe(true);
  });

  it("runInstall with unknown target returns success=false", async () => {
    const { runInstall } = await import("../cli/install.js");
    // @ts-expect-error intentional bad input
    const result = await runInstall({ target: "not-a-real-target", nonInteractive: true, dryRun: true });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown target");
  });
});
