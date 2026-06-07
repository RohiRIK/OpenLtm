/**
 * queue/worker.ts — long-lived embedding worker.
 *
 * Claims { memoryId } jobs from the Honker embedding queue, generates the
 * embedding via embedMemory() (which writes memory_embeddings + the vec0 index),
 * and acks. Provider/transient errors retry with exponential backoff; Honker
 * dead-letters once attempts exceed the queue's maxAttempts. Malformed payloads
 * are failed immediately (no retry).
 *
 * Lifecycle: start ONCE in the long-lived process (graph-server). Short-lived
 * hook processes only enqueue — they must never start a worker. Returns an inert
 * handle when Honker is unavailable.
 */
import { getEmbeddingQueue, parseEmbeddingJob } from "./index.js";

export interface EmbeddingWorkerHandle {
  /** Whether a live worker loop is running (false when Honker is unavailable). */
  readonly running: boolean;
  /** Stop the loop and wait for the current iteration to settle. */
  stop(): Promise<void>;
}

const INERT: EmbeddingWorkerHandle = { running: false, stop: async () => {} };

const BASE_BACKOFF_S = 5;
function backoffSeconds(attempts: number): number {
  return Math.ceil(BASE_BACKOFF_S * 2 ** Math.max(0, attempts - 1));
}

/**
 * Start the embedding worker. No-op (inert handle) when Honker is unavailable.
 */
export function startEmbeddingWorker(opts?: { workerId?: string }): EmbeddingWorkerHandle {
  const queue = getEmbeddingQueue();
  if (!queue) return INERT;

  const workerId = opts?.workerId ?? `ltm-embed-${process.pid}`;
  const controller = new AbortController();
  const waker = queue.claimWaker();

  const loop = (async () => {
    const { embedMemory } = await import("../embeddings.js");
    const { getDb } = await import("../shared-db.js");
    const db = getDb();
    try {
      while (!controller.signal.aborted) {
        const job = await waker.next(workerId, { signal: controller.signal });
        if (!job) return; // aborted
        const parsed = parseEmbeddingJob(job.payload);
        if (!parsed) {
          job.fail("invalid embedding job payload");
          continue;
        }
        try {
          await embedMemory(db, parsed.memoryId);
          job.ack();
        } catch (err) {
          if (controller.signal.aborted) return;
          const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
          job.retry(backoffSeconds(job.attempts), msg);
        }
      }
    } finally {
      waker.close();
    }
  })();
  // Prevent unhandled rejection if the loop throws on teardown.
  loop.catch(() => {});

  return {
    running: true,
    stop: async () => {
      controller.abort();
      try { await loop; } catch { /* settled */ }
    },
  };
}
