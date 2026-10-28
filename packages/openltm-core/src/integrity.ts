/**
 * integrity.ts — Database health checks and a repair plan (`ltm doctor`).
 *
 * checkIntegrity() only reads. It reports what is wrong and, per problem,
 * whether a safe fix exists. repairIntegrity() applies those fixes after a
 * VACUUM INTO backup. Every fix rebuilds derived data (full-text indexes, the
 * vec0 index) or removes rows that point at nothing; no memory's text,
 * category or status is ever changed. Vectors from another embedding model
 * are removed so the embedding backfill can redo them; they are derived too.
 *
 * Inspired by memvid's verify / doctor (plan, then apply).
 */
import type { Database } from "bun:sqlite";
import { backupDb } from "./migrations.js";
import { getActiveEmbedDim, isVecAvailable, rebuildVecIndex, VEC_TABLE } from "./vec/index.js";

export type IntegrityCheckId =
  | "sqlite"
  | "foreign_keys"
  | "fts"
  | "embeddings_orphans"
  | "embeddings_model"
  | "vec_index"
  | "supersede_links";

export interface IntegrityCheck {
  id: IntegrityCheckId;
  ok: boolean;
  /** One line for people: what was checked and what was found. */
  message: string;
  /** Present when a problem was found and `ltm doctor --fix` can repair it. */
  fix?: string;
  count?: number;
}

export interface IntegrityReport {
  ok: boolean;
  checks: IntegrityCheck[];
}

export interface IntegrityOptions {
  /** Full PRAGMA integrity_check instead of quick_check (slower on large DBs). */
  deep?: boolean;
  /** The embedding model recall uses now; vectors from another model are flagged. Omit to skip that check. */
  activeModel?: string | null;
}

/** Full-text indexes over external content tables, with the table they mirror. */
const FTS_TABLES: ReadonlyArray<{ fts: string; content: string }> = [
  { fts: "memories_fts", content: "memories" },
  { fts: "context_items_fts", content: "context_items" },
  { fts: "records_fts", content: "records" },
];

/** Tables whose orphan rows (a parent that no longer exists) are safe to delete. */
const ORPHAN_SAFE_TABLES: ReadonlySet<string> = new Set([
  "memory_tags", "memory_relations", "memory_files", "memory_embeddings", "memory_provenance", "memory_layout",
]);

function tableExists(db: Database, name: string): boolean {
  return db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM sqlite_master WHERE name=?").get(name)!.n > 0;
}

/** ltm.embed.dim when the settings row exists, else null. */
function configuredEmbedDim(db: Database): number | null {
  if (!tableExists(db, "settings")) return null;
  const row = db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key=?").get("ltm.embed.dim");
  const n = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function count(db: Database, sql: string, ...params: Array<string | number>): number {
  return db.query<{ n: number }, Array<string | number>>(sql).get(...params)?.n ?? 0;
}

function checkSqlite(db: Database, deep: boolean): IntegrityCheck {
  const pragma = deep ? "integrity_check" : "quick_check";
  const rows = db.query<Record<string, string>, []>(`PRAGMA ${pragma}`).all().map((r) => Object.values(r)[0]);
  const ok = rows.length === 1 && rows[0] === "ok";
  return ok
    ? { id: "sqlite", ok, message: `SQLite ${pragma}: ok` }
    : { id: "sqlite", ok, message: `SQLite ${pragma} found ${rows.length} problem(s): ${rows.slice(0, 3).join("; ")}. Restore the latest openltm.db.bak-* backup`, count: rows.length };
}

function foreignKeyViolations(db: Database): Array<{ table: string; rowid: number; parent: string }> {
  return db.query<{ table: string; rowid: number; parent: string }, []>("PRAGMA foreign_key_check").all();
}

function checkForeignKeys(db: Database): IntegrityCheck {
  const rows = foreignKeyViolations(db);
  if (rows.length === 0) return { id: "foreign_keys", ok: true, message: "No rows point at a missing memory" };
  const byTable = new Map<string, number>();
  for (const r of rows) byTable.set(r.table, (byTable.get(r.table) ?? 0) + 1);
  const summary = [...byTable].map(([t, n]) => `${t} ${n}`).join(", ");
  const fixable = [...byTable.keys()].every((t) => ORPHAN_SAFE_TABLES.has(t));
  return {
    id: "foreign_keys", ok: false, count: rows.length,
    message: `${rows.length} row(s) point at something that no longer exists (${summary})`,
    ...(fixable ? { fix: "delete the orphan rows" } : {}),
  };
}

function ftsProblems(db: Database): string[] {
  const bad: string[] = [];
  for (const { fts, content } of FTS_TABLES) {
    if (!tableExists(db, fts)) continue;
    try {
      // rank=1 compares the index with its content table, not only its own structure.
      db.run(`INSERT INTO ${fts}(${fts}, rank) VALUES ('integrity-check', 1)`);
    } catch {
      bad.push(`${fts} (mirrors ${content})`);
    }
  }
  return bad;
}

function checkFts(db: Database): IntegrityCheck {
  const bad = ftsProblems(db);
  return bad.length === 0
    ? { id: "fts", ok: true, message: "Full-text indexes match their tables" }
    : { id: "fts", ok: false, count: bad.length, message: `Full-text index out of sync: ${bad.join(", ")}. Recall can miss or misrank memories`, fix: "rebuild the full-text index" };
}

function checkEmbeddingOrphans(db: Database): IntegrityCheck {
  if (!tableExists(db, "memory_embeddings")) return { id: "embeddings_orphans", ok: true, message: "No embeddings table (full-text search only)" };
  const n = count(db, "SELECT COUNT(*) n FROM memory_embeddings e WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = e.memory_id)");
  return n === 0
    ? { id: "embeddings_orphans", ok: true, message: "Every vector belongs to a memory" }
    : { id: "embeddings_orphans", ok: false, count: n, message: `${n} vector(s) belong to deleted memories`, fix: "delete them" };
}

function checkEmbeddingModel(db: Database, activeModel: string, dim: number | null): IntegrityCheck {
  if (!tableExists(db, "memory_embeddings")) return { id: "embeddings_model", ok: true, message: "No embeddings table" };
  const groups = db.query<{ model: string | null; dim: number | null; n: number }, []>(
    "SELECT model, dim, COUNT(*) n FROM memory_embeddings GROUP BY model, dim ORDER BY n DESC",
  ).all();
  const total = groups.reduce((s, g) => s + g.n, 0);
  const other = groups.filter((g) => g.model !== activeModel || (dim !== null && g.dim !== dim));
  const n = other.reduce((s, g) => s + g.n, 0);
  const active = `${activeModel}${dim !== null ? `/${dim}` : ""}`;
  if (n === 0) return { id: "embeddings_model", ok: true, message: `All vectors come from the active model (${active})` };
  const desc = other.map((g) => `${g.model ?? "unknown"}/${g.dim ?? "?"}: ${g.n}`).join(", ");
  // Every vector "wrong" more likely means the configured model is not the one
  // in use than that the whole store is stale: report it, never offer to wipe it.
  if (n === total) {
    return {
      id: "embeddings_model", ok: false, count: n,
      message: `No vector matches the configured model ${active} (${desc}). Check embeddings.model / LTM_EMBED_MODEL before re-embedding anything`,
    };
  }
  return {
    id: "embeddings_model", ok: false, count: n,
    message: `${n} vector(s) come from another model than ${active} (${desc}); semantic recall ignores them`,
    fix: "delete them so the embedding backfill re-embeds those memories",
  };
}

function checkVecIndex(db: Database, dim: number, activeModel: string | null | undefined): IntegrityCheck {
  if (!isVecAvailable()) return { id: "vec_index", ok: true, message: "sqlite-vec not loaded (vector search uses the JS fallback)" };
  if (!tableExists(db, VEC_TABLE)) return { id: "vec_index", ok: true, message: "No vec index yet" };
  const indexed = count(db, `SELECT COUNT(*) n FROM ${VEC_TABLE}`);
  const expected = activeModel
    ? count(db, "SELECT COUNT(*) n FROM memory_embeddings WHERE dim=? AND model=?", dim, activeModel)
    : count(db, "SELECT COUNT(*) n FROM memory_embeddings WHERE dim=?", dim);
  const stray = count(db, `SELECT COUNT(*) n FROM ${VEC_TABLE} v WHERE NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.memory_id = v.rowid)`);
  return indexed === expected && stray === 0
    ? { id: "vec_index", ok: true, message: `vec index holds ${indexed} vector(s), as expected` }
    : { id: "vec_index", ok: false, count: Math.abs(expected - indexed) + stray, message: `vec index holds ${indexed} vector(s), expected ${expected}${stray ? ` (${stray} with no stored vector)` : ""}`, fix: "rebuild the vec index" };
}

function checkSupersedeLinks(db: Database): IntegrityCheck {
  const n = count(db, "SELECT COUNT(*) n FROM memories WHERE status='superseded' AND superseded_by IS NULL");
  return n === 0
    ? { id: "supersede_links", ok: true, message: "Every superseded memory names its replacement" }
    : { id: "supersede_links", ok: false, count: n, message: `${n} superseded memor${n === 1 ? "y has" : "ies have"} no replacement left (it was forgotten). Review them in the graph app; doctor does not change memory status` };
}

/** Run every check. Read-only (the FTS integrity-check command writes nothing). */
export function checkIntegrity(db: Database, opts: IntegrityOptions = {}): IntegrityReport {
  const dim = getActiveEmbedDim(db);
  const checks: IntegrityCheck[] = [checkSqlite(db, opts.deep ?? false)];
  // The configured dim only counts when someone set it; the default is a guess.
  const dimSetting = configuredEmbedDim(db);
  // A corrupt file makes the other checks meaningless and can throw.
  if (checks[0]!.ok) {
    checks.push(checkForeignKeys(db), checkFts(db), checkEmbeddingOrphans(db));
    if (opts.activeModel) checks.push(checkEmbeddingModel(db, opts.activeModel, dimSetting));
    checks.push(checkVecIndex(db, dim, opts.activeModel), checkSupersedeLinks(db));
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export interface RepairResult {
  /** VACUUM INTO backup taken first (empty for in-memory databases). */
  backupPath: string | null;
  applied: Array<{ id: IntegrityCheckId; detail: string }>;
  /** Problems found that have no automatic fix. */
  skipped: IntegrityCheck[];
  after: IntegrityReport;
}

/**
 * Apply the fixes a report offers. Backs the database up first and refuses
 * to touch a file SQLite itself reports as corrupt.
 */
export async function repairIntegrity(db: Database, report: IntegrityReport, opts: IntegrityOptions = {}): Promise<RepairResult> {
  const sqlite = report.checks.find((c) => c.id === "sqlite");
  if (sqlite && !sqlite.ok) throw new Error(`refusing to repair: ${sqlite.message}`);
  const todo = report.checks.filter((c) => !c.ok && c.fix);
  const skipped = report.checks.filter((c) => !c.ok && !c.fix);
  if (todo.length === 0) return { backupPath: null, applied: [], skipped, after: report };

  const backupPath = db.filename && db.filename !== ":memory:" ? await backupDb(new Date(), db) : null;
  const applied: RepairResult["applied"] = [];
  const dim = getActiveEmbedDim(db);
  for (const c of todo) {
    switch (c.id) {
      case "foreign_keys": {
        const rows = foreignKeyViolations(db).filter((r) => ORPHAN_SAFE_TABLES.has(r.table));
        db.transaction(() => {
          for (const r of rows) db.run(`DELETE FROM ${r.table} WHERE rowid=?`, [r.rowid]);
        })();
        applied.push({ id: c.id, detail: `deleted ${rows.length} orphan row(s)` });
        break;
      }
      case "fts": {
        const rebuilt: string[] = [];
        for (const { fts } of FTS_TABLES) {
          if (!tableExists(db, fts)) continue;
          db.run(`INSERT INTO ${fts}(${fts}) VALUES ('rebuild')`);
          rebuilt.push(fts);
        }
        applied.push({ id: c.id, detail: `rebuilt ${rebuilt.join(", ")}` });
        break;
      }
      case "embeddings_orphans": {
        const r = db.run("DELETE FROM memory_embeddings WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = memory_embeddings.memory_id)");
        applied.push({ id: c.id, detail: `deleted ${r.changes} orphan vector(s)` });
        break;
      }
      case "embeddings_model": {
        if (!opts.activeModel) break;
        const setDim = configuredEmbedDim(db);
        const r = setDim === null
          ? db.run("DELETE FROM memory_embeddings WHERE model IS NOT ?", [opts.activeModel])
          : db.run("DELETE FROM memory_embeddings WHERE model IS NOT ? OR dim IS NOT ?", [opts.activeModel, setDim]);
        applied.push({ id: c.id, detail: `deleted ${r.changes} vector(s) from other models; run the embedding backfill to redo them` });
        break;
      }
      case "vec_index":
        break; // rebuilt last, after vectors were cleaned
      default:
        break;
    }
  }
  // The vec index mirrors memory_embeddings, so rebuild it after any vector change.
  if (isVecAvailable() && tableExists(db, VEC_TABLE) && todo.some((c) => c.id === "vec_index" || c.id.startsWith("embeddings"))) {
    const n = rebuildVecIndex(db, { dim, ...(opts.activeModel ? { model: opts.activeModel } : {}) });
    applied.push({ id: "vec_index", detail: n >= 0 ? `rebuilt with ${n} vector(s)` : "rebuild failed" });
  }
  return { backupPath, applied, skipped, after: checkIntegrity(db, opts) };
}
