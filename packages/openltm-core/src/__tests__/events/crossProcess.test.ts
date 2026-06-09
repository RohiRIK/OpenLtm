/**
 * crossProcess.test.ts — opt-in cross-agent sync contract (Phase 8 X1).
 * The flag `ltm.crossProcessSync` defaults off; even when on, cross-process
 * push requires Honker, so without an ext binary every entry point is a no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { _setDbForTesting } from "../../shared-db.js";
import { SETTING_KEYS, SETTING_DEFAULTS } from "../../janitor/providers/types.js";
import {
  isCrossProcessSyncEnabled,
  notifyMemoryAdded,
  startCrossProcessSync,
  MEMORY_ADDED,
} from "../../events/index.js";
import { _resetHonkerForTesting } from "../../lib/honker.js";
import { resetCapabilitiesForTesting } from "../../extensions.js";

function seedDb(): Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`);
  return db;
}

describe("cross-process sync — flag + dormant contract (no honker)", () => {
  beforeEach(() => {
    _resetHonkerForTesting();
    delete process.env["LTM_HONKER_EXT"];
    // Reset cached caps so a prior test's honker=true (vendored binary is
    // discoverable here) does not leak in — keeps this the dormant contract.
    resetCapabilitiesForTesting();
  });
  afterEach(() => {
    _resetHonkerForTesting();
  });

  it("defaults off (setting default is \"off\")", () => {
    expect(SETTING_DEFAULTS[SETTING_KEYS.CROSS_PROCESS_SYNC]).toBe("off");
  });

  it("exposes the stable memory_added event type", () => {
    expect(MEMORY_ADDED).toBe("memory_added");
  });

  it("isCrossProcessSyncEnabled is false when unset", () => {
    _setDbForTesting(seedDb());
    expect(isCrossProcessSyncEnabled()).toBe(false);
  });

  it("isCrossProcessSyncEnabled is true only when the setting is \"on\"", () => {
    const db = seedDb();
    db.run("INSERT INTO settings(key,value) VALUES (?, 'on')", [SETTING_KEYS.CROSS_PROCESS_SYNC]);
    _setDbForTesting(db);
    expect(isCrossProcessSyncEnabled()).toBe(true);
  });

  it("notifyMemoryAdded returns false when the flag is off", () => {
    _setDbForTesting(seedDb());
    expect(notifyMemoryAdded({ id: 1 })).toBe(false);
  });

  it("notifyMemoryAdded returns false when flag on but honker unavailable", () => {
    const db = seedDb();
    db.run("INSERT INTO settings(key,value) VALUES (?, 'on')", [SETTING_KEYS.CROSS_PROCESS_SYNC]);
    _setDbForTesting(db);
    expect(notifyMemoryAdded({ id: 1, project_scope: "demo" })).toBe(false);
  });

  it("startCrossProcessSync is inert when flag off, never firing the callback", async () => {
    _setDbForTesting(seedDb());
    let calls = 0;
    const h = startCrossProcessSync(() => { calls++; });
    expect(h.running).toBe(false);
    await expect(h.stop()).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  it("startCrossProcessSync is inert when flag on but honker unavailable", async () => {
    const db = seedDb();
    db.run("INSERT INTO settings(key,value) VALUES (?, 'on')", [SETTING_KEYS.CROSS_PROCESS_SYNC]);
    _setDbForTesting(db);
    const h = startCrossProcessSync(() => {});
    expect(h.running).toBe(false);
    await expect(h.stop()).resolves.toBeUndefined();
  });
});
