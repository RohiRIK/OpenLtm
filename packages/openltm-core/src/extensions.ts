/**
 * extensions.ts — Loadable SQLite extension capability probe + activation.
 *
 * Bun's bundled SQLite is compiled WITHOUT dynamic extension loading, so
 * db.loadExtension() throws "does not support dynamic extension loading".
 * We switch the process to a system extension-enabled libsqlite3 via
 * Database.setCustomSQLite() (a process-global static that MUST run before the
 * first Database is opened), then loadExtension() per-connection.
 *
 * Everything degrades gracefully: any failure (no system sqlite, missing
 * binary, force-disabled via env) leaves the capability false and callers
 * fall back to the pure-JS / FTS-only paths. This module NEVER throws.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Directory of this module — used to resolve the vendored Honker binary. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export interface Capabilities {
  /** A system extension-enabled SQLite is active for this process. */
  customSqlite: boolean;
  /** sqlite-vec (vec0 virtual tables / KNN) is loaded. */
  vec: boolean;
  /** Honker (durable queue / scheduler / pub-sub) extension is loaded. */
  honker: boolean;
}

const CAPS_NONE: Capabilities = { customSqlite: false, vec: false, honker: false };

let _caps: Capabilities | null = null;
let _customSqliteApplied = false;

// Probe order: explicit override first, then common Homebrew / Linux locations.
function systemSqliteCandidates(): string[] {
  const out: string[] = [];
  const override = process.env["LTM_SQLITE_LIB"];
  if (override) out.push(override);
  out.push(
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
    "/usr/lib/aarch64-linux-gnu/libsqlite3.so.0",
    "/usr/lib64/libsqlite3.so.0",
  );
  return out;
}

function envDisabled(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

/** First candidate path that exists on disk, or null. Never throws. */
function firstExisting(candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return null;
}

/** Locate a system extension-enabled libsqlite3, or null if none found. */
export function locateSystemSqlite(): string | null {
  return firstExisting(systemSqliteCandidates());
}

// Probe order: explicit override first, then the vendored binary for this
// platform (packages/openltm-core/vendor/honker/<platform>/libhonker_ext.<ext>).
function honkerExtCandidates(): string[] {
  const out: string[] = [];
  const override = process.env["LTM_HONKER_EXT"];
  if (override) out.push(override);
  const platform = `${process.platform}-${process.arch}`;
  const suffix = process.platform === "darwin" ? "dylib" : "so";
  out.push(join(MODULE_DIR, "..", "vendor", "honker", platform, `libhonker_ext.${suffix}`));
  return out;
}

/**
 * Locate the Honker loadable extension, or null if none is available for this
 * platform. Mirrors locateSystemSqlite(): LTM_HONKER_EXT override wins, then the
 * vendored per-platform binary. A null result means Honker stays dormant.
 */
export function locateHonkerExt(): string | null {
  return firstExisting(honkerExtCandidates());
}

/**
 * Switch the process to a system extension-enabled SQLite. Idempotent and
 * never throws. Must run before the first Database is constructed to take
 * effect. Returns true if a custom sqlite is (now) active.
 *
 * Skipped entirely when BOTH vec and honker are force-disabled — there is no
 * reason to leave Bun's bundled SQLite in that case.
 */
export function ensureCustomSqlite(): boolean {
  if (_customSqliteApplied) return true;
  if (envDisabled("LTM_DISABLE_VEC") && envDisabled("LTM_DISABLE_HONKER")) return false;
  const lib = locateSystemSqlite();
  if (!lib) return false;
  try {
    const DB = Database as unknown as { setCustomSQLite: (p: string) => void };
    DB.setCustomSQLite(lib);
    _customSqliteApplied = true;
    // setCustomSQLite is a once-per-process global (Bun throws "SQLite already
    // loaded" on a second call). honker-bun's open() calls it again on its own
    // connection and would throw — silently killing the honker handle even
    // though the extension-enabled SQLite is already active process-wide. Now
    // that we've loaded it, neutralise further calls so honker-bun (and any
    // other consumer) no-ops instead of throwing.
    DB.setCustomSQLite = () => {};
    return true;
  } catch {
    return false;
  }
}

function loadVec(db: Database): boolean {
  try {
    // Resolve the loadable path synchronously and load it directly — avoids
    // any async-import concern in synchronous DB-init paths.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("sqlite-vec") as { getLoadablePath?: () => string };
    const path = mod.getLoadablePath?.();
    if (!path) return false;
    db.loadExtension(path);
    db.query("SELECT vec_version()").get();
    return true;
  } catch {
    return false;
  }
}

function loadHonker(db: Database): boolean {
  const ext = locateHonkerExt();
  if (!ext) return false;
  try {
    db.loadExtension(ext);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load available extensions into the given connection and cache the resulting
 * capabilities for the process. Never throws.
 *
 * @param opts.vec    attempt sqlite-vec (default true; env LTM_DISABLE_VEC wins)
 * @param opts.honker attempt Honker (default: auto-on when a libhonker_ext binary
 *                    is discoverable via locateHonkerExt(); env LTM_DISABLE_HONKER
 *                    force-disables, and LTM_HONKER_EXT overrides the binary path)
 */
export function loadExtensions(db: Database, opts?: { vec?: boolean; honker?: boolean }): Capabilities {
  const wantVec = (opts?.vec ?? true) && !envDisabled("LTM_DISABLE_VEC");
  const wantHonker =
    (opts?.honker ?? locateHonkerExt() !== null) && !envDisabled("LTM_DISABLE_HONKER");

  const customSqlite = ensureCustomSqlite();
  const vec = customSqlite && wantVec ? loadVec(db) : false;
  const honker = customSqlite && wantHonker ? loadHonker(db) : false;

  _caps = { customSqlite, vec, honker };
  return _caps;
}

/** Return the cached capabilities, or all-false if loadExtensions hasn't run. */
export function getCapabilities(): Capabilities {
  return _caps ?? { ...CAPS_NONE };
}

/** Test-only: clear cached capability state (does NOT undo setCustomSQLite). */
export function resetCapabilitiesForTesting(): void {
  _caps = null;
}
