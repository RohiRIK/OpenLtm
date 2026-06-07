/**
 * dedup.ts — Semantic deduplication of memories.
 * Uses embedding similarity to find and merge duplicate memories.
 * Two modes: automatic (high-confidence merges) and suggested (for review).
 */
import { getDb, getSetting } from "../shared-db.js";
import {
  blobToVector,
  cosineSimilarity,
} from "./embeddings.js";
import type { EmbeddingVector } from "./providers/types.js";
import { anthropicLLM } from "./providers/anthropic.js";
import { cohereLLM } from "./providers/cohere.js";
import { geminiLLM } from "./providers/gemini.js";
import { ollamaLLM } from "./providers/ollama.js";
import { openaiLLM } from "./providers/openai.js";
import { openrouterLLM } from "./providers/openrouter.js";
import {
  SETTING_KEYS,
  getDefault,
  type LLMProvider,
  type ProviderType,
} from "./providers/types.js";

/** Resolve the active LLM provider from settings. */
function getLLMProvider(): LLMProvider {
  const provider = (getSetting(SETTING_KEYS.LLM_PROVIDER) ||
    getDefault(SETTING_KEYS.LLM_PROVIDER)) as ProviderType;

  switch (provider) {
    case "gemini":      return geminiLLM;
    case "openai":      return openaiLLM;
    case "anthropic":   return anthropicLLM;
    case "cohere":      return cohereLLM;
    case "openrouter":  return openrouterLLM;
    case "ollama":      return ollamaLLM;
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/** A pair of memories that may be duplicates. */
export interface DedupCandidate {
  memoryA: { id: number; content: string; category: string };
  memoryB: { id: number; content: string; category: string };
  similarity: number;
  /** LLM verdict: "duplicate", "related", "distinct" */
  verdict?: string;
  /** LLM reasoning for the verdict */
  reasoning?: string;
  /** Suggested merged content (if duplicate) */
  mergedContent?: string;
}

export interface DedupResult {
  /** Total pairs compared. */
  pairsCompared: number;
  /** Candidate duplicates found. */
  candidates: DedupCandidate[];
  /** Number of auto-merged pairs (high confidence). */
  autoMerged: number;
}

/**
 * Scan all active memories with embeddings and find potential duplicates.
 * Uses a two-phase approach:
 * 1. Vector similarity to find candidates (fast, O(n^2) but n is small)
 * 2. Optional LLM verification for borderline cases
 *
 * @param similarityThreshold - Minimum cosine similarity to consider (default 0.85)
 * @param useLLM - Whether to use LLM for verification (default false)
 */
export async function findDuplicates(
  similarityThreshold = 0.85,
  useLLM = false,
): Promise<DedupResult> {
  const db = getDb();
  const result: DedupResult = {
    pairsCompared: 0,
    candidates: [],
    autoMerged: 0,
  };

  // Load all active memories with embeddings
  const memories = db
    .query<
      { id: number; content: string; category: string; embedding: Buffer },
      []
    >(
      `SELECT id, content, category, embedding FROM memories
       WHERE embedding IS NOT NULL AND status = 'active'
       ORDER BY id ASC`,
    )
    .all();

  if (memories.length < 2) return result;

  // Convert embeddings upfront
  const vectors: Map<number, EmbeddingVector> = new Map();
  for (const mem of memories) {
    vectors.set(mem.id, blobToVector(mem.embedding));
  }

  // Pairwise comparison (upper triangle only)
  for (let i = 0; i < memories.length; i++) {
    const memA = memories[i]!;
    for (let j = i + 1; j < memories.length; j++) {
      const memB = memories[j]!;
      result.pairsCompared++;
      const vecA = vectors.get(memA.id)!;
      const vecB = vectors.get(memB.id)!;
      const similarity = cosineSimilarity(vecA, vecB);

      if (similarity >= similarityThreshold) {
        const candidate: DedupCandidate = {
          memoryA: {
            id: memA.id,
            content: memA.content,
            category: memA.category,
          },
          memoryB: {
            id: memB.id,
            content: memB.content,
            category: memB.category,
          },
          similarity,
        };

        // Use LLM to verify and suggest merge (per-pair errors are non-fatal)
        if (useLLM) {
          try {
            const llmResult = await verifyWithLLM(candidate);
            candidate.verdict = llmResult.verdict;
            candidate.reasoning = llmResult.reasoning;
            candidate.mergedContent = llmResult.mergedContent;
          } catch {
            // LLM unavailable — save candidate without verdict
          }
        }

        result.candidates.push(candidate);
      }
    }
  }

  // Sort by similarity descending
  result.candidates.sort((a, b) => b.similarity - a.similarity);

  return result;
}

/** Use LLM to verify a duplicate candidate and suggest merged content. */
async function verifyWithLLM(candidate: DedupCandidate): Promise<{
  verdict: string;
  reasoning: string;
  mergedContent?: string;
}> {
  const llm = getLLMProvider();

  const response = await llm.chat({
    messages: [
      {
        role: "system",
        content: `You are a memory deduplication assistant. Given two memories, determine if they are duplicates, related, or distinct.
Respond in JSON format: { "verdict": "duplicate"|"related"|"distinct", "reasoning": "brief explanation", "mergedContent": "merged version if duplicate" }
- "duplicate": Same core insight, possibly different wording. Provide mergedContent that combines both.
- "related": Complementary but distinct insights. No mergedContent.
- "distinct": Unrelated despite surface similarity. No mergedContent.`,
      },
      {
        role: "user",
        content: `Memory A [${candidate.memoryA.category}]: ${candidate.memoryA.content}\n\nMemory B [${candidate.memoryB.category}]: ${candidate.memoryB.content}\n\nCosine similarity: ${candidate.similarity.toFixed(3)}`,
      },
    ],
    jsonMode: true,
    temperature: 0.1,
    maxTokens: 300,
  });

  try {
    const parsed = JSON.parse(response.content) as {
      verdict: string;
      reasoning: string;
      mergedContent?: string;
    };
    return {
      verdict: parsed.verdict || "distinct",
      reasoning: parsed.reasoning || "",
      mergedContent: parsed.mergedContent,
    };
  } catch {
    return { verdict: "distinct", reasoning: "Failed to parse LLM response" };
  }
}

/** Parse a "dedup:<idA>:<idB>" source string. Returns null if not a dedup source. */
export function parseDedupSource(source: string): { idA: number; idB: number } | null {
  if (!source.startsWith("dedup:")) return null;
  const parts = source.split(":");
  if (parts.length !== 3) return null;
  const idA = parseInt(parts[1]!, 10);
  const idB = parseInt(parts[2]!, 10);
  if (isNaN(idA) || isNaN(idB)) return null;
  return { idA, idB };
}

/**
 * Persist dedup candidates as pending memories for UI review.
 * source encodes "dedup:<idA>:<idB>" so the approve route can call mergeMemories.
 */
export function saveDedupCandidates(candidates: DedupCandidate[]): number {
  const db = getDb();
  let saved = 0;

  for (const c of candidates) {
    const source = `dedup:${c.memoryA.id}:${c.memoryB.id}`;
    // Skip if already pending for this pair
    const exists = db
      .query<{ id: number }, [string]>(
        "SELECT id FROM memories WHERE source = ? AND status = 'pending'",
      )
      .get(source);
    if (exists) continue;

    const pct = Math.round(c.similarity * 100);
    const verdict = c.verdict ? ` | ${c.verdict}` : "";
    const reasoning = c.reasoning ? `\nWhy: ${c.reasoning}` : "";
    const suggested = c.mergedContent ? `\nSuggested merge: ${c.mergedContent}` : "";
    const mergedContent = c.mergedContent
      ? `[${pct}% similar${verdict}]${reasoning}${suggested}\n\nA: ${c.memoryA.content}\nB: ${c.memoryB.content}`
      : `[${pct}% similar — no LLM verdict]\nA: ${c.memoryA.content}\nB: ${c.memoryB.content}`;

    db.run(
      `INSERT INTO memories (content, category, importance, confidence, source, project_scope, dedup_key, status)
       VALUES (?, ?, 3, ?, ?, NULL, NULL, 'pending')`,
      [mergedContent, c.memoryA.category, c.similarity, source],
    );
    saved++;
  }

  return saved;
}

/**
 * Merge two memories: keep the one with higher importance/confidence,
 * supersede the other, and optionally update content.
 */
export function mergeMemories(
  keepId: number,
  supersededId: number,
  mergedContent?: string,
): void {
  const db = getDb();

  db.transaction(() => {
    // Optionally update the kept memory's content
    if (mergedContent) {
      db.run("UPDATE memories SET content = ? WHERE id = ?", [
        mergedContent,
        keepId,
      ]);
    }

    // Mark the other as superseded
    db.run("UPDATE memories SET status = 'superseded' WHERE id = ?", [
      supersededId,
    ]);

    // Create a supersedes relation
    db.run(
      `INSERT OR IGNORE INTO memory_relations (source_memory_id, target_memory_id, relationship_type)
       VALUES (?, ?, 'supersedes')`,
      [keepId, supersededId],
    );

    // Transfer any tags from superseded to kept
    db.run(
      `INSERT OR IGNORE INTO memory_tags (memory_id, tag_id)
       SELECT ?, tag_id FROM memory_tags WHERE memory_id = ?`,
      [keepId, supersededId],
    );

    // Repoint any relations targeting the superseded memory.
    // Delete rows that would collide on the unique constraint before updating.
    db.run(
      `DELETE FROM memory_relations
       WHERE target_memory_id = ? AND source_memory_id != ?
         AND EXISTS (
           SELECT 1 FROM memory_relations r2
           WHERE r2.target_memory_id = ?
             AND r2.source_memory_id = memory_relations.source_memory_id
             AND r2.relationship_type = memory_relations.relationship_type
         )`,
      [supersededId, keepId, keepId],
    );
    db.run(
      `UPDATE memory_relations SET target_memory_id = ?
       WHERE target_memory_id = ? AND source_memory_id != ?`,
      [keepId, supersededId, keepId],
    );
    db.run(
      `DELETE FROM memory_relations
       WHERE source_memory_id = ? AND target_memory_id != ?
         AND EXISTS (
           SELECT 1 FROM memory_relations r2
           WHERE r2.source_memory_id = ?
             AND r2.target_memory_id = memory_relations.target_memory_id
             AND r2.relationship_type = memory_relations.relationship_type
         )`,
      [supersededId, keepId, keepId],
    );
    db.run(
      `UPDATE memory_relations SET source_memory_id = ?
       WHERE source_memory_id = ? AND target_memory_id != ?`,
      [keepId, supersededId, keepId],
    );

    // Repoint context_items
    db.run(
      "UPDATE context_items SET memory_id = ? WHERE memory_id = ?",
      [keepId, supersededId],
    );

    // Boost confidence of kept memory
    db.run(
      `UPDATE memories SET confidence = MIN(1.0, confidence + 0.1),
       confirm_count = confirm_count + 1,
       last_confirmed_at = datetime('now')
       WHERE id = ?`,
      [keepId],
    );
  })();
}
