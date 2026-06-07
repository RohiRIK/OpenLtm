/**
 * shared-db.ts — Single DB singleton shared by db.ts, context.ts, server.ts, and janitor.
 * Prevents dual write connections that break WAL.
 * Runs versioned schema migrations on first access via migrations.ts.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { getDbPath, getSchemaPath } from "./paths.js";
import { runPendingMigrations } from "./migrations.js";
import { writeQueue } from "./lib/writeQueue.js";
import { ensureCustomSqlite, loadExtensions, getCapabilities } from "./extensions.js";
import { backfillVecIndexIfEmpty } from "./vec/index.js";
import type { LtmCoreConfig } from "./adapterTypes.js";

export let DB_PATH = getDbPath();
let SCHEMA_PATH = getSchemaPath();

/** Configure openltm-core with host-specific paths. Call before first getDb(). */
export function configure(config: LtmCoreConfig): void {
  DB_PATH = config.dbPath;
  if (config.schemaPath) SCHEMA_PATH = config.schemaPath;
}

let _db: Database | null = null;
let _initPromise: Promise<Database> | null = null;

export async function initDb(opts?: { dbPath?: string; schemaPath?: string }): Promise<Database> {
  if (opts?.dbPath) DB_PATH = opts.dbPath;
  if (opts?.schemaPath) SCHEMA_PATH = opts.schemaPath;
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Must run before the first Database opens to switch to an extension-enabled
  // system SQLite. No-op (degrades to FTS-only) when none is available.
  ensureCustomSqlite();
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  loadExtensions(db);
  // Apply schema.sql first (CREATE IF NOT EXISTS — safe for fresh + existing DBs)
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  // Then run versioned migrations (idempotent — skips already-applied versions)
  await runPendingMigrations(db);
  // One-time vec0 index backfill for DBs that predate vec wiring. No-op when
  // vec is unavailable or the index is already populated.
  if (getCapabilities().vec) backfillVecIndexIfEmpty(db);
  return db;
}

export function getDb(): Database {
  if (_db) return _db;
  // Synchronous callers: run initDb eagerly and block via Bun's top-level await support.
  // _initPromise guards against concurrent initialisation during async startup paths.
  if (!_initPromise) {
    _initPromise = initDb().then((db) => {
      _db = db;
      return db;
    }).catch((err) => {
      // Reset so the next call retries; swallow here — sync fallback below handles the cold path.
      _initPromise = null;
      throw err;
    });
    _initPromise.catch(() => {/* prevent unhandled rejection — sync fallback is active */});
  }
  // For synchronous callers on cold start: open a schema-only DB immediately.
  // Migrations run via _initPromise (above) on a dedicated connection and swap
  // _db once complete. Do NOT run runPendingMigrations here — that causes two
  // concurrent runners on the same file and UNIQUE constraint races.
  if (!_db) {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    ensureCustomSqlite();
    _db = new Database(DB_PATH, { create: true });
    _db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    loadExtensions(_db);
    _db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  }
  return _db;
}

/**
 * Await full DB initialisation (schema + all pending migrations).
 * Use in async startup paths (tests, server boot) when migrated columns are
 * needed before the first async tick completes.
 */
export async function waitForInit(): Promise<void> {
  if (!_initPromise) getDb(); // ensure _initPromise is created
  await _initPromise;
}

/**
 * Test-only: inject a specific Database instance as the singleton.
 * Closes any existing connection first. Never call in production code.
 */
export function _setDbForTesting(db: Database): void {
  try { _db?.close(); } catch {}
  _db = db;
  // Resolve immediately — db is already fully migrated; prevents a second
  // runPendingMigrations if getDb() or waitForInit() is called after injection.
  _initPromise = Promise.resolve(db);
}

/** Retry helper for SQLITE_BUSY errors — wraps a function with automatic retry. */
export function withRetry<T>(fn: () => T, maxRetries = 3): T {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn();
    } catch (err: unknown) {
      const e = err as { message?: string; code?: number };
      if (e?.message?.includes("SQLITE_BUSY") || e?.code === 5) {
        lastError = err as Error;
        if (i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 50;
          const start = Date.now();
          while (Date.now() - start < delay) { /* spin-wait */ }
        }
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// --- Settings helpers (used by janitor + server routes) ---

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db
    .query<SettingRow, [string]>("SELECT value FROM settings WHERE key=?")
    .get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): Promise<void> {
  const db = getDb();
  return writeQueue.enqueue(() => {
    db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [key, value],
    );
  }, db);
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db
    .query<SettingRow, []>("SELECT key, value FROM settings")
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
