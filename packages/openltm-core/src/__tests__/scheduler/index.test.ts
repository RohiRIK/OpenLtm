/**
 * scheduler/index.test.ts — dormant-path contract for the Honker janitor cron.
 * Without an external libhonker_ext binary, registration and the leader loop
 * must degrade to graceful no-ops so the caller keeps startAutoRun()+HTTP poll.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  registerJanitorSchedule,
  startJanitorScheduler,
  JANITOR_SCHEDULE_NAME,
  JANITOR_QUEUE,
  JANITOR_CHANNEL,
  DEFAULT_JANITOR_CRON,
} from "../../scheduler/index.js";
import { _resetHonkerForTesting } from "../../lib/honker.js";
import { resetCapabilitiesForTesting } from "../../extensions.js";

describe("scheduler — dormant path (no honker)", () => {
  beforeEach(() => {
    _resetHonkerForTesting();
    delete process.env["LTM_HONKER_EXT"];
    // Reset cached caps so a prior test's honker=true (vendored binary is
    // discoverable here) does not leak in — keeps this the dormant contract.
    resetCapabilitiesForTesting();
  });

  it("exposes stable names + default cron", () => {
    expect(JANITOR_SCHEDULE_NAME).toBe("ltm-janitor");
    expect(JANITOR_QUEUE).toBe("ltm-janitor-queue");
    expect(JANITOR_CHANNEL).toBe("janitor");
    expect(DEFAULT_JANITOR_CRON).toBe("@every 6h");
  });

  it("registerJanitorSchedule returns false when honker is unavailable", () => {
    expect(registerJanitorSchedule()).toBe(false);
  });

  it("startJanitorScheduler returns an inert handle when unavailable", async () => {
    const s = startJanitorScheduler();
    expect(s.running).toBe(false);
    await expect(s.stop()).resolves.toBeUndefined();
  });
});
