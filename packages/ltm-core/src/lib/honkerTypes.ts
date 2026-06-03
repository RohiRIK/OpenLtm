/**
 * honkerTypes.ts — minimal structural types for the Honker runtime surface we
 * use. We deliberately do NOT `import` from @russellthehippo/honker-bun: it
 * ships raw .ts with internal type errors that tsc would compile (skipLibCheck
 * only skips .d.ts), and it is an OPTIONAL dependency that may be absent in
 * consumer installs. These local types keep the build self-contained and let
 * every Honker call site stay strongly typed against the verified API.
 */

export interface HonkerEnqueueOptions {
  delay?: number;
  runAt?: number;
  priority?: number;
  expires?: number;
  tx?: HonkerTransaction;
}

export interface HonkerQueueOptions {
  visibilityTimeoutS?: number;
  maxAttempts?: number;
}

export interface HonkerJob {
  readonly id: number;
  readonly queue: string;
  readonly payload: unknown;
  readonly workerId: string;
  readonly attempts: number;
  ack(): boolean;
  retry(delaySec: number, errorMsg: string): boolean;
  fail(errorMsg: string): boolean;
  heartbeat(extendSec: number): boolean;
}

export interface HonkerClaimWaker {
  tryNext(workerId: string): HonkerJob | null;
  next(workerId: string, opts?: { signal?: AbortSignal }): Promise<HonkerJob | null>;
  close(): void;
}

export interface HonkerQueue {
  readonly name: string;
  enqueue(payload: unknown, opts?: HonkerEnqueueOptions): number;
  claimBatch(workerId: string, n: number): HonkerJob[];
  claimOne(workerId: string): HonkerJob | null;
  ackBatch(ids: number[], workerId: string): number;
  sweepExpired(): number;
  nextClaimAt(): number | null;
  claimWaker(opts?: { idlePollS?: number | null; pollMs?: number | null }): HonkerClaimWaker;
}

export interface HonkerTransaction {
  readonly raw: unknown;
  commit(): void;
  rollback(): void;
}

export interface HonkerScheduledTask {
  name: string;
  queue: string;
  schedule?: string;
  cron?: string;
  payload: unknown;
  priority?: number;
  expiresS?: number | null;
}

export interface HonkerScheduledFire {
  name: string;
  queue: string;
  fire_at: number;
  job_id: number;
}

export interface HonkerScheduler {
  add(task: HonkerScheduledTask): void;
  remove(name: string): number;
  tick(): HonkerScheduledFire[];
  soonest(): number;
  /** Leader-elected blocking loop — only the lock holder ticks. */
  run(opts: { owner: string; signal: AbortSignal }): Promise<void>;
}

export interface HonkerNotification {
  id: number;
  channel: string;
  payload: unknown;
}

export interface HonkerDb {
  readonly raw: unknown;
  queue(name: string, opts?: HonkerQueueOptions): HonkerQueue;
  scheduler(): HonkerScheduler;
  notify(channel: string, payload: unknown, opts?: { tx?: HonkerTransaction }): number;
  listen(
    channel: string,
    opts?: { signal?: AbortSignal; pollMs?: number },
  ): AsyncIterableIterator<HonkerNotification>;
  transaction(): HonkerTransaction;
  close(): void;
}

export interface HonkerModule {
  open(
    path: string,
    extensionPath: string,
    opts?: { sqliteLibPath?: string; watcherBackend?: string | null },
  ): HonkerDb;
}
