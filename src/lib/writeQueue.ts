/**
 * writeQueue.ts — Serialises all DB writes through a promise-chain queue.
 * Prevents concurrent write corruption (W12).
 */

export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.catch(() => {}); // prevent unhandled rejection on queue
    return next as Promise<T>;
  }
}

export const writeQueue = new WriteQueue();
