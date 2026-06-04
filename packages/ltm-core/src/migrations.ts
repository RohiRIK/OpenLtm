#!/usr/bin/env bun
/**
 * migrations.ts — Versioned schema migration runner for ltm.db
 * Uses bun:sqlite and Bun file APIs exclusively.
 *
 * CLI: bun migrations.ts [--status | --up | --down | --reset]
 */
import { Database } from "bun:sqlite";
import { readdirSync, existsSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { createHash } from "crypto";
import { getDbPath, getMigrationsDir } from "./paths.js";

const DB_PATH = getDbPath();
const MIGRATIONS_DIR = getMigrationsDir();

function openDb(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  return db;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version     INTEGER NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
      checksum    TEXT NOT NULL
    )
  `);
}

export interface MigrationFile {
  version: number;
  name: string;
  path: string;
  content: string;
}

export async function getMigrationFiles(): Promise<MigrationFile[]> {
  if (!existsSync(MIGRATIONS_DIR)) return [];

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const results: MigrationFile[] = [];
  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) throw new Error(`Migration filename must match NNN_name.sql: ${file}`);
    const version = parseInt(match[1]!, 10);
    const name = match[2]!;
    const filePath = join(MIGRATIONS_DIR, file);
    const content = await Bun.file(filePath).text();
    results.push({ version, name, path: filePath, content });
  }
  return results;
}

export function getAppliedVersions(db: Database): Set<number> {
  ensureMigrationsTable(db);
  const rows = db
    .query<{ version: number }, []>("SELECT version FROM _schema_version ORDER BY version")
    .all();
  return new Set(rows.map((r) => r.version));
}

export function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function backupDb(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${DB_PATH}.bak-${timestamp}`;
  // Skip backup when the source DB doesn't exist (e.g. in-process test DBs
  // that were created on a different path than the module-level DB_PATH).
  if (!existsSync(DB_PATH)) return backupPath;
  const bytes = await Bun.file(DB_PATH).arrayBuffer();
  await Bun.write(backupPath, bytes);
  return backupPath;
}

/**
 * Read the default backup retention count from `LTM_BACKUP_RETENTION` env var.
 * Falls back to 1. Negative or non-numeric values also default to 1.
 */
export function getRetentionDefault(): number {
  const env = process.env["LTM_BACKUP_RETENTION"];
  if (!env) return 1;
  const n = parseInt(env, 10);
  if (Number.isNaN(n) || n < 0) return 1;
  return n;
}

export interface EnforceRetentionOptions {
  /** Override the db path (defaults to getDbPath() result). */
  dbPath?: string;
  /** Path of a .bak file just created by backupDb() — never delete it. */
  currentBackupPath?: string;
  /** Skip files whose mtime is newer than this many ms (default 60_000 = 60s). */
  gracePeriodMs?: number;
}

export interface EnforceRetentionResult {
  /** Absolute paths of files successfully deleted. */
  deleted: string[];
  /** Absolute paths of files that remain (within the retention window). */
  kept: string[];
  /** Non-fatal issues encountered (e.g. stat/unlink permission errors). */
  warnings: string[];
}

/**
 * Enforce a maximum number of .bak files alongside the database.
 *
 * Filenames are `ltm.db.bak-<ISO-timestamp>`. ISO timestamps sort lexically,
 * so sorting by filename = sorting by creation time. We keep the newest N
 * and delete the rest. Files newer than `gracePeriodMs` (default 60s) are
 * skipped to avoid racing with a concurrent writer.
 *
 * The function is idempotent and never throws — every error becomes a
 * warning in the result.
 */
export async function enforceRetention(
  maxBackups: number,
  options: EnforceRetentionOptions = {},
): Promise<EnforceRetentionResult> {
  const dbPath = options.dbPath ?? getDbPath();
  const gracePeriodMs = options.gracePeriodMs ?? 60_000;
  const result: EnforceRetentionResult = { deleted: [], kept: [], warnings: [] };

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    result.warnings.push(`Directory does not exist: ${dir}`);
    return result;
  }

  const files = readdirSync(dir).filter((f) => f.startsWith("ltm.db.bak-"));
  if (files.length === 0) return result;

  const now = Date.now();
  const eligible: string[] = [];
  const excluded: string[] = [];
  for (const f of files) {
    const fullPath = join(dir, f);
    try {
      const mtime = statSync(fullPath).mtimeMs;
      if (now - mtime < gracePeriodMs) {
        excluded.push(fullPath);
        continue;
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      result.warnings.push(`stat failed for ${fullPath}: ${(err as Error).message}`);
      continue;
    }
    if (options.currentBackupPath && fullPath === options.currentBackupPath) {
      excluded.push(fullPath);
      continue;
    }
    eligible.push(fullPath);
  }

  if (eligible.length === 0) {
    result.kept = excluded;
    return result;
  }

  eligible.sort();

  const toDelete = eligible.slice(0, Math.max(0, eligible.length - maxBackups));
  const toKeep = eligible.slice(toDelete.length);

  for (const file of toDelete) {
    try {
      unlinkSync(file);
      result.deleted.push(file);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        result.deleted.push(file);
      } else {
        result.warnings.push(`unlink failed for ${file}: ${(err as Error).message}`);
      }
    }
  }

  result.kept = [...excluded, ...toKeep];
  return result;
}

export interface ParsedMigration {
  up: string;
  down: string;
}

export function parseMigration(content: string): ParsedMigration {
  const parts = content.split(/^--\s*DOWN\s*$/m);
  const up = (parts[0] ?? "")
    .replace(/^--.*$/gm, "")
    .trim();
  const down = (parts[1] ?? "")
    .replace(/^--.*$/gm, "")
    .trim();
  return { up, down };
}

// ── Core migration actions ─────────────────────────────────────────────────────

export interface MigrationResult {
  version: number;
  name: string;
  action: "applied" | "skipped" | "rolled_back";
}

export async function runPendingMigrations(db?: Database): Promise<MigrationResult[]> {
  const _db = db ?? openDb();
  ensureMigrationsTable(_db);

  const files = await getMigrationFiles();
  const applied = getAppliedVersions(_db);
  const pending = files.filter((f) => !applied.has(f.version));

  if (pending.length === 0) return [];

  const newBackupPath = await backupDb();

  const results: MigrationResult[] = [];
  for (const file of pending) {
    const { up } = parseMigration(file.content);
    const checksum = computeChecksum(file.content);

    try {
      _db.transaction(() => {
        // Skip exec for marker migrations that have no DDL (e.g. 001_baseline).
        if (up) _db.exec(up);
        _db.run(
          `INSERT INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)`,
          [file.version, file.name, checksum],
        );
      })();
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      // Column was already added by shared-db.ts runMigrations() — self-heal by recording as applied
      if (msg.includes("duplicate column name") || msg.includes("already exists")) {
        _db.run(
          `INSERT OR IGNORE INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)`,
          [file.version, file.name, checksum],
        );
      } else {
        throw err;
      }
    }

    results.push({ version: file.version, name: file.name, action: "applied" });
  }

  try {
    await enforceRetention(getRetentionDefault(), { currentBackupPath: newBackupPath });
  } catch (err: unknown) {
    console.warn(`[migrations] retention enforcement failed: ${(err as Error).message}`);
  }

  return results;
}

export interface MigrationStatus {
  version: number;
  name: string;
  status: "applied" | "pending";
  applied_at?: string;
}

export async function getMigrationStatus(db?: Database): Promise<MigrationStatus[]> {
  const _db = db ?? openDb();
  ensureMigrationsTable(_db);

  const files = await getMigrationFiles();
  const rows = _db
    .query<{ version: number; applied_at: string }, []>(
      "SELECT version, applied_at FROM _schema_version ORDER BY version",
    )
    .all();
  const appliedMap = new Map(rows.map((r) => [r.version, r.applied_at]));

  return files.map((f) => {
    const applied_at = appliedMap.get(f.version);
    return {
      version: f.version,
      name: f.name,
      status: (applied_at ? "applied" : "pending") as "applied" | "pending",
      ...(applied_at ? { applied_at } : {}),
    };
  });
}

export async function rollbackLast(db?: Database): Promise<MigrationResult | null> {
  const _db = db ?? openDb();
  ensureMigrationsTable(_db);

  const last = _db
    .query<{ version: number; name: string }, []>(
      "SELECT version, name FROM _schema_version ORDER BY version DESC LIMIT 1",
    )
    .get();

  if (!last) return null;

  const files = await getMigrationFiles();
  const file = files.find((f) => f.version === last.version);
  if (!file) throw new Error(`Migration file for version ${last.version} not found`);

  const { down } = parseMigration(file.content);
  if (!down) throw new Error(`Migration ${last.version} has no DOWN section`);

  _db.transaction(() => {
    _db.exec(down);
    _db.run("DELETE FROM _schema_version WHERE version = ?", [last.version]);
  })();

  return { version: last.version, name: last.name, action: "rolled_back" };
}

export async function resetAll(db?: Database): Promise<MigrationResult[]> {
  const _db = db ?? openDb();
  ensureMigrationsTable(_db);

  // Read files once, then roll back in reverse order without repeated disk reads
  const files = await getMigrationFiles();
  const fileMap = new Map(files.map((f) => [f.version, f]));

  const applied = _db
    .query<{ version: number; name: string }, []>(
      "SELECT version, name FROM _schema_version ORDER BY version DESC",
    )
    .all();

  const results: MigrationResult[] = [];
  for (const row of applied) {
    const file = fileMap.get(row.version);
    if (!file) throw new Error(`Migration file for version ${row.version} not found`);
    const { down } = parseMigration(file.content);
    if (!down) throw new Error(`Migration ${row.version} has no DOWN section`);
    _db.transaction(() => {
      _db.exec(down);
      _db.run("DELETE FROM _schema_version WHERE version = ?", [row.version]);
    })();
    results.push({ version: row.version, name: row.name, action: "rolled_back" });
  }
  return results;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

if (import.meta.main) {
  void (async () => {
    const arg = process.argv[2] ?? "--status";
    const db = openDb();

    try {
      if (arg === "--status") {
        const statuses = await getMigrationStatus(db);
        if (statuses.length === 0) {
          console.log("No migration files found in migrations/");
        } else {
          console.log("\nMigration Status:");
          console.log("─".repeat(60));
          for (const s of statuses) {
            const tag = s.status === "applied" ? "[applied]" : "[pending]";
            const date = s.applied_at ? `  (${s.applied_at})` : "";
            console.log(`  ${tag.padEnd(10)} v${String(s.version).padStart(3, "0")} ${s.name}${date}`);
          }
          console.log("");
        }
      } else if (arg === "--up") {
        const results = await runPendingMigrations(db);
        if (results.length === 0) {
          console.log("No pending migrations.");
        } else {
          for (const r of results) {
            console.log(`Applied: v${String(r.version).padStart(3, "0")} ${r.name}`);
          }
        }
      } else if (arg === "--down") {
        const result = await rollbackLast(db);
        if (!result) {
          console.log("No applied migrations to roll back.");
        } else {
          console.log(`Rolled back: v${String(result.version).padStart(3, "0")} ${result.name}`);
        }
      } else if (arg === "--reset") {
        const results = await resetAll(db);
        if (results.length === 0) {
          console.log("Nothing to reset.");
        } else {
          for (const r of results) {
            console.log(`Rolled back: v${String(r.version).padStart(3, "0")} ${r.name}`);
          }
        }
      } else {
        console.error(`Unknown argument: ${arg}`);
        console.error("Usage: bun migrations.ts [--status | --up | --down | --reset]");
        process.exit(1);
      }
    } catch (err) {
      console.error("Migration error:", err);
      process.exit(1);
    }
  })();
}
