/**
 * scheduler/index.ts — Honker leader-elected cron for the janitor.
 *
 * Registers the janitor as a recurring Honker schedule and runs two loops in
 * the long-lived process: (1) the built-in leader-elected scheduler loop (only
 * ONE of the agent processes ticks, via Honker's advisory lock), which enqueues
 * a `janitor-run` job on each boundary; (2) a worker that claims those jobs,
 * runs the janitor, and `notify()`s the result on the "janitor" channel.
 *
 * Dormant + inert when Honker is unavailable — the caller keeps the existing
 * `startAutoRun()` interval + `POST /api/janitor/run` fallback.
 */
import { getHonker } from "../lib/honker.js";

export const JANITOR_SCHEDULE_NAME = "ltm-janitor";
export const JANITOR_QUEUE = "ltm-janitor-queue";
export const JANITOR_CHANNEL = "janitor";
export const DEFAULT_JANITOR_CRON = "@every 6h";

export interface JanitorSchedulerHandle {
  /** Whether the leader loop + worker are running (false without Honker). */
  readonly running: boolean;
  /** Stop both loops and wait for them to settle. */
  stop(): Promise<void>;
}

const INERT: JanitorSchedulerHandle = { running: false, stop: async () => {} };

/**
 * Register the janitor schedule (idempotent by name). Returns false when Honker
 * is unavailable.
 */
export function registerJanitorSchedule(cron: string = DEFAULT_JANITOR_CRON): boolean {
  const h = getHonker();
  if (!h) return false;
  try {
    h.scheduler().add({
      name: JANITOR_SCHEDULE_NAME,
      queue: JANITOR_QUEUE,
      schedule: cron,
      payload: { kind: "janitor-run" },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the leader-elected janitor scheduler + its run worker. No-op (inert
 * handle) when Honker is unavailable.
 */
export function startJanitorScheduler(opts?: { cron?: string; owner?: string }): JanitorSchedulerHandle {
  const h = getHonker();
  if (!h) return INERT;
  if (!registerJanitorSchedule(opts?.cron)) return INERT;

  const owner = opts?.owner ?? `ltm-sched-${process.pid}`;
  const controller = new AbortController();
  const scheduler = h.scheduler();
  const queue = h.queue(JANITOR_QUEUE, { maxAttempts: 3 });
  const waker = queue.claimWaker();

  // Loop 1 — leader-elected ticking (enqueues janitor-run jobs on boundaries).
  const leader = scheduler.run({ owner, signal: controller.signal }).catch(() => {});

  // Loop 2 — claim janitor-run jobs, run the janitor, notify the result.
  const worker = (async () => {
    const { runJanitor } = await import("../janitor/index.js");
    try {
      while (!controller.signal.aborted) {
        const job = await waker.next(owner, { signal: controller.signal });
        if (!job) return;
        try {
          const status = await runJanitor();
          job.ack();
          try { h.notify(JANITOR_CHANNEL, { type: "janitor-complete", status }); } catch { /* notify best-effort */ }
        } catch (err) {
          if (controller.signal.aborted) return;
          const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
          job.retry(30, msg);
        }
      }
    } finally {
      waker.close();
    }
  })();
  worker.catch(() => {});

  return {
    running: true,
    stop: async () => {
      controller.abort();
      await Promise.allSettled([leader, worker]);
    },
  };
}
