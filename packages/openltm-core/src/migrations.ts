#!/usr/bin/env bun
/**
 * migrations.ts — Versioned schema migration runner for openltm.db
 * Uses bun:sqlite and Bun file APIs exclusively.
 *
 * CLI: bun migrations.ts [--status | --up | --down | --reset | --accept-checksums]
 */
import { Database } from "bun:sqlite";
import { readdirSync, existsSync, statSync, lstatSync, unlinkSync, chmodSync } from "fs";
import { join, dirname, basename } from "path";
import { createHash } from "crypto";
import { getDbPath, getMigrationsDir } from "./paths.js";

const DB_PATH = getDbPath();
const MIGRATIONS_DIR = getMigrationsDir();

function openDb(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
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

let _failBackupForTesting = false;
/** Test hook: make the next backups fail as if VACUUM INTO errored. */
export function _forceBackupFailForTesting(value: boolean): void {
  _failBackupForTesting = value;
}

/** True when no user table holds a row (nothing a backup could preserve). */
function databaseIsEmpty(db: Database): boolean {
  const tables = db.query<{ name: string }, []>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_schema_version'`,
  ).all();
  for (const { name } of tables) {
    try {
      if (db.query(`SELECT 1 FROM ${quoteIdent(name)} LIMIT 1`).get()) return false;
    } catch {
      return false; // virtual/shadow table we cannot read: be safe, back up
    }
  }
  return true;
}

/**
 * Snapshot the database being migrated (the `db` passed in, not the global
 * path). Uses VACUUM INTO, which writes a consistent single file that
 * includes rows still only in the -wal file.
 * - Never overwrites: if the timestamped path exists, a numeric suffix is added.
 * - The backup gets the source DB's file mode (created under umask 077 first,
 *   so it is never briefly world-readable).
 * - No raw-copy fallback: if VACUUM INTO fails this throws, and the caller
 *   aborts before any migration runs or is recorded.
 * In-memory databases and databases with no rows are not backed up.
 */
export async function backupDb(now: Date = new Date(), source?: Database): Promise<string> {
  const ownConnection = source === undefined;
  const srcPath = source ? source.filename : DB_PATH;
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const base = `${srcPath}.bak-${timestamp}`;
  if (!srcPath || srcPath === ":memory:" || !existsSync(srcPath)) return base;
  const src = source ?? new Database(srcPath);
  try {
    if (databaseIsEmpty(src)) return base;
    let backupPath = base;
    for (let n = 1; existsSync(backupPath); n++) backupPath = `${base}-${n}`;
    const mode = statSync(srcPath).mode & 0o777;
    const prevUmask = process.umask(0o077);
    try {
      if (_failBackupForTesting) throw new Error("injected backup failure");
      src.run("VACUUM INTO ?", [backupPath]);
      chmodSync(backupPath, mode);
    } catch (err: unknown) {
      throw new Error(`[migrations] backup failed (VACUUM INTO ${backupPath}): ${(err as Error).message}; refusing to migrate`);
    } finally {
      process.umask(prevUmask);
    }
    return backupPath;
  } finally {
    if (ownConnection) try { src.close(); } catch { /* ignore */ }
  }
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
 * Filenames are `openltm.db.bak-<ISO-timestamp>`. ISO timestamps sort lexically,
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

  // Only files backupDb() itself names: <db filename>.bak-<ISO ts>[-<n>].
  // Anything else that merely shares the prefix (user notes, symlinks, dirs)
  // is never touched and never counted.
  const escaped = basename(dbPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const backupRe = new RegExp(
    `^${escaped}\\.bak-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)(?:-(\\d+))?$`,
  );
  const candidates: Array<{ name: string; ts: string; suffix: number }> = [];
  for (const f of readdirSync(dir)) {
    const m = backupRe.exec(f);
    if (m) candidates.push({ name: f, ts: m[1]!, suffix: m[2] === undefined ? 0 : Number(m[2]) });
  }
  if (candidates.length === 0) return result;

  const now = Date.now();
  const eligible: typeof candidates = [];
  const excluded: string[] = [];
  for (const c of candidates) {
    const fullPath = join(dir, c.name);
    try {
      const st = lstatSync(fullPath);
      if (!st.isFile()) continue; // symlink, directory, etc.: not ours
      if (now - st.mtimeMs < gracePeriodMs) {
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
    eligible.push(c);
  }

  if (eligible.length === 0) {
    result.kept = excluded;
    return result;
  }

  // Oldest first: by timestamp (fixed-width ISO sorts lexically), then by the
  // collision suffix as a number (-10 after -9; no suffix before -1).
  const ordered = eligible
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.suffix - b.suffix))
    .map((c) => join(dir, c.name));

  const toDelete = ordered.slice(0, Math.max(0, ordered.length - maxBackups));
  const toKeep = ordered.slice(toDelete.length);

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

// ── R-2: fail-closed reconciliation ────────────────────────────────────────────
// The old runPendingMigrations() catch treated any `duplicate column name` /
// `already exists` error as proof the migration could be recorded. That is
// unsound: db.exec(up) aborts at the FIRST failing statement, so the error only
// proves the first colliding statement — nothing about later columns, tables,
// indexes, or backfills. The recorder never trusts the error string: it replays
// the migration statement by statement (`reconcileMigration`), proving each
// skipped statement's object against the live schema and running the rest.

function skipWs(s: string, pos: number): number {
  while (pos < s.length && /\s/.test(s.charAt(pos))) pos++;
  return pos;
}

/**
 * Match a single SQL keyword at `pos` (whitespace before it is skipped),
 * case-insensitively. Returns the position just past the keyword, or null if
 * `kw` does not appear there as a whole word.
 */
function matchKeyword(s: string, pos: number, kw: string): number | null {
  const p = skipWs(s, pos);
  const raw = s.slice(p, p + kw.length);
  if (raw.toUpperCase() !== kw) return null;
  const after = p + kw.length;
  if (after < s.length && /[A-Za-z0-9_]/.test(s.charAt(after))) return null;
  return after;
}

/**
 * If the text at `pos` begins `IF NOT EXISTS`, return the position just past
 * it; otherwise return `pos` unchanged. Only the exact `IF NOT EXISTS` keyword
 * sequence is recognised.
 */
function consumeIfNotExists(s: string, pos: number): number {
  const ifEnd = matchKeyword(s, pos, "IF");
  if (ifEnd === null) return pos;
  const notEnd = matchKeyword(s, ifEnd, "NOT");
  if (notEnd === null) return pos;
  const existsEnd = matchKeyword(s, notEnd, "EXISTS");
  return existsEnd === null ? pos : existsEnd;
}

/**
 * Match a single SQL identifier starting at `pos`: a bare `[A-Za-z_][A-Za-z0-9_]*`
 * name or one of the quoted forms `"..."`, `` `...` ``, `[...]`. Returns the
 * unquoted name and the position just past the identifier, or null if none starts
 * there.
 */
function matchIdent(s: string, pos: number): { name: string; end: number } | null {
  if (pos >= s.length) return null;
  const ch = s.charAt(pos);
  if (ch === '"' || ch === "`") {
    let i = pos + 1;
    let name = "";
    for (; i < s.length; i++) {
      if (s.charAt(i) === ch) {
        if (s.charAt(i + 1) === ch) {
          name += ch;
          i++;
          continue;
        }
        return { name, end: i + 1 };
      }
      name += s.charAt(i);
    }
    return null; // unterminated quote
  }
  if (ch === "[") {
    const end = s.indexOf("]", pos + 1);
    if (end === -1) return null;
    return { name: s.slice(pos + 1, end), end: end + 1 };
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(pos));
  return m ? { name: m[0], end: pos + m[0].length } : null;
}

/**
 * True when `tail` (the column-definition remainder of an `ALTER TABLE ... ADD
 * COLUMN <col>` statement) contains nothing beyond a plain column definition.
 * Rejects a top-level comma (SQLite multi-action ALTER) and any top-level
 * DROP/RENAME keyword, so a statement such as `ALTER TABLE t ADD COLUMN a, DROP
 * COLUMN b` can never slip through. Commas and keywords inside parentheses or
 * string literals are allowed (CHECK constraints, functional defaults).
 */
function isColumnDefinitionTail(tail: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < tail.length; i++) {
    const ch = tail.charAt(i);
    if (quote !== null) {
      if (ch === quote) {
        if (tail.charAt(i + 1) === quote) {
          i++; // doubled quote inside a string literal
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && ch === ",") return false;
    if (
      depth === 0 &&
      ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_")
    ) {
      if (/^(DROP|RENAME)\b/i.test(tail.slice(i))) return false;
    }
  }
  return true;
}

export type DdlTargetKind =
  | "alter-add-column"
  | "create-table"
  | "create-index"
  | "create-trigger";

export interface DdlTarget {
  kind: DdlTargetKind;
  /** Table / index / trigger name that must exist in the live schema. */
  name: string;
  /** Column name that must exist on `name` (only for "alter-add-column"). */
  column?: string;
  /** Table an index is built on (informational — the index itself is verified). */
  onTable?: string;
}

/**
 * Parse a single SQL statement into one of the four DDL forms whose effect
 * reconciliation can prove against the live schema:
 *
 *   - `ALTER TABLE <t> ADD [COLUMN] <c> <column-definition>`
 *   - `CREATE TABLE [IF NOT EXISTS] <t> ( ... )`
 *   - `CREATE [UNIQUE] INDEX [IF NOT EXISTS] <i> ON <t> ( ... )`
 *   - `CREATE [TEMP|TEMPORARY] TRIGGER [IF NOT EXISTS] <t> ...`
 *
 * Returns null for anything else — UPDATE / INSERT / DELETE, DROP, ALTER ...
 * RENAME, CREATE VIEW / VIRTUAL TABLE, PRAGMA writes, VACUUM, REPLACE,
 * multi-action ALTER — so reconciliation never skips such a statement; it runs
 * it (or refuses it, if destructive).
 */
export function parseStatementDdl(stmt: string): DdlTarget | null {
  const s = stmt.trim();
  if (s.length === 0) return null;
  const start = skipWs(s, 0);

  // ── CREATE forms ──────────────────────────────────────────────────────────
  const createEnd = matchKeyword(s, start, "CREATE");
  if (createEnd !== null) {
    // CREATE TABLE [IF NOT EXISTS] <t> ( ... )
    const tableEnd = matchKeyword(s, createEnd, "TABLE");
    if (tableEnd !== null) {
      const ident = matchIdent(s, skipWs(s, consumeIfNotExists(s, tableEnd)));
      if (ident === null) return null;
      const after = skipWs(s, ident.end);
      // Require the column-list form — rejects `CREATE TABLE ... AS SELECT`.
      if (after >= s.length || s.charAt(after) !== "(") return null;
      return { kind: "create-table", name: ident.name };
    }

    // CREATE [UNIQUE] INDEX [IF NOT EXISTS] <i> ON <t> ( ... )
    const uniqueEnd = matchKeyword(s, createEnd, "UNIQUE");
    const indexStart = uniqueEnd !== null ? uniqueEnd : createEnd;
    const indexEnd = matchKeyword(s, indexStart, "INDEX");
    if (indexEnd !== null) {
      const ident = matchIdent(s, skipWs(s, consumeIfNotExists(s, indexEnd)));
      if (ident === null) return null;
      const onEnd = matchKeyword(s, ident.end, "ON");
      if (onEnd === null) return null;
      const tableIdent = matchIdent(s, skipWs(s, onEnd));
      if (tableIdent === null) return null;
      const after = skipWs(s, tableIdent.end);
      if (after >= s.length || s[after] !== "(") return null;
      return { kind: "create-index", name: ident.name, onTable: tableIdent.name };
    }

    // CREATE [TEMP | TEMPORARY] TRIGGER [IF NOT EXISTS] <i> ...
    const tempEnd = matchKeyword(s, createEnd, "TEMP");
    const tmpEnd = tempEnd !== null ? tempEnd : matchKeyword(s, createEnd, "TEMPORARY");
    const triggerEnd = matchKeyword(s, tmpEnd ?? createEnd, "TRIGGER");
    if (triggerEnd !== null) {
      const ident = matchIdent(s, skipWs(s, consumeIfNotExists(s, triggerEnd)));
      if (ident === null) return null;
      return { kind: "create-trigger", name: ident.name };
    }

    return null; // CREATE VIEW / CREATE VIRTUAL TABLE / any other CREATE form
  }

  // ── ALTER TABLE <t> ADD [COLUMN] <c> <column-definition> ──────────────────
  const alterEnd = matchKeyword(s, start, "ALTER");
  if (alterEnd !== null) {
    const tableEnd = matchKeyword(s, alterEnd, "TABLE");
    if (tableEnd === null) return null;
    const tableIdent = matchIdent(s, skipWs(s, tableEnd));
    if (tableIdent === null) return null;
    const addEnd = matchKeyword(s, tableIdent.end, "ADD");
    if (addEnd === null) return null;
    const columnEnd = matchKeyword(s, addEnd, "COLUMN");
    const columnStart = columnEnd !== null ? columnEnd : addEnd;
    const columnIdent = matchIdent(s, skipWs(s, columnStart));
    if (columnIdent === null) return null;
    if (!isColumnDefinitionTail(s.slice(skipWs(s, columnIdent.end)))) return null;
    return { kind: "alter-add-column", name: tableIdent.name, column: columnIdent.name };
  }

  return null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** True when `column` exists on `table` in the live schema (PRAGMA table_info). */
function columnExists(db: Database, table: string, column: string): boolean {
  const rows = db
    .query<{ name: string }, []>(`PRAGMA table_info(${quoteIdent(table)})`)
    .all();
  return rows.some((r) => r.name === column);
}

/** True when a table / index / trigger of `name` exists in the live schema. */
function schemaObjectExists(
  db: Database,
  type: "table" | "index" | "trigger",
  name: string,
): boolean {
  const row = db
    .query<{ cnt: number }, [string, string]>(
      "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = ? AND name = ?",
    )
    .get(type, name);
  return (row?.cnt ?? 0) > 0;
}

/**
 * Split SQL text into complete statements. Semicolons inside string literals,
 * quoted identifiers and comments do not end a statement, and a
 * `CREATE [TEMP] TRIGGER` statement runs to the `END;` that closes its body
 * (the inner statements' semicolons are part of it). Comments are dropped.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let segment = ""; // text since the last top-level `;` inside the current statement
  let i = 0;
  const flush = (): void => {
    const s = buf.trim();
    if (s.length > 0) statements.push(s);
    buf = "";
    segment = "";
  };
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (ch === "-" && sql.charAt(i + 1) === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      buf += " ";
      continue;
    }
    if (ch === "/" && sql.charAt(i + 1) === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      buf += " ";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const closeCh = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql.charAt(j) === closeCh) {
          if (closeCh !== "]" && sql.charAt(j + 1) === closeCh) {
            j += 2; // doubled quote inside the literal
            continue;
          }
          break;
        }
        j++;
      }
      const lit = sql.slice(i, j + 1);
      buf += lit;
      segment += lit;
      i = j + 1;
      continue;
    }
    if (ch === ";") {
      const isTrigger = /^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(buf.trimStart());
      if (!isTrigger || segment.trim().toUpperCase() === "END") {
        flush();
      } else {
        buf += ch;
        segment = "";
      }
      i++;
      continue;
    }
    buf += ch;
    segment += ch;
    i++;
  }
  flush();
  return statements;
}

/**
 * True for a statement that removes schema or rows: `DROP ...`, `DELETE ...`,
 * `ALTER TABLE ... DROP|RENAME ...`, `VACUUM`. Reconciliation never runs these.
 */
export function isDestructiveStatement(stmt: string): boolean {
  const s = stmt.trimStart();
  if (/^(DROP|DELETE|VACUUM)\b/i.test(s)) return true;
  // A plain ADD COLUMN (parser-verified) is safe even if a literal says "drop".
  if (parseStatementDdl(s)?.kind === "alter-add-column") return false;
  return /^ALTER\s+TABLE\b/i.test(s) && /\b(DROP|RENAME)\b/i.test(s);
}

/** True when the schema object (or column) a parsed DDL statement creates already exists. */
function ddlTargetPresent(db: Database, target: DdlTarget): boolean {
  switch (target.kind) {
    case "alter-add-column":
      return schemaObjectExists(db, "table", target.name) && columnExists(db, target.name, target.column!);
    case "create-table":
      return schemaObjectExists(db, "table", target.name);
    case "create-index":
      return schemaObjectExists(db, "index", target.name);
    case "create-trigger":
      return schemaObjectExists(db, "trigger", target.name);
  }
}

/**
 * Fail-closed recovery for a migration whose plain `db.exec(up)` failed —
 * typically because another writer (the Hermes plugin, or schema.sql on a
 * fresh install) already created some of the objects it adds. Must run inside
 * the caller's transaction.
 *
 * Walks the statements in order. A statement is skipped only when it is one of
 * the four supported DDL forms (`parseStatementDdl`) AND the object it creates
 * is verifiably present in the live schema. Every other statement runs. A
 * destructive statement (`isDestructiveStatement`) is refused rather than run
 * against a schema this runner did not build, and any statement error throws,
 * so the caller rolls the whole migration back and records nothing. The error
 * string of the original failure is never trusted: on success every statement
 * has either run or had its effect proven present.
 */
export function reconcileMigration(db: Database, up: string): void {
  for (const statement of splitSqlStatements(up)) {
    const target = parseStatementDdl(statement);
    if (target !== null && ddlTargetPresent(db, target)) continue;
    if (isDestructiveStatement(statement)) {
      throw new Error(`refusing to run a destructive statement during reconciliation: "${statement}"`);
    }
    try {
      db.run(statement);
    } catch (err: unknown) {
      throw new Error(`statement failed during reconciliation: "${statement}": ${(err as Error).message}`);
    }
  }
}

/**
 * sha256 of earlier texts of migration files that shipped (in a release, or
 * on main) and were later edited. Every edit was schema-neutral for a database
 * that ran the earlier text: 009 and 023 changed comments only; 015 and 017
 * moved their backfill / index into 024 / 025, which re-check idempotently;
 * 027 gained a row-count guard. A database recorded with one of these is
 * re-stamped with the current checksum instead of being refused. Only exact
 * historical texts are listed — any other mismatch still fails closed.
 */
export const SUPERSEDED_CHECKSUMS: ReadonlyMap<number, readonly string[]> = new Map([
  [9, ["db17d2b9b9be2115a1a031984d8fa7f1e49ca01aea304e213a952f4eab8306e9"]],
  [15, ["d62ca21ab805732f6d756783f6d3795b2c4d6435ec520e9e218b871b1175ad23"]],
  [17, ["b364e2a54fba90b6520526c379e49299d39cd006c80c5b2899cb86924ab77d45"]],
  [23, ["aa905ecc51a39767f18c998c36c8b0b213edea2c2a2f6a7469e965b4126dbf67"]],
  [27, ["6dc41f3e8be8a435bf43dcdab295ab1d5e3eb3aab83a774dcd559afb4c612616"]],
]);

export interface ChecksumMismatch {
  version: number;
  name: string;
  recorded: string;
  current: string;
}

/**
 * Applied versions whose recorded checksum matches neither the on-disk file
 * nor a `SUPERSEDED_CHECKSUMS` entry. Throws when an applied version has no
 * migration file. Read-only.
 */
export function findChecksumMismatches(db: Database, files: MigrationFile[]): ChecksumMismatch[] {
  const fileByVersion = new Map(files.map((f) => [f.version, f] as const));
  const rows = db
    .query<{ version: number; checksum: string }, []>(
      "SELECT version, checksum FROM _schema_version ORDER BY version",
    )
    .all();

  const mismatches: ChecksumMismatch[] = [];
  for (const row of rows) {
    const file = fileByVersion.get(row.version);
    if (file === undefined) {
      throw new Error(
        `[migrations] fail closed: applied version ${row.version} has no matching migration file`,
      );
    }
    const current = computeChecksum(file.content);
    if (current === row.checksum) continue;
    if (SUPERSEDED_CHECKSUMS.get(row.version)?.includes(row.checksum)) continue;
    mismatches.push({ version: row.version, name: file.name, recorded: row.checksum, current });
  }
  return mismatches;
}

/**
 * Integrity check that runs at the top of `runPendingMigrations`, before any
 * pending work is selected. For every applied version it recomputes
 * `sha256(file.content)` from the on-disk migration file and requires the
 * recorded checksum to equal it, or to be a known earlier text of the same
 * file (`SUPERSEDED_CHECKSUMS`, re-stamped here). Any other edited or renamed
 * migration file, or a missing file for an applied version, stops the whole
 * run. The only way past that is the explicit, backed-up
 * `--accept-checksums` CLI step (`acceptChecksumMismatches`).
 */
export function verifyRecordedChecksums(
  db: Database,
  files: MigrationFile[],
  applied: Set<number>,
): void {
  if (applied.size === 0) return;

  const mismatches = findChecksumMismatches(db, files);
  if (mismatches.length > 0) {
    const list = mismatches.map((m) => `v${m.version} (${m.name})`).join(", ");
    const m = mismatches[0]!;
    throw new Error(
      `[migrations] fail closed: checksum mismatch for applied version ${m.version} ` +
        `(${m.name}); recorded ${m.recorded} != current ${m.current}. Refusing to continue. ` +
        `Mismatched: ${list}. Run /openltm:doctor for details; ` +
        `/openltm:admin migrate --accept-checksums re-records them after a backup.`,
    );
  }

  // Re-stamp versions recorded with a superseded text, so the next run takes
  // the exact-match path.
  const restamp = db.prepare("UPDATE _schema_version SET checksum = ? WHERE version = ? AND checksum = ?");
  for (const file of files) {
    if (!applied.has(file.version)) continue;
    for (const old of SUPERSEDED_CHECKSUMS.get(file.version) ?? []) {
      restamp.run(computeChecksum(file.content), file.version, old);
    }
  }
}

/**
 * Explicit recovery for a checksum mismatch `SUPERSEDED_CHECKSUMS` does not
 * cover (for example a database migrated by a pre-release build). Backs the
 * database up, then records the current checksum for every mismatched applied
 * version. No migration SQL runs and no rows change. Returns the re-recorded
 * versions and the backup path (null when nothing needed re-recording).
 */
export async function acceptChecksumMismatches(
  db?: Database,
): Promise<{ accepted: ChecksumMismatch[]; backupPath: string | null }> {
  const _db = db ?? openDb();
  ensureMigrationsTable(_db);
  const mismatches = findChecksumMismatches(_db, await getMigrationFiles());
  if (mismatches.length === 0) return { accepted: [], backupPath: null };

  const backupPath = await backupDb(new Date(), _db);
  const update = _db.prepare("UPDATE _schema_version SET checksum = ? WHERE version = ?");
  _db.transaction(() => {
    for (const m of mismatches) update.run(m.current, m.version);
  })();
  return { accepted: mismatches, backupPath };
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

  // R-2: before any pending work is selected, prove every already-recorded
  // version still matches its on-disk migration file. An edited or renamed
  // migration file, or a missing file, stops the whole run — recorded state
  // is never trusted.
  verifyRecordedChecksums(_db, files, applied);

  const pending = files.filter((f) => !applied.has(f.version));

  if (pending.length === 0) return [];

  const newBackupPath = await backupDb(new Date(), _db);

  const results: MigrationResult[] = [];
  for (const file of pending) {
    const { up } = parseMigration(file.content);
    const checksum = computeChecksum(file.content);

    try {
      _db.transaction(() => {
        // Run statement by statement: bun:sqlite's multi-statement exec()
        // silently skips errors after the first statement, which could let a
        // failed INSERT...SELECT be followed by DROP + RENAME and still record
        // the version. Each run() throws on error and rolls the whole
        // migration back. Marker migrations with no DDL yield no statements.
        if (up) for (const statement of splitSqlStatements(up)) _db.run(statement);
        _db.run(
          `INSERT INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)`,
          [file.version, file.name, checksum],
        );
      })();
    } catch (err: unknown) {
      // R-2: a duplicate-column / already-exists error only proves the FIRST
      // colliding statement failed — db.exec(up) aborts there, so later
      // columns, tables, indexes, and backfills may still be missing. Never
      // trust the error string: replay the migration statement by statement,
      // skipping only DDL whose object is verifiably present and running the
      // rest, all in one transaction. Any refusal or error rolls it back and
      // fails closed.
      try {
        _db.transaction(() => {
          reconcileMigration(_db, up);
          _db.run(
            `INSERT INTO _schema_version (version, name, checksum) VALUES (?, ?, ?)`,
            [file.version, file.name, checksum],
          );
        })();
      } catch (reconcileErr: unknown) {
        throw new Error(
          `Migration ${file.version} (${file.name}) failed and could not be reconciled; ` +
            `refusing to record it. Original error: ${(err as Error).message}. ` +
            `Reconcile refusal: ${(reconcileErr as Error).message}`,
        );
      }
    }

    results.push({ version: file.version, name: file.name, action: "applied" });
  }

  try {
    await enforceRetention(getRetentionDefault(), { currentBackupPath: newBackupPath, dbPath: _db.filename || undefined });
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
          console.error("No migration files found in migrations/");
        } else {
          console.error("\nMigration Status:");
          console.error("─".repeat(60));
          for (const s of statuses) {
            const tag = s.status === "applied" ? "[applied]" : "[pending]";
            const date = s.applied_at ? `  (${s.applied_at})` : "";
            console.error(`  ${tag.padEnd(10)} v${String(s.version).padStart(3, "0")} ${s.name}${date}`);
          }
          const mismatches = findChecksumMismatches(db, await getMigrationFiles());
          for (const m of mismatches) {
            console.error(`  [checksum mismatch] v${String(m.version).padStart(3, "0")} ${m.name}`);
          }
          if (mismatches.length > 0) console.error("  Run with --accept-checksums to re-record them (a backup is taken first).");
          console.error("");
        }
      } else if (arg === "--up") {
        const results = await runPendingMigrations(db);
        if (results.length === 0) {
          console.error("No pending migrations.");
        } else {
          for (const r of results) {
            console.error(`Applied: v${String(r.version).padStart(3, "0")} ${r.name}`);
          }
        }
      } else if (arg === "--down") {
        const result = await rollbackLast(db);
        if (!result) {
          console.error("No applied migrations to roll back.");
        } else {
          console.error(`Rolled back: v${String(result.version).padStart(3, "0")} ${result.name}`);
        }
      } else if (arg === "--reset") {
        const results = await resetAll(db);
        if (results.length === 0) {
          console.error("Nothing to reset.");
        } else {
          for (const r of results) {
            console.error(`Rolled back: v${String(r.version).padStart(3, "0")} ${r.name}`);
          }
        }
      } else if (arg === "--accept-checksums") {
        const { accepted, backupPath } = await acceptChecksumMismatches(db);
        if (accepted.length === 0) {
          console.error("No checksum mismatches.");
        } else {
          if (backupPath) console.error(`Backup: ${backupPath}`);
          for (const m of accepted) {
            console.error(`Re-recorded checksum: v${String(m.version).padStart(3, "0")} ${m.name}`);
          }
        }
      } else {
        console.error(`Unknown argument: ${arg}`);
        console.error("Usage: bun migrations.ts [--status | --up | --down | --reset | --accept-checksums]");
        process.exit(1);
      }
    } catch (err) {
      console.error("Migration error:", err);
      process.exit(1);
    }
  })();
}
