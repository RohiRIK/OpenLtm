import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDbPath } from "../paths.js";

describe("getDbPath priority chain", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      LTM_DB_PATH: process.env.LTM_DB_PATH,
      CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("LTM_DB_PATH env var takes priority over all", () => {
    process.env.LTM_DB_PATH = "/tmp/test-override.db";
    delete process.env.CLAUDE_PLUGIN_DATA;
    expect(getDbPath()).toBe("/tmp/test-override.db");
  });

  it("falls back to CLAUDE_PLUGIN_DATA/openltm.db when set", () => {
    delete process.env.LTM_DB_PATH;
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/fake-plugin-data";
    expect(getDbPath({ skipAutoMigrate: true })).toBe("/tmp/fake-plugin-data/openltm.db");
  });

  it("uses configOverride.dbPath when no env vars set", () => {
    delete process.env.LTM_DB_PATH;
    delete process.env.CLAUDE_PLUGIN_DATA;
    expect(getDbPath({ dbPath: "/tmp/from-config.db" })).toBe("/tmp/from-config.db");
  });

  it("uses configOverride.dbPath when all env vars absent", () => {
    delete process.env.LTM_DB_PATH;
    delete process.env.CLAUDE_PLUGIN_DATA;
    const result = getDbPath({ dbPath: "/tmp/explicit-override.db" });
    expect(result).toBe("/tmp/explicit-override.db");
  });

  it("LTM_DB_PATH beats configOverride.dbPath", () => {
    process.env.LTM_DB_PATH = "/tmp/env-wins.db";
    delete process.env.CLAUDE_PLUGIN_DATA;
    expect(getDbPath({ dbPath: "/tmp/from-config.db" })).toBe("/tmp/env-wins.db");
  });
});
