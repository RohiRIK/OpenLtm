/**
 * Integration test for /ltm:health activity aggregation.
 * Seeds a temp hooks.log with known event entries and verifies
 * the aggregation script produces the correct counts.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP_DIR = join(tmpdir(), `ltm-health-test-${Date.now()}`);
const LOG_FILE = join(TMP_DIR, "hooks.log");

function makeEntry(event: string, hoursAgo: number, project = "test-proj"): string {
  const ts = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return JSON.stringify({ ts, hook: "TestHook", level: "event", msg: event, event, project });
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  const lines = [
    makeEntry("session.start",     1),
    makeEntry("session.start",     2),
    makeEntry("session.evaluated", 1),
    makeEntry("context.updated",   3),
    makeEntry("context.updated",   5),
    makeEntry("context.updated",   6),
    makeEntry("recall.hit",        0.5),
    // older than 24h — must NOT be counted
    makeEntry("session.start",    25),
    makeEntry("learn.write",      26),
    // non-event line — must be skipped
    JSON.stringify({ ts: new Date().toISOString(), hook: "X", level: "info", msg: "ignored" }),
  ];
  writeFileSync(LOG_FILE, lines.join("\n") + "\n");
});

afterAll(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

async function runAggregation(): Promise<string> {
  const script = `
    import { readFileSync, existsSync } from 'fs';
    const LOG = ${JSON.stringify(LOG_FILE)};
    if (!existsSync(LOG)) { console.log('no log'); process.exit(0); }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const counts = {};
    readFileSync(LOG, 'utf-8').trim().split('\\n').forEach(line => {
      try {
        const e = JSON.parse(line);
        if (e.level !== 'event' || !e.event) return;
        if (new Date(e.ts).getTime() < cutoff) return;
        counts[e.event] = (counts[e.event] ?? 0) + 1;
      } catch {}
    });
    console.log(JSON.stringify(counts));
  `;
  const proc = Bun.spawn(["bun", "--eval", script], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

describe("/ltm:health activity aggregation", () => {
  it("counts events within the 24h window", async () => {
    const raw = await runAggregation();
    const counts = JSON.parse(raw) as Record<string, number>;

    expect(counts["session.start"]).toBe(2);      // 2 within 24h (1 older excluded)
    expect(counts["session.evaluated"]).toBe(1);
    expect(counts["context.updated"]).toBe(3);
    expect(counts["recall.hit"]).toBe(1);
  }, 15_000);

  it("excludes entries older than 24h", async () => {
    const raw = await runAggregation();
    const counts = JSON.parse(raw) as Record<string, number>;

    // learn.write was 26h ago — must not appear
    expect(counts["learn.write"]).toBeUndefined();
  }, 15_000);

  it("skips non-event log lines", async () => {
    const raw = await runAggregation();
    // Should parse without throwing; 'ignored' msg is level=info, not counted
    expect(() => JSON.parse(raw)).not.toThrow();
  }, 15_000);
});
