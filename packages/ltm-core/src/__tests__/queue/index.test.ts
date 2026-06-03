/**
 * queue/index.test.ts — dormant-path contract for the Honker embedding queue.
 *
 * Honker requires an externally-built libhonker_ext binary (LTM_HONKER_EXT)
 * that is absent in CI, so every queue/worker export must degrade to a graceful
 * no-op without throwing. The live claim/ack/retry path is exercised only where
 * the binary is present.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  getEmbeddingQueue,
  enqueueEmbedding,
  parseEmbeddingJob,
  EMBED_QUEUE,
} from "../../queue/index.js";
import { startEmbeddingWorker } from "../../queue/worker.js";
import { isHonkerAvailable, _resetHonkerForTesting } from "../../lib/honker.js";

describe("queue — dormant path (no honker)", () => {
  beforeEach(() => {
    _resetHonkerForTesting();
  });

  it("EMBED_QUEUE has a stable name", () => {
    expect(EMBED_QUEUE).toBe("ltm-embeddings");
  });

  it("honker is unavailable without LTM_HONKER_EXT", () => {
    delete process.env["LTM_HONKER_EXT"];
    expect(isHonkerAvailable()).toBe(false);
  });

  it("getEmbeddingQueue returns null when honker is unavailable", () => {
    expect(getEmbeddingQueue()).toBeNull();
  });

  it("enqueueEmbedding returns null (caller falls back to inline) when unavailable", () => {
    expect(enqueueEmbedding(123)).toBeNull();
  });

  it("startEmbeddingWorker returns an inert handle when unavailable", async () => {
    const w = startEmbeddingWorker();
    expect(w.running).toBe(false);
    await expect(w.stop()).resolves.toBeUndefined();
  });
});

describe("parseEmbeddingJob", () => {
  it("accepts a valid positive-integer memoryId", () => {
    expect(parseEmbeddingJob({ memoryId: 42 })).toEqual({ memoryId: 42 });
  });

  it("rejects malformed payloads", () => {
    expect(parseEmbeddingJob(null)).toBeNull();
    expect(parseEmbeddingJob({})).toBeNull();
    expect(parseEmbeddingJob({ memoryId: "5" })).toBeNull();
    expect(parseEmbeddingJob({ memoryId: 0 })).toBeNull();
    expect(parseEmbeddingJob({ memoryId: -3 })).toBeNull();
    expect(parseEmbeddingJob({ memoryId: 1.5 })).toBeNull();
  });
});
