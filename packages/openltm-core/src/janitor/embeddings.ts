/**
 * embeddings.ts — Embedding generation + cosine similarity for semantic search.
 * Stores embeddings in the memory_embeddings side-table (since migration 010).
 * Provider-agnostic: delegates to whichever EmbeddingProvider is configured.
 */
import { getDb, getSetting } from "../shared-db.js";
import { setEmbedding, getEmbedding, listMemoryIdsMissingEmbedding } from "../dao/embeddings.js";
import { cohereEmbedding } from "./providers/cohere.js";
import { geminiEmbedding } from "./providers/gemini.js";
import { ollamaEmbedding } from "./providers/ollama.js";
import { openaiEmbedding } from "./providers/openai.js";
import { openrouterEmbedding } from "./providers/openrouter.js";
import {
  SETTING_KEYS,
  getDefault,
  type EmbeddingProvider,
  type EmbeddingVector,
  type ProviderType,
} from "./providers/types.js";

/** Resolve the active embedding provider from settings. */
export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = (getSetting(SETTING_KEYS.EMBED_PROVIDER) ||
    getDefault(SETTING_KEYS.EMBED_PROVIDER)) as ProviderType;

  switch (provider) {
    case "gemini":
      return geminiEmbedding;
    case "openrouter":
      return openrouterEmbedding;
    case "ollama":
      return ollamaEmbedding;
    case "openai":
      return openaiEmbedding;
    case "cohere":
      return cohereEmbedding;
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

/** Convert Float32Array to Buffer for SQLite BLOB storage. */
export function vectorToBlob(vector: EmbeddingVector): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/** Convert SQLite BLOB back to Float32Array. */
export function blobToVector(blob: Buffer): EmbeddingVector {
  const arrayBuf = blob.buffer.slice(
    blob.byteOffset,
    blob.byteOffset + blob.byteLength,
  );
  return new Float32Array(arrayBuf);
}

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1.0 and 1.0 (1.0 = identical).
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) {
    // Incompatible embeddings (model changed) — treat as unrelated
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Generate and store embeddings for memories that don't have them yet.
 * Processes in batches to stay within provider limits.
 * @returns Number of memories that were embedded.
 */
export async function embedMissingMemories(
  batchSize = 50,
): Promise<number> {
  const db = getDb();
  const provider = getEmbeddingProvider();

  const missingIds = listMemoryIdsMissingEmbedding(db, 10_000);
  if (missingIds.length === 0) return 0;

  // Fetch content for missing IDs in one query
  const placeholders = missingIds.map(() => "?").join(",");
  const rows = db
    .query<{ id: number; content: string }, number[]>(
      `SELECT id, content FROM memories WHERE id IN (${placeholders}) AND status IN ('active', 'pending') ORDER BY id ASC`,
    )
    .all(...missingIds);

  if (rows.length === 0) return 0;

  let totalEmbedded = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const texts = batch.map((r) => r.content);

    const result = await provider.embed({ texts });

    for (let j = 0; j < batch.length; j++) {
      const vector = result.vectors[j];
      if (!vector) continue;
      const blob = vectorToBlob(vector);
      await setEmbedding(db, batch[j]!.id, blob, result.model, result.dimensions);
    }

    totalEmbedded += batch.length;
  }

  return totalEmbedded;
}

/**
 * Find memories semantically similar to a query string.
 * @param query - Text to search for
 * @param topK - Max number of results
 * @param minSimilarity - Minimum cosine similarity threshold (0.0 to 1.0)
 * @returns Array of {id, content, similarity} sorted by similarity desc
 */
export async function semanticSearch(
  query: string,
  topK = 10,
  minSimilarity = 0.5,
): Promise<Array<{ id: number; content: string; category: string; importance: number; project_scope: string | null; similarity: number }>> {
  const db = getDb();
  const provider = getEmbeddingProvider();

  // Generate embedding for the query
  const result = await provider.embed({ texts: [query] });
  const queryVector = result.vectors[0];
  if (!queryVector) throw new Error("Failed to generate query embedding");

  // Load all memories that have embeddings (join with side-table)
  const rows = db
    .query<
      { id: number; content: string; category: string; importance: number; project_scope: string | null; embedding: Buffer },
      []
    >(
      `SELECT m.id, m.content, m.category, m.importance, m.project_scope, e.embedding
       FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.status = 'active'`,
    )
    .all();

  // Compute similarities
  const scored = rows
    .map((row) => {
      const memVector = blobToVector(row.embedding);
      const similarity = cosineSimilarity(queryVector, memVector);
      return { id: row.id, content: row.content, category: row.category, importance: row.importance, project_scope: row.project_scope, similarity };
    })
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored;
}

/**
 * Find the most similar memory to a given memory ID.
 * Used by dedup to find potential duplicates.
 * @returns Array of {id, content, similarity} sorted desc, excluding the source memory
 */
export function findSimilarMemories(
  memoryId: number,
  topK = 5,
  minSimilarity = 0.8,
): Array<{ id: number; content: string; category: string; similarity: number }> {
  const db = getDb();

  const sourceBlob = getEmbedding(db, memoryId);
  if (!sourceBlob) return [];

  const sourceVector = blobToVector(sourceBlob);

  const rows = db
    .query<
      { id: number; content: string; category: string; embedding: Buffer },
      [number]
    >(
      `SELECT m.id, m.content, m.category, e.embedding
       FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.id != ? AND m.status = 'active'`,
    )
    .all(memoryId);

  return rows
    .map((row) => {
      const memVector = blobToVector(row.embedding);
      const similarity = cosineSimilarity(sourceVector, memVector);
      return { id: row.id, content: row.content, category: row.category, similarity };
    })
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
