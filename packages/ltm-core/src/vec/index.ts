/**
 * vec/index.ts — sqlite-vec (vec0) ANN index over memory embeddings.
 *
 * The vec0 virtual table `vec_memories` is a DERIVED index that mirrors the
 * active-model rows of `memory_embeddings` (the source of truth). It is created
 * lazily at runtime — never in schema.sql or a hard migration — because
 * `CREATE VIRTUAL TABLE … USING vec0` throws "no such module: vec0" on any
 * process where the extension failed to load, which would break DB init.
 *
 * Every function is gated on getCapabilities().vec and degrades to a no-op
 * (false / [] / -1) when vec is unavailable; callers fall back to the brute-
 * force JS-cosine path in embeddings.ts. Nothing here throws.
 *
 * Distance metric is cosine, so similarity = 1 - distance (identical → 1).
 */
import type { Database } from "bun:sqlite";
import { getCapabilities } from "../extensions.js";

export const VEC_TABLE = "vec_memories";
export const DEFAULT_EMBED_DIM = 768;

type Blob = Uint8Array | Buffer;

/** Active embedding dimension from settings (ltm.embed.dim), default 768. */
export function getActiveEmbedDim(db: Database): number {
  try {
    const row = db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key=?")
      .get("ltm.embed.dim");
    const n = row ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_EMBED_DIM;
  } catch {
    return DEFAULT_EMBED_DIM;
  }
}

export function isVecAvailable(): boolean {
  return getCapabilities().vec;
}

/**
 * Create the vec0 index table for the given dimension if vec is available.
 * Idempotent (CREATE … IF NOT EXISTS). No-op + false when unavailable.
 */
export function ensureVecTable(db: Database, dim?: number): boolean {
  if (!getCapabilities().vec) return false;
  const d = dim ?? getActiveEmbedDim(db);
  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(embedding float[${d}] distance_metric=cosine)`,
    );
    return true;
  } catch {
    return false;
  }
}

/** Upsert one vector into the index by memory id (rowid). No-op when unavailable. */
export function upsertVec(db: Database, memoryId: number, blob: Blob): boolean {
  if (!getCapabilities().vec) return false;
  try {
    db.transaction(() => {
      db.run(`DELETE FROM ${VEC_TABLE} WHERE rowid=?`, [memoryId]);
      db.run(`INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (?, ?)`, [memoryId, blob]);
    })();
    return true;
  } catch {
    return false;
  }
}

/** Remove one vector from the index by memory id. No-op when unavailable. */
export function deleteVec(db: Database, memoryId: number): boolean {
  if (!getCapabilities().vec) return false;
  try {
    db.run(`DELETE FROM ${VEC_TABLE} WHERE rowid=?`, [memoryId]);
    return true;
  } catch {
    return false;
  }
}

export interface VecHit {
  id: number;
  distance: number;
  similarity: number;
}

/**
 * KNN search over the index. Returns [] when vec is unavailable.
 * similarity = 1 - cosine distance (so higher = closer).
 */
export function knnVec(db: Database, queryBlob: Blob, k: number): VecHit[] {
  if (!getCapabilities().vec) return [];
  try {
    const rows = db
      .query<{ id: number; distance: number }, [Blob, number]>(
        `SELECT rowid AS id, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(queryBlob, k);
    return rows.map((r) => ({ id: r.id, distance: r.distance, similarity: 1 - r.distance }));
  } catch {
    return [];
  }
}

/**
 * Drop and rebuild the index from memory_embeddings for the active dim (and
 * model when given). Use after a provider/model switch — vectors from a
 * different model are not comparable in the same vec0 space. Returns the number
 * of rows indexed, or -1 when vec is unavailable.
 */
export function rebuildVecIndex(db: Database, opts?: { model?: string; dim?: number }): number {
  if (!getCapabilities().vec) return -1;
  const dim = opts?.dim ?? getActiveEmbedDim(db);
  try {
    db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
    if (!ensureVecTable(db, dim)) return -1;
    const where = opts?.model ? "WHERE dim=? AND model=?" : "WHERE dim=?";
    const params: Array<number | string> = opts?.model ? [dim, opts.model] : [dim];
    const rows = db
      .query<{ memory_id: number; embedding: Buffer }, Array<number | string>>(
        `SELECT memory_id, embedding FROM memory_embeddings ${where}`,
      )
      .all(...params);
    let n = 0;
    db.transaction(() => {
      for (const r of rows) {
        db.run(`INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (?, ?)`, [r.memory_id, r.embedding]);
        n++;
      }
    })();
    return n;
  } catch {
    return -1;
  }
}

/**
 * One-time backfill for DBs that have embeddings but an empty/absent vec index
 * (e.g. created before vec was wired in). Rebuilds the index only when it holds
 * zero rows yet memory_embeddings has rows at the active dim. Cheap no-op on
 * subsequent boots because vec0 shadow tables persist in the DB file. Returns
 * the number of rows indexed, 0 when nothing to do, or -1 when unavailable.
 */
export function backfillVecIndexIfEmpty(db: Database): number {
  if (!getCapabilities().vec) return -1;
  try {
    const dim = getActiveEmbedDim(db);
    if (!ensureVecTable(db, dim)) return -1;
    const indexed = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${VEC_TABLE}`).get();
    if ((indexed?.n ?? 0) > 0) return 0;
    const stored = db
      .query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM memory_embeddings WHERE dim=?`)
      .get(dim);
    if ((stored?.n ?? 0) === 0) return 0;
    return rebuildVecIndex(db, { dim });
  } catch {
    return -1;
  }
}
