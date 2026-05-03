/**
 * dao/embeddings.ts — DAO for the memory_embeddings side table.
 * All reads are synchronous; writes are serialised through writeQueue.
 */
import type { Database } from "bun:sqlite";
import { writeQueue } from "../lib/writeQueue.js";

interface EmbeddingRow {
  memory_id: number;
  embedding: Buffer;
  model: string;
  dim: number;
  created_at: string;
}

/** Return the stored embedding blob for a memory, or null if none exists. */
export function getEmbedding(db: Database, memoryId: number): Buffer | null {
  const row = db.query<{ embedding: Buffer }, [number]>(
    `SELECT embedding FROM memory_embeddings WHERE memory_id=?`
  ).get(memoryId);
  return row?.embedding ?? null;
}

/** Upsert an embedding for a memory. Serialised through the write queue. */
export function setEmbedding(
  db: Database,
  memoryId: number,
  blob: Buffer,
  model: string,
  dim: number,
): Promise<void> {
  return writeQueue.enqueue(() => {
    db.run(
      `INSERT INTO memory_embeddings (memory_id, embedding, model, dim, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(memory_id) DO UPDATE SET
         embedding=excluded.embedding,
         model=excluded.model,
         dim=excluded.dim,
         created_at=excluded.created_at`,
      [memoryId, blob, model, dim],
    );
  });
}

/** Remove the embedding for a memory. Serialised through the write queue. */
export function deleteEmbedding(db: Database, memoryId: number): Promise<void> {
  return writeQueue.enqueue(() => {
    db.run(`DELETE FROM memory_embeddings WHERE memory_id=?`, [memoryId]);
  });
}

/**
 * Return memory IDs that have no entry in memory_embeddings.
 * Used by the janitor backfill job and SessionStart hint.
 */
export function listMemoryIdsMissingEmbedding(db: Database, limit = 100): number[] {
  const rows = db.query<{ id: number }, [number]>(
    `SELECT m.id FROM memories m
     LEFT JOIN memory_embeddings e ON e.memory_id = m.id
     WHERE m.status = 'active' AND e.memory_id IS NULL
     ORDER BY m.importance DESC, m.created_at DESC
     LIMIT ?`
  ).all(limit);
  return rows.map(r => r.id);
}

export type { EmbeddingRow };
