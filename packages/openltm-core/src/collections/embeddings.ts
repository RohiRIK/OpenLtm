/**
 * collections/embeddings.ts — record vectors and hybrid record search.
 *
 * A record's vector embeds its search_text (collection name, key and
 * searchable values), scrubbed first, with the same provider memories use
 * (local llama.cpp by default). Vectors live on the row (records.embedding,
 * records.embedding_model); a write clears them and a later embed fills them,
 * so a slow or absent provider never blocks a put. Recall ranks records by
 * FTS and, when vectors exist, by cosine similarity too (reciprocal rank fusion).
 */
import type { Database } from "bun:sqlite";
import { getDb } from "../shared-db.js";
import { scrubForProvider, isEgressScrubFailed } from "../secretsScrubber.js";
import { blobToVec, cosineSimilarity, getEmbeddingProvider, vecToBlob } from "../embeddings.js";
import { searchRecords, type RecordHit } from "./query.js";
import { collectionsById, _toRecordView, type RecordRow } from "./store.js";

/** Minimum cosine similarity for a semantic record hit (same as memory recall). */
const SEMANTIC_MIN_SIMILARITY = 0.5;
/** Past this budget, record recall is FTS-only. */
const SEMANTIC_TIMEOUT_MS = 2_000;
/** Reciprocal rank fusion constant. */
const RRF_K = 60;

export type RecordSemanticSearch = (query: string, topN: number, project: string | null) => Promise<Array<{ id: number; similarity: number }>>;

let semanticOverride: RecordSemanticSearch | null = null;

/** Test seam: replace the record vector search (null restores the provider). */
export function _setRecordSemanticSearchForTesting(fn: RecordSemanticSearch | null): void {
  semanticOverride = fn;
}

/** False when the owner turned semantic search off (config or LTM_EMBED_PROVIDER=disabled). */
async function semanticEnabled(): Promise<boolean> {
  const { readConfigSync } = await import("../config.js");
  const cfg = readConfigSync();
  if (cfg.ltm?.semanticFallback === false) return false;
  const { explicitEmbedProvider } = await import("../providers/embeddingProvider.js");
  return (explicitEmbedProvider() ?? cfg.embeddings?.provider) !== "disabled";
}

/** Embed one record's search text and store the vector. Returns false when nothing was stored. */
export async function embedRecord(id: number, db: Database = getDb()): Promise<boolean> {
  if (!(await semanticEnabled())) return false;
  const row = db.query<{ search_text: string }, [number]>("SELECT search_text FROM records WHERE id=? AND status='active'").get(id);
  if (!row) return false;
  const text = scrubForProvider(row.search_text);
  if (isEgressScrubFailed(text)) return false;
  const provider = await getEmbeddingProvider();
  if (!(await provider.available())) return false;
  const vec = await provider.generate(text);
  if (!vec) return false;
  // Only if the row is unchanged since we read it: a newer put cleared it and owns the next embed.
  const res = db.run("UPDATE records SET embedding=?, embedding_model=? WHERE id=? AND search_text=?",
    [vecToBlob(vec), provider.model, id, row.search_text]);
  return res.changes > 0;
}

/** Fire-and-forget embed after a put; errors only log. */
export function scheduleRecordEmbedding(id: number, db: Database = getDb()): void {
  embedRecord(id, db).catch((err) => process.stderr.write(`[collections] embedding record ${id} failed: ${err}\n`));
}

/** Embed active records that have no vector for the current model. Returns how many were stored. */
export async function backfillRecordEmbeddings(db: Database = getDb(), max = 1000): Promise<number> {
  if (!(await semanticEnabled())) return 0;
  const provider = await getEmbeddingProvider();
  if (!(await provider.available())) return 0;
  let ids: number[];
  try {
    ids = db.query<{ id: number }, [string, number]>(
      "SELECT id FROM records WHERE status='active' AND (embedding IS NULL OR embedding_model IS NOT ?) ORDER BY id LIMIT ?",
    ).all(provider.model, max).map((r) => r.id);
  } catch {
    return 0; // pre-031 database
  }
  let done = 0;
  for (const id of ids) if (await embedRecord(id, db)) done++;
  return done;
}

/** Records whose vector is closest to `query`, among active collections visible from `project`. */
async function vectorRecordHits(query: string, topN: number, project: string | null, db: Database): Promise<Array<{ id: number; similarity: number }>> {
  const text = scrubForProvider(query);
  if (isEgressScrubFailed(text)) return [];
  const provider = await getEmbeddingProvider();
  if (!(await provider.available())) return [];
  const vec = await provider.generate(text);
  if (!vec) return [];
  const rows = db.query<{ id: number; embedding: Buffer }, [string, string]>(
    `SELECT r.id, r.embedding FROM records r JOIN collections c ON c.id = r.collection_id
      WHERE r.embedding IS NOT NULL AND r.embedding_model = ? AND r.status='active' AND c.status='active'
        AND (c.project_scope IS NULL OR c.project_scope = ?)`,
  ).all(provider.model, project ?? "");
  return rows
    .map((r) => ({ id: r.id, similarity: cosineSimilarity(vec, blobToVec(r.embedding)) }))
    .filter((h) => h.similarity >= SEMANTIC_MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}

/** Run the vector search within its time budget. Never rejects: failures yield []. */
async function semanticRecordHits(query: string, topN: number, project: string | null, db: Database): Promise<Array<{ id: number; similarity: number }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const search: RecordSemanticSearch | null = semanticOverride
      ?? ((await semanticEnabled()) ? (q, n, p) => vectorRecordHits(q, n, p, db) : null);
    if (!search) return [];
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SEMANTIC_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
    });
    return (await Promise.race([search(query, topN, project), timeout])) ?? [];
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Records for recall: FTS hits and vector hits fused by reciprocal rank. With
 * no vectors (no provider, or nothing embedded yet) this is plain FTS.
 */
export async function recallRecords(query: string, opts: { project?: string | null; limit?: number } = {}, db: Database = getDb()): Promise<RecordHit[]> {
  const limit = Math.max(1, opts.limit ?? 3);
  const project = opts.project ?? null;
  const fts = searchRecords(query, { project, limit: limit * 3 }, db);
  const semantic = await semanticRecordHits(query, limit * 3, project, db);
  if (semantic.length === 0) return fts.slice(0, limit);

  const score = new Map<number, number>();
  fts.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (RRF_K + i + 1)));
  semantic.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (RRF_K + i + 1)));
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);

  const byHit = new Map(fts.map((h) => [h.id, h]));
  const missing = ranked.map(([id]) => id).filter((id) => !byHit.has(id));
  if (missing.length > 0) {
    const cols = collectionsById(db);
    const rows = db.query<RecordRow, number[]>(`SELECT * FROM records WHERE id IN (${missing.map(() => "?").join(",")})`).all(...missing);
    for (const r of rows) {
      const c = cols.get(r.collection_id);
      if (c) byHit.set(r.id, { ..._toRecordView(c, r), rank: 0 });
    }
  }
  return ranked.flatMap(([id, s]) => {
    const hit = byHit.get(id);
    return hit ? [{ ...hit, rank: -s }] : [];
  });
}
