/**
 * queue/index.ts — Honker durable queue for embedding generation.
 *
 * Replaces the fire-and-forget embedMemory() call with a durable job: learn()
 * enqueues { memoryId }, a long-lived worker (queue/worker.ts) claims, embeds,
 * and acks with retry/backoff + dead-letter. Every export degrades to a no-op
 * (null / false) when Honker is unavailable; callers keep the inline path.
 */
import type { HonkerEnqueueOptions, HonkerQueue, HonkerTransaction } from "../lib/honkerTypes.js";
import { getHonker } from "../lib/honker.js";

/** Durable queue name for embedding jobs. */
export const EMBED_QUEUE = "ltm-embeddings";

/** Retries before a job is dead-lettered (honker_retry moves to dead at maxAttempts). */
export const EMBED_MAX_ATTEMPTS = 5;

/** Payload shape for an embedding job. */
export interface EmbeddingJob {
  memoryId: number;
}

/** The embedding Queue handle, or null when Honker is unavailable. */
export function getEmbeddingQueue(): HonkerQueue | null {
  const h = getHonker();
  return h ? h.queue(EMBED_QUEUE, { maxAttempts: EMBED_MAX_ATTEMPTS }) : null;
}

/**
 * Enqueue an embedding job for a memory. Returns the job id, or null when the
 * queue is unavailable (caller should embed inline instead). Pass `tx` to make
 * the enqueue atomic with the memory INSERT — the job only becomes visible on
 * commit and is dropped on rollback.
 */
export function enqueueEmbedding(memoryId: number, opts?: { tx?: HonkerTransaction }): number | null {
  const q = getEmbeddingQueue();
  if (!q) return null;
  try {
    const enqOpts: HonkerEnqueueOptions = opts?.tx ? { tx: opts.tx } : {};
    return q.enqueue({ memoryId } satisfies EmbeddingJob, enqOpts);
  } catch {
    return null;
  }
}

/** Narrow an unknown job payload to an EmbeddingJob, or null if malformed. */
export function parseEmbeddingJob(payload: unknown): EmbeddingJob | null {
  if (payload && typeof payload === "object" && "memoryId" in payload) {
    const id = (payload as { memoryId: unknown }).memoryId;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) return { memoryId: id };
  }
  return null;
}
