/**
 * shared-db.ts — Single DB singleton shared by db.ts, context.ts, server.ts, and janitor.
 * Prevents dual write connections that break WAL.
 * Runs idempotent schema migrations on first access.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getDbPath, getSchemaPath, CLAUDE_DIR } from "./paths.js";

export const DB_PATH = getDbPath();
const SCHEMA_PATH = getSchemaPath();

let _db: Database | null = null;

/** Check if a column exists on a table. */
function hasColumn(db: Database, table: string, column: string): boolean {
  const info = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  return info.some((c) => c.name === column);
}

/** Check if a table exists. */
function hasTable(db: Database, table: string): boolean {
  const row = db
    .query<{ cnt: number }, [string]>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(table);
  return (row?.cnt ?? 0) > 0;
}

/** Run Phase 2 schema migrations idempotently. */
function runMigrations(db: Database): void {
  // Skip migrations if core tables don't exist yet (fresh DB — schema.sql will create them)
  if (!hasTable(db, "memories")) return;

  // memories: add status, embedding, last_used_at
  if (!hasColumn(db, "memories", "status")) {
    db.exec(
      "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','deprecated','superseded'))",
    );
  }
  if (!hasColumn(db, "memories", "embedding")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding BLOB");
  }
  if (!hasColumn(db, "memories", "last_used_at")) {
    db.exec(
      "ALTER TABLE memories ADD COLUMN last_used_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'",
    );
    // Backfill existing rows with actual current timestamp
    db.exec(
      "UPDATE memories SET last_used_at = datetime('now') WHERE last_used_at = '1970-01-01 00:00:00'",
    );
  }

  // context_items: add memory_id (Phase 1 migration), status
  if (!hasColumn(db, "context_items", "memory_id")) {
    db.exec(
      "ALTER TABLE context_items ADD COLUMN memory_id INTEGER REFERENCES memories(id) ON DELETE SET NULL",
    );
  }
  if (!hasColumn(db, "context_items", "status")) {
    db.exec(
      "ALTER TABLE context_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending_promotion','promoted'))",
    );
  }

  // settings table
  if (!hasTable(db, "settings")) {
    db.exec(`
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!hasColumn(db, "memories", "superseded_by")) {
    db.exec("ALTER TABLE memories ADD COLUMN superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL");
  }
  if (!hasColumn(db, "memories", "superseded_at")) {
    db.exec("ALTER TABLE memories ADD COLUMN superseded_at TEXT");
  }
  if (!hasColumn(db, "memories", "first_recalled_at")) {
    db.exec("ALTER TABLE memories ADD COLUMN first_recalled_at TEXT");
  }
  if (!hasColumn(db, "memories", "last_recalled_at")) {
    db.exec("ALTER TABLE memories ADD COLUMN last_recalled_at TEXT");
  }
  if (!hasColumn(db, "memories", "recall_count")) {
    db.exec("ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "memories", "workspace_id")) {
    db.exec("ALTER TABLE memories ADD COLUMN workspace_id TEXT");
  }
  if (!hasColumn(db, "memories", "agent_id")) {
    db.exec("ALTER TABLE memories ADD COLUMN agent_id TEXT");
  }
  if (!hasColumn(db, "context_items", "workspace_id")) {
    db.exec("ALTER TABLE context_items ADD COLUMN workspace_id TEXT");
  }
  if (!hasColumn(db, "context_items", "agent_id")) {
    db.exec("ALTER TABLE context_items ADD COLUMN agent_id TEXT");
  }

  // New indexes (CREATE INDEX IF NOT EXISTS is safe to re-run)
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memories_last_used ON memories(last_used_at)",
  );
}

export function getDb(): Database {
  if (_db) return _db;
  const dir = join(CLAUDE_DIR, "memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH, { create: true });
  _db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  // Migrations first — adds columns to existing tables so schema.sql indexes succeed
  runMigrations(_db);
  _db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
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

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, value],
  );
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db
    .query<SettingRow, []>("SELECT key, value FROM settings")
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
