/**
 * writeQueue.ts — Serialises all DB writes through a promise-chain queue.
 * Prevents concurrent write corruption (W12).
 */
import type { Database } from "bun:sqlite";

export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => T | Promise<T>, db?: Database): Promise<T> {
    const next = this.tail.then(async () => {
      if (!db) return fn();
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await Promise.resolve(fn());
        db.exec("COMMIT");
        return result;
      } catch (err) {
        try { db.exec("ROLLBACK"); } catch {}
        throw err;
      }
    });
    this.tail = next.catch(() => {}); // prevent unhandled rejection on queue
    return next as Promise<T>;
  }
}

export const writeQueue = new WriteQueue();
