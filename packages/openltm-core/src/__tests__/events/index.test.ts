/**
 * events/index.test.ts — dormant-path contract for the graph-app liveness bus.
 * Without an external libhonker_ext binary, notify must report false and the
 * listener must return an inert handle so the caller keeps its fs.watch +
 * 3s-debounce file-watcher fallback.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { notifyLtm, startLtmListener, LTM_CHANNEL } from "../../events/index.js";
import { _resetHonkerForTesting } from "../../lib/honker.js";

describe("events — dormant path (no honker)", () => {
  beforeEach(() => {
    _resetHonkerForTesting();
    delete process.env["LTM_HONKER_EXT"];
  });

  it("exposes the stable channel name", () => {
    expect(LTM_CHANNEL).toBe("ltm");
  });

  it("notifyLtm returns false when honker is unavailable", () => {
    expect(notifyLtm({ type: "refresh" })).toBe(false);
  });

  it("startLtmListener returns an inert handle and never invokes the callback", async () => {
    let calls = 0;
    const h = startLtmListener(() => { calls++; });
    expect(h.running).toBe(false);
    await expect(h.stop()).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });
});
