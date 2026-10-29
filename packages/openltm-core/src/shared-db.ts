/**
 * shared-db.ts — Single DB singleton shared by db.ts, context.ts, server.ts, and janitor.
 * Prevents dual write connections that break WAL.
 * Runs versioned schema migrations on first access via migrations.ts.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { getDbPath, getSchemaPath } from "./paths.js";
import { getMigrationFiles, runPendingMigrations, verifyRecordedChecksums } from "./migrations.js";
import { CONNECTION_PRAGMAS } from "./sql.js";
import { writeQueue } from "./lib/writeQueue.js";
import { ensureCustomSqlite, loadExtensions, getCapabilities } from "./extensions.js";
import { syncVecIndex } from "./vec/index.js";
import { acquireJanitorLock } from "./janitor/lock.js";
import type { LtmCoreConfig } from "./adapterTypes.js";

export let DB_PATH = getDbPath();
let SCHEMA_PATH = getSchemaPath();

/** Configure openltm-core with host-specific paths. Call before first getDb(). */
export function configure(config: LtmCoreConfig): void {
  if (config.dbPath !== DB_PATH) {
    // A handle opened on the old path would keep serving the old database.
    try { _db?.close(); } catch {}
    _db = null;
    _initPromise = null;
  }
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
  db.exec(CONNECTION_PRAGMAS);
  loadExtensions(db);
  await migrateDb(db);
  // Index embeddings the vec0 index is missing: a DB that predates vec wiring,
  // or vectors the Hermes plugin wrote to a shared DB. No-op when vec is
  // unavailable or nothing is missing.
  if (getCapabilities().vec) syncVecIndex(db);
  return db;
}

/**
 * Bring `db` to the current schema: schema.sql (CREATE IF NOT EXISTS), then the
 * pending versioned migrations. A file database is migrated under a
 * cross-process lock (`<db>.migrate.lock`), so processes opening a brand-new
 * database at once do not both run the same migrations.
 */
export async function migrateDb(db: Database, schemaPath: string = SCHEMA_PATH): Promise<void> {
  const schema = readFileSync(schemaPath, "utf-8");
  const hasMemories = tableExists(db, "memories");
  // Fast path: already current. schema.sql is CREATE IF NOT EXISTS, safe without the lock.
  if (hasMemories && await migrationsCurrent(db)) {
    db.exec(schema);
    return;
  }
  const file = db.filename;
  let release = (): void => {};
  if (file && file !== ":memory:") {
    // Waits for the holder; a lock left by a dead process is reclaimed.
    for (;;) {
      // Generic file lock; the janitor name is historical.
      const lock = acquireJanitorLock(file, { lockPath: `${file}.migrate.lock`, maxAgeMs: 10 * 60_000 });
      if (lock.acquired) { release = lock.release; break; }
      await Bun.sleep(25);
    }
  }
  try {
    // An existing DB migrates first: schema.sql indexes columns that only a
    // later migration adds (e.g. stale_flagged_at).
    if (hasMemories) await runPendingMigrations(db);
    db.exec(schema);
    if (!hasMemories) await runPendingMigrations(db);
  } finally {
    release();
  }
}

function tableExists(db: Database, name: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;
}

/** True when the newest migration file is recorded as applied (and every applied checksum still matches). */
async function migrationsCurrent(db: Database): Promise<boolean> {
  if (!tableExists(db, "_schema_version")) return false;
  const files = await getMigrationFiles();
  const latest = files.at(-1)?.version ?? 0;
  const row = db.query<{ v: number | null }, []>("SELECT MAX(version) AS v FROM _schema_version").get();
  if (row?.v !== latest) return false;
  // Keep the fail-closed checksum check on every open, as runPendingMigrations did.
  const applied = new Set(db.query<{ version: number }, []>("SELECT version FROM _schema_version").all().map((r) => r.version));
  verifyRecordedChecksums(db, files, applied);
  return true;
}

/** Path of the database this process opens (after configure()/initDb overrides). */
export function getConfiguredDbPath(): string {
  return DB_PATH;
}

export function getDb(): Database {
  if (_db) return _db;
  // Synchronous callers: run initDb eagerly and block via Bun's top-level await support.
  // _initPromise guards against concurrent initialisation during async startup paths.
  if (!_initPromise) {
    const init: Promise<Database> = initDb().then((db) => {
      // configure() switched paths while this ran: this handle is for the old DB.
      if (_initPromise !== init) { db.close(); return db; }
      _db = db;
      return db;
    }).catch((err) => {
      // Reset so the next call retries; swallow here — sync fallback below handles the cold path.
      if (_initPromise === init) _initPromise = null;
      throw err;
    });
    _initPromise = init;
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
    _db.exec(CONNECTION_PRAGMAS);
    loadExtensions(_db);
    // schema.sql indexes columns only later migrations add, so it throws on an
    // unmigrated DB; initDb (above) migrates it and swaps _db.
    try { _db.exec(readFileSync(SCHEMA_PATH, "utf-8")); } catch { /* unmigrated DB */ }
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
