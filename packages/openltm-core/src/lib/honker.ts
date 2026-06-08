/**
 * lib/honker.ts — process-wide lazy handle to the Honker runtime.
 *
 * Honker (durable queues, pub/sub, scheduler) is an OPTIONAL loadable SQLite
 * extension. honker-bun's `open()` manages its OWN connection + update watcher
 * over the same openltm.db file, so queue/events/scheduler share a single handle
 * created here. Everything degrades to null when:
 *   - the capability probe reports honker unavailable (getCapabilities().honker)
 *   - LTM_HONKER_EXT is unset / the binary is missing
 *   - the honker-bun package isn't installed, or open() throws
 *
 * NOTHING here throws — callers branch on a null handle and fall back to the
 * pre-Honker behaviour (inline embed, HTTP poll, file-watcher).
 */
import type { HonkerDb, HonkerModule } from "./honkerTypes.js";
import { getCapabilities, locateSystemSqlite, locateHonkerExt } from "../extensions.js";
import { DB_PATH } from "../shared-db.js";

let _handle: HonkerDb | null | undefined = undefined;

/**
 * Return the shared Honker handle, opening it once on first use. Returns null
 * (cached) whenever Honker is unavailable. Synchronous — honker-bun's open() is
 * synchronous and we require the package lazily so an absent install is a no-op.
 */
export function getHonker(): HonkerDb | null {
  if (_handle !== undefined) return _handle;
  _handle = openHonker();
  return _handle;
}

function openHonker(): HonkerDb | null {
  if (!getCapabilities().honker) return null;
  const ext = locateHonkerExt();
  if (!ext) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@russellthehippo/honker-bun") as HonkerModule;
    const lib = locateSystemSqlite();
    return mod.open(DB_PATH, ext, lib ? { sqliteLibPath: lib } : {});
  } catch {
    return null;
  }
}

/** True when a live Honker handle is available. */
export function isHonkerAvailable(): boolean {
  return getHonker() !== null;
}

/** Test-only: drop the cached handle (does not close it). */
export function _resetHonkerForTesting(): void {
  _handle = undefined;
}
