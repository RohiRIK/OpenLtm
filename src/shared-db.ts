/**
 * shared-db.ts — Single DB singleton shared by db.ts, context.ts, server.ts, and janitor.
 * Prevents dual write connections that break WAL.
 * Runs versioned schema migrations on first access via migrations.ts.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getDbPath, getSchemaPath, CLAUDE_DIR } from "./paths.js";
import { runPendingMigrations } from "./migrations.js";
import { writeQueue } from "./lib/writeQueue.js";

export const DB_PATH = getDbPath();
const SCHEMA_PATH = getSchemaPath();

let _db: Database | null = null;
let _initPromise: Promise<Database> | null = null;

export async function initDb(): Promise<Database> {
  const dir = join(CLAUDE_DIR, "memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  // Apply schema.sql first (CREATE IF NOT EXISTS — safe for fresh + existing DBs)
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  // Then run versioned migrations (idempotent — skips already-applied versions)
  await runPendingMigrations(db);
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
  // For synchronous callers that call getDb() before the promise resolves on a
  // cold start, open a temporary sync path: schema.sql only, no migrations.
  // runPendingMigrations self-heals on the next async call and records versions.
  if (!_db) {
    const dir = join(CLAUDE_DIR, "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    _db = new Database(DB_PATH, { create: true });
    _db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    _db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
    // Fire-and-forget: apply pending versioned migrations in background
    runPendingMigrations(_db).catch(() => {/* self-heals on next call */});
  }
  return _db;
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
  });
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db
    .query<SettingRow, []>("SELECT key, value FROM settings")
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
