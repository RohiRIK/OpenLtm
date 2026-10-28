/**
 * claude-plugin-data.test.ts — where the installed Claude Code plugin keeps its data.
 * Measured with Claude Code 2.1.296: plugins/data/<plugin>-<marketplace> → openltm-OpenLtm.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClaudePluginDataDir, sharedDbPath } from "../project.js";

// On a case-insensitive FS (APFS default) OpenLtm-openltm and openltm-OpenLtm are one dir.
const caseInsensitiveFs = existsSync(tmpdir().toUpperCase());

let root: string;
let savedConfigDir: string | undefined;
const withDb = (claudeDir: string, name: string) => {
  mkdirSync(join(claudeDir, "plugins", "data", name), { recursive: true });
  writeFileSync(join(claudeDir, "plugins", "data", name, "openltm.db"), "");
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "claude-plugin-data-")); savedConfigDir = process.env["CLAUDE_CONFIG_DIR"]; delete process.env["CLAUDE_CONFIG_DIR"]; });
afterEach(() => { savedConfigDir === undefined ? delete process.env["CLAUDE_CONFIG_DIR"] : (process.env["CLAUDE_CONFIG_DIR"] = savedConfigDir); rmSync(root, { recursive: true, force: true }); });

describe("getClaudePluginDataDir", () => {
  it("defaults to openltm-OpenLtm, the dir Claude Code creates", () => {
    expect(getClaudePluginDataDir(root)).toBe(join(root, "plugins", "data", "openltm-OpenLtm"));
  });
  it.skipIf(caseInsensitiveFs)("keeps a database that exists only under the older OpenLtm-openltm name", () => {
    withDb(root, "OpenLtm-openltm");
    expect(getClaudePluginDataDir(root)).toBe(join(root, "plugins", "data", "OpenLtm-openltm"));
  });
  it("prefers openltm-OpenLtm when both hold a database", () => {
    withDb(root, "OpenLtm-openltm");
    withDb(root, "openltm-OpenLtm");
    expect(getClaudePluginDataDir(root)).toBe(join(root, "plugins", "data", "openltm-OpenLtm"));
  });
  it("an older dir without a database does not win", () => {
    mkdirSync(join(root, "plugins", "data", "OpenLtm-openltm", "logs"), { recursive: true });
    expect(getClaudePluginDataDir(root)).toBe(join(root, "plugins", "data", "openltm-OpenLtm"));
  });
  it("follows CLAUDE_CONFIG_DIR like Claude Code does", () => {
    process.env["CLAUDE_CONFIG_DIR"] = join(root, "alt");
    expect(getClaudePluginDataDir()).toBe(join(root, "alt", "plugins", "data", "openltm-OpenLtm"));
  });
});

describe("sharedDbPath (no LTM_DB_PATH, no CLAUDE_PLUGIN_DATA)", () => {
  it("shares the Claude Code plugin's database when there is none of its own yet", () => {
    process.env["CLAUDE_CONFIG_DIR"] = root;
    withDb(root, "openltm-OpenLtm");
    expect(sharedDbPath(join(root, "own", "openltm.db"))).toBe(join(root, "plugins", "data", "openltm-OpenLtm", "openltm.db"));
  });
  it("keeps a database that already exists at its own default, so nothing moves", () => {
    process.env["CLAUDE_CONFIG_DIR"] = root;
    withDb(root, "openltm-OpenLtm");
    mkdirSync(join(root, "own"), { recursive: true });
    writeFileSync(join(root, "own", "openltm.db"), "");
    expect(sharedDbPath(join(root, "own", "openltm.db"))).toBe(join(root, "own", "openltm.db"));
  });
  it("uses its own default when Claude Code has no database", () => {
    process.env["CLAUDE_CONFIG_DIR"] = root;
    expect(sharedDbPath(join(root, "own", "openltm.db"))).toBe(join(root, "own", "openltm.db"));
  });
});

describe("fallbackDbPath (where getDbPath lands without env vars)", () => {
  it("a monorepo checkout keeps its dev database at <root>/data", async () => {
    const { fallbackDbPath } = await import("../paths.js");
    process.env["CLAUDE_CONFIG_DIR"] = join(root, "claude");
    mkdirSync(join(root, "repo", "packages", "openltm-core"), { recursive: true });
    expect(fallbackDbPath(join(root, "repo"))).toBe(join(root, "repo", "data", "openltm.db"));
  });
  it("a published install (bunx cache, node_modules) uses the plugin data dir, not node_modules/data", async () => {
    const { fallbackDbPath } = await import("../paths.js");
    process.env["CLAUDE_CONFIG_DIR"] = join(root, "claude");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    expect(fallbackDbPath(join(root, "node_modules"))).toBe(join(root, "claude", "plugins", "data", "openltm-OpenLtm", "openltm.db"));
  });
  it("a published install keeps a database that already exists under node_modules/data", async () => {
    const { fallbackDbPath } = await import("../paths.js");
    process.env["CLAUDE_CONFIG_DIR"] = join(root, "claude");
    mkdirSync(join(root, "node_modules", "data"), { recursive: true });
    writeFileSync(join(root, "node_modules", "data", "openltm.db"), "");
    expect(fallbackDbPath(join(root, "node_modules"))).toBe(join(root, "node_modules", "data", "openltm.db"));
  });
});
