/**
 * events/index.ts — Honker pub/sub for graph-app liveness.
 *
 * Long-lived processes (the graph server) call `startLtmListener()` once; the
 * loop drains `listen("ltm")` and hands each notification payload to the
 * supplied callback (which drives the existing WebSocket `broadcast()`). Any
 * writer — hooks, the janitor, the worker — calls `notifyLtm()` after a commit
 * to push a liveness event to every connected listener with no polling.
 *
 * Dormant + inert when Honker is unavailable: `notifyLtm()` returns false and
 * `startLtmListener()` returns a non-running handle, so the caller keeps its
 * existing fs.watch + 3s-debounce file-watcher fallback.
 */
import { getHonker } from "../lib/honker.js";
import type { HonkerTransaction } from "../lib/honkerTypes.js";
import { getSetting } from "../shared-db.js";
import { SETTING_KEYS } from "../janitor/providers/types.js";

export const LTM_CHANNEL = "ltm";

/** Liveness event `type` for a memory created in another agent process. */
export const MEMORY_ADDED = "memory_added";

/** A liveness event pushed to graph-app — `type` mirrors the WS message kind. */
export interface LtmLiveEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface LtmListenerHandle {
  /** Whether the listen loop is running (false without Honker). */
  readonly running: boolean;
  /** Stop the loop and wait for it to settle. */
  stop(): Promise<void>;
}

const INERT: LtmListenerHandle = { running: false, stop: async () => {} };

/**
 * Push a liveness event on the "ltm" channel. Returns false when Honker is
 * unavailable (caller's file-watcher fallback still fires). Best-effort: a
 * notify failure never throws.
 */
export function notifyLtm(event: LtmLiveEvent, opts?: { tx?: HonkerTransaction }): boolean {
  const h = getHonker();
  if (!h) return false;
  try {
    h.notify(LTM_CHANNEL, event, opts?.tx ? { tx: opts.tx } : undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the "ltm" channel listen loop. Each notification's payload is passed to
 * `onEvent`. No-op (inert handle) when Honker is unavailable.
 */
export function startLtmListener(
  onEvent: (event: LtmLiveEvent) => void,
  opts?: { pollMs?: number },
): LtmListenerHandle {
  const h = getHonker();
  if (!h) return INERT;

  const controller = new AbortController();
  const loop = (async () => {
    const listenOpts = { signal: controller.signal, ...(opts?.pollMs != null ? { pollMs: opts.pollMs } : {}) };
    for await (const note of h.listen(LTM_CHANNEL, listenOpts)) {
      if (controller.signal.aborted) return;
      const payload = note.payload;
      if (payload && typeof payload === "object" && "type" in payload) {
        try { onEvent(payload as LtmLiveEvent); } catch { /* dispatch best-effort */ }
      }
    }
  })();
  loop.catch(() => {});

  return {
    running: true,
    stop: async () => {
      controller.abort();
      await loop.catch(() => {});
    },
  };
}

/**
 * Whether opt-in cross-process memory sync is enabled (setting
 * `ltm.crossProcessSync`, default "off"). Cross-process push additionally
 * requires a live Honker handle — this only reports the user's intent.
 */
export function isCrossProcessSyncEnabled(): boolean {
  return getSetting(SETTING_KEYS.CROSS_PROCESS_SYNC) === "on";
}

/**
 * Push a `memory_added` event so sibling agent processes (Claude Code,
 * OpenCode, Pi) sharing one openltm.db can react to a memory created elsewhere.
 * No-op unless the `ltm.crossProcessSync` flag is on AND Honker is available.
 * Returns true only when the notify was actually sent.
 */
export function notifyMemoryAdded(
  memory: { id: number; project_scope?: string | null },
  opts?: { tx?: HonkerTransaction },
): boolean {
  if (!isCrossProcessSyncEnabled()) return false;
  return notifyLtm(
    { type: MEMORY_ADDED, id: memory.id, project_scope: memory.project_scope ?? null, pid: process.pid },
    opts,
  );
}

/**
 * Adapter-facing listener: invoke `onMemoryAdded` for each `memory_added` event
 * raised by another process (ignores this process's own events by pid). Inert
 * (non-running handle) unless the flag is on AND Honker is available, so an
 * adapter can call this unconditionally and degrade to a no-op.
 */
export function startCrossProcessSync(
  onMemoryAdded: (event: LtmLiveEvent) => void,
  opts?: { pollMs?: number },
): LtmListenerHandle {
  if (!isCrossProcessSyncEnabled()) return INERT;
  return startLtmListener(event => {
    if (event.type !== MEMORY_ADDED) return;
    if (event["pid"] === process.pid) return; // drop our own echo
    onMemoryAdded(event);
  }, opts);
}
