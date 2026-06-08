import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  locateSystemSqlite,
  locateHonkerExt,
  ensureCustomSqlite,
  loadExtensions,
  getCapabilities,
  resetCapabilitiesForTesting,
} from "../extensions.js";

describe("extensions — capability probe", () => {
  beforeEach(() => {
    resetCapabilitiesForTesting();
  });

  it("locateSystemSqlite returns a string path or null, never throws", () => {
    const p = locateSystemSqlite();
    expect(p === null || typeof p === "string").toBe(true);
  });

  it("getCapabilities before any probe returns all-false without throwing", () => {
    const caps = getCapabilities();
    expect(caps).toEqual({ customSqlite: false, vec: false, honker: false });
  });

  it("loadExtensions never throws and returns a Capabilities shape", () => {
    ensureCustomSqlite();
    const db = new Database(":memory:");
    const caps = loadExtensions(db);
    expect(typeof caps.customSqlite).toBe("boolean");
    expect(typeof caps.vec).toBe("boolean");
    expect(typeof caps.honker).toBe("boolean");
  });

  it("honker is false when force-disabled via LTM_DISABLE_HONKER", () => {
    const prev = process.env["LTM_DISABLE_HONKER"];
    process.env["LTM_DISABLE_HONKER"] = "1";
    ensureCustomSqlite();
    const db = new Database(":memory:");
    const caps = loadExtensions(db);
    expect(caps.honker).toBe(false);
    if (prev === undefined) delete process.env["LTM_DISABLE_HONKER"];
    else process.env["LTM_DISABLE_HONKER"] = prev;
  });

  it("honker auto-loads when a vendored libhonker_ext binary is discoverable", () => {
    // Mirrors the vec test: activation needs customSqlite (process-global, only
    // before the first DB open) AND a discoverable binary. Skip when either is
    // unavailable — that is the graceful-degradation path, not a failure.
    if (locateHonkerExt() === null || process.env["LTM_DISABLE_HONKER"]) return;
    ensureCustomSqlite();
    const db = new Database(":memory:");
    const caps = loadExtensions(db);
    if (!caps.customSqlite) return;
    expect(caps.honker).toBe(true);
  });

  it("respects LTM_DISABLE_VEC — vec capability is false when force-disabled", () => {
    const prev = process.env["LTM_DISABLE_VEC"];
    process.env["LTM_DISABLE_VEC"] = "1";
    const db = new Database(":memory:");
    const caps = loadExtensions(db);
    expect(caps.vec).toBe(false);
    if (prev === undefined) delete process.env["LTM_DISABLE_VEC"];
    else process.env["LTM_DISABLE_VEC"] = prev;
  });

  it("when customSqlite is active, vec loads and vec0 KNN works end-to-end", () => {
    ensureCustomSqlite();
    const db = new Database(":memory:");
    const caps = loadExtensions(db);
    // setCustomSQLite is process-global and only takes effect before the first
    // Database opens. In a shared test process an earlier file may have already
    // opened a bundled-sqlite connection, leaving customSqlite false — that is
    // the graceful-degradation path, so skip the KNN assertion there.
    if (!caps.customSqlite || process.env["LTM_DISABLE_VEC"]) return;
    expect(caps.vec).toBe(true);
    db.run("create virtual table t using vec0(embedding float[4])");
    const q = new Uint8Array(new Float32Array([1, 2, 3, 4]).buffer);
    db.run("insert into t(rowid, embedding) values (1, ?)", [q]);
    const r = db
      .query("select rowid, distance from t where embedding match ? order by distance limit 1")
      .all(q) as Array<{ rowid: number; distance: number }>;
    expect(r[0]?.rowid).toBe(1);
    expect(r[0]?.distance).toBe(0);
  });

  it("getCapabilities returns the cached result after loadExtensions", () => {
    ensureCustomSqlite();
    const db = new Database(":memory:");
    const caps = loadExtensions(db);
    expect(getCapabilities()).toEqual(caps);
  });
});
