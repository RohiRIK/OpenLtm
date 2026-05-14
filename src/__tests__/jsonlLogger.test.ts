import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), `ltm-jsonl-test-${process.pid}`);

// Set env before importing so getLogPath() uses our dir
process.env.CLAUDE_PLUGIN_DATA = TEST_DIR;

const { emitEvent, readRecentEvents, getLogPath, _resetForTesting } =
  await import("@rohirik/ltm-core");

function logPath() {
  _resetForTesting();
  return getLogPath();
}

beforeEach(() => {
  _resetForTesting();
  mkdirSync(join(TEST_DIR, "logs"), { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe("getLogPath", () => {
  it("uses CLAUDE_PLUGIN_DATA/logs/ltm.jsonl", () => {
    const p = logPath();
    expect(p).toContain("ltm.jsonl");
    expect(p).toContain(TEST_DIR);
  });
});

describe("emitEvent", () => {
  it("writes a JSONL line", () => {
    _resetForTesting();
    emitEvent({ hook: "SessionStart", event: "session.start", project: "myproj", ts: new Date().toISOString() });
    const events = readRecentEvents(10);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const e = events.find(ev => ev.event === "session.start");
    expect(e).toBeDefined();
    expect(e!.hook).toBe("SessionStart");
    expect(e!.project).toBe("myproj");
  });

  it("never throws even when log dir is read-only", () => {
    // Point to a path that cannot be created
    process.env.CLAUDE_PLUGIN_DATA = "/proc/ltm-nonexistent-test";
    _resetForTesting();
    expect(() => emitEvent({ hook: "Test", event: "test.event", ts: new Date().toISOString() })).not.toThrow();
    // Restore
    process.env.CLAUDE_PLUGIN_DATA = TEST_DIR;
    _resetForTesting();
  });

  it("stores all LtmEvent fields", () => {
    _resetForTesting();
    const now = new Date().toISOString();
    emitEvent({ hook: "EvaluateSession", event: "session.evaluated", project: "p", count: 5, durationMs: 120, detail: "ok", ts: now });
    const events = readRecentEvents(10);
    const e = events.find(ev => ev.event === "session.evaluated");
    expect(e!.count).toBe(5);
    expect(e!.durationMs).toBe(120);
    expect(e!.detail).toBe("ok");
  });
});

describe("readRecentEvents", () => {
  it("returns empty array when log absent", () => {
    _resetForTesting();
    try { rmSync(join(TEST_DIR, "logs", "ltm.jsonl")); } catch {}
    expect(readRecentEvents(10)).toEqual([]);
  });

  it("respects limit — returns last N events", () => {
    _resetForTesting();
    for (let i = 0; i < 10; i++) {
      emitEvent({ hook: "H", event: `e${i}`, ts: new Date().toISOString() });
    }
    const events = readRecentEvents(3);
    expect(events.length).toBe(3);
    expect(events[2]!.event).toBe("e9");
  });

  it("skips malformed lines", () => {
    _resetForTesting();
    const lp = getLogPath();
    writeFileSync(lp, 'not-json\n{"hook":"H","event":"ok","ts":"2024-01-01T00:00:00Z"}\n', "utf-8");
    const events = readRecentEvents(10);
    expect(events.length).toBe(1);
    expect(events[0]!.event).toBe("ok");
  });
});

describe("rotation", () => {
  it("rotates when file exceeds 10MB, keeps ~7MB tail", () => {
    _resetForTesting();
    const lp = getLogPath();
    // Write 11MB of fake data
    const chunk = "x".repeat(1024); // 1 KB
    const lines: string[] = [];
    for (let i = 0; i < 11 * 1024; i++) lines.push(JSON.stringify({ hook: "H", event: `e${i}`, ts: "t", pad: chunk }));
    writeFileSync(lp, lines.join("\n") + "\n", "utf-8");

    // Force rotation by resetting the interval check
    _resetForTesting();
    emitEvent({ hook: "Trigger", event: "trigger", ts: new Date().toISOString() });

    const size = statSync(lp).size;
    expect(size).toBeLessThan(10 * 1024 * 1024);
  });
});
