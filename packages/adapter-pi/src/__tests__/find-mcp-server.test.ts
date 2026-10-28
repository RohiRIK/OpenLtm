/**
 * find-mcp-server.test.ts — Pi shares the database of the Claude Code plugin.
 *
 * Claude Code keeps an installed plugin's data in plugins/data/<plugin>-<marketplace>
 * (measured: openltm@OpenLtm → openltm-OpenLtm). Pi must open that database, not a
 * second one under the name OpenLTM ≤ 2.16 assumed (OpenLtm-openltm).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMcpServer } from "../index.js";

// On a case-insensitive FS (APFS default) OpenLtm-openltm and openltm-OpenLtm are one dir.
const caseInsensitiveFs = existsSync(tmpdir().toUpperCase());

let home: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ["HOME", "LTM_DB_PATH", "CLAUDE_CONFIG_DIR", "CLAUDE_PLUGIN_DATA"];

function plugin(version: string): void {
  const src = join(home, ".claude", "plugins", "cache", "OpenLtm", "openltm", version, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "mcp-server.ts"), "");
}
function db(dirName: string): string {
  const dir = join(home, ".claude", "plugins", "data", dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "openltm.db"), "");
  return join(dir, "openltm.db");
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  home = mkdtempSync(join(tmpdir(), "pi-find-mcp-"));
  process.env["HOME"] = home;
});
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  rmSync(home, { recursive: true, force: true });
});

describe("Pi finds the Claude Code plugin's MCP server and database", () => {
  it("opens the database in openltm-OpenLtm, where Claude Code keeps it", () => {
    plugin("2.17.0");
    const real = db("openltm-OpenLtm");
    const found = findMcpServer();
    expect(found?.script).toBe(join(home, ".claude", "plugins", "cache", "OpenLtm", "openltm", "2.17.0", "src", "mcp-server.ts"));
    expect(found?.dbPath).toBe(real);
  });

  it.skipIf(caseInsensitiveFs)("keeps using a database under the older OpenLtm-openltm name when that is the one that exists", () => {
    plugin("2.17.0");
    const legacy = db("OpenLtm-openltm");
    expect(findMcpServer()?.dbPath).toBe(legacy);
  });

  it("prefers openltm-OpenLtm when both exist", () => {
    plugin("2.17.0");
    db("OpenLtm-openltm");
    const real = db("openltm-OpenLtm");
    expect(findMcpServer()?.dbPath).toBe(real);
  });

  it("an explicit LTM_DB_PATH still wins", () => {
    plugin("2.17.0");
    db("openltm-OpenLtm");
    process.env["LTM_DB_PATH"] = join(home, "explicit.db");
    expect(findMcpServer()?.dbPath).toBe(join(home, "explicit.db"));
  });
});
