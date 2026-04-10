/**
 * janitor/index.ts — Janitor orchestrator.
 * Runs inside the server.ts process, sharing the DB instance.
 * Coordinates decay, promote, dedup, and embedding generation.
 */
import { getSetting } from "../shared-db.js";
import { runDecay, type DecayResult } from "./decay.js";
import { findDuplicates, saveDedupCandidates, type DedupResult } from "./dedup.js";
import { embedMissingMemories } from "./embeddings.js";
import { runPromote, type PromoteResult } from "./promote.js";
import { SETTING_KEYS, getDefault } from "./providers/types.js";

export interface JanitorStatus {
  /** Whether the janitor is currently running. */
  running: boolean;
  /** Last run timestamp (ISO string) or null if never run. */
  lastRun: string | null;
  /** Result of the last run. */
  lastResult: JanitorRunResult | null;
  /** Auto-run interval in minutes (0 = disabled). */
  intervalMinutes: number;
  /** Next scheduled run (ISO string) or null if auto-run disabled. */
  nextRun: string | null;
}

export interface JanitorRunResult {
  timestamp: string;
  /** Duration in milliseconds. */
  durationMs: number;
  embed: { embedded: number };
  decay: DecayResult;
  promote: PromoteResult;
  dedup: { pairsCompared: number; candidatesFound: number };
  errors: string[];
}

let _running = false;
let _lastRun: string | null = null;
let _lastResult: JanitorRunResult | null = null;
let _interval: ReturnType<typeof setInterval> | null = null;

/**
 * Run all janitor tasks in sequence:
 * 1. Embed missing memories (required for dedup)
 * 2. Decay stale memories
 * 3. Promote eligible context_items
 * 4. Find duplicates (no auto-merge without LLM verification)
 */
export async function runJanitor(): Promise<JanitorRunResult> {
  if (_running) {
    throw new Error("Janitor is already running");
  }

  _running = true;
  const startTime = Date.now();
  const errors: string[] = [];

  let embedCount = 0;
  let decayResult: DecayResult = { deprecated: 0, scanned: 0 };
  let promoteResult: PromoteResult = {
    promoted: 0,
    skipped: 0,
    scanned: 0,
  };
  let dedupResult: DedupResult = {
    pairsCompared: 0,
    candidates: [],
    autoMerged: 0,
  };

  try {
    // 1. Embed missing memories
    try {
      embedCount = await embedMissingMemories();
    } catch (e) {
      errors.push(`embed: ${String(e)}`);
    }

    // 2. Decay stale memories
    try {
      decayResult = runDecay();
    } catch (e) {
      errors.push(`decay: ${String(e)}`);
    }

    // 3. Promote context_items
    try {
      promoteResult = runPromote();
    } catch (e) {
      errors.push(`promote: ${String(e)}`);
    }

    // 4. Find duplicates and save as pending for review
    try {
      dedupResult = await findDuplicates(0.85, true);
      if (dedupResult.candidates.length > 0) {
        saveDedupCandidates(dedupResult.candidates);
      }
    } catch (e) {
      errors.push(`dedup: ${String(e)}`);
    }
  } finally {
    _running = false;
  }

  const result: JanitorRunResult = {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    embed: { embedded: embedCount },
    decay: decayResult,
    promote: promoteResult,
    dedup: {
      pairsCompared: dedupResult.pairsCompared,
      candidatesFound: dedupResult.candidates.length,
    },
    errors,
  };

  _lastRun = result.timestamp;
  _lastResult = result;

  return result;
}

/** Get current janitor status. */
export function getJanitorStatus(): JanitorStatus {
  const intervalMinutes = Number.parseInt(
    getSetting(SETTING_KEYS.JANITOR_INTERVAL_MINUTES) ||
      getDefault(SETTING_KEYS.JANITOR_INTERVAL_MINUTES),
    10,
  );

  let nextRun: string | null = null;
  if (intervalMinutes > 0 && _lastRun) {
    const lastRunTime = new Date(_lastRun).getTime();
    const nextRunTime = lastRunTime + intervalMinutes * 60 * 1000;
    nextRun = new Date(nextRunTime).toISOString();
  }

  return {
    running: _running,
    lastRun: _lastRun,
    lastResult: _lastResult,
    intervalMinutes,
    nextRun,
  };
}

/**
 * Start auto-run interval. Called by server.ts on startup if interval > 0.
 * Safe to call multiple times — clears any existing interval first.
 */
export function startAutoRun(): void {
  stopAutoRun();

  const intervalMinutes = Number.parseInt(
    getSetting(SETTING_KEYS.JANITOR_INTERVAL_MINUTES) ||
      getDefault(SETTING_KEYS.JANITOR_INTERVAL_MINUTES),
    10,
  );

  if (intervalMinutes <= 0) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  _interval = setInterval(async () => {
    try {
      await runJanitor();
    } catch {
      // Logged in result.errors — don't crash the interval
    }
  }, intervalMs);
}

/** Stop auto-run interval. */
export function stopAutoRun(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

// Re-export sub-modules for direct access from server routes
export { approveMemory, getPendingMemories, rejectMemory } from "./promote.js";
export { mergeMemories, parseDedupSource } from "./dedup.js";
export { supersede } from "./supersedes.js";
export { touchMemory } from "./decay.js";
export { getEmbeddingProvider, semanticSearch } from "./embeddings.js";
