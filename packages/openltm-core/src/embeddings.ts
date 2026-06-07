/**
 * embeddings.ts — Provider-agnostic embedding utilities for LTM semantic search.
 * Embedding writes/reads now go through src/dao/embeddings.ts (memory_embeddings table).
 * Embedding generation now goes through src/providers/embeddingProvider.ts.
 * Falls back gracefully (returns null) when no provider is configured.
 */
import type { Database } from "bun:sqlite";
import type { EmbeddingProvider } from "./providers/embeddingProvider.js";
import { setEmbedding, listMemoryIdsMissingEmbedding } from "./dao/embeddings.js";

// --- Provider config (retained for LLM/auto-relate path) ---

type EmbedProvider = "gemini" | "openai" | "openrouter" | "cohere" | "ollama";

interface ProviderConfig {
  provider: EmbedProvider;
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

// Caches — stable within a process lifetime (restart required for config changes)
let _llmConfigCache: ProviderConfig | null | undefined = undefined;
let _embeddingProviderCache: Promise<EmbeddingProvider> | null = null;

/** Shared loader for both embed and llm provider configs. */
function loadConfig(type: "embed" | "llm"): ProviderConfig | null {
  try {
    const { getDb } = require("./shared-db.js") as typeof import("./shared-db.js");
    const db = getDb();
    const t = type;
    const KEYS = [
      `ltm.${t}.provider`,
      "ltm.gemini.apiKey", `ltm.gemini.${t}Model`,
      "ltm.openai.apiKey", `ltm.openai.${t}Model`,
      "ltm.openrouter.apiKey", `ltm.openrouter.${t}Model`,
      `ltm.cohere.apiKey`, `ltm.cohere.${t}Model`,
      `ltm.ollama.${t}Model`, "ltm.ollama.baseUrl",
    ];
    const placeholders = KEYS.map(() => "?").join(",");
    const rows = db.query<{ key: string; value: string }, string[]>(
      `SELECT key, value FROM settings WHERE key IN (${placeholders})`
    ).all(...KEYS);
    const s = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, string | undefined>;

    const envProvider = t === "embed" ? process.env.LTM_EMBED_PROVIDER : process.env.LTM_LLM_PROVIDER;
    const provider = (envProvider ?? s[`ltm.${t}.provider`] ?? "gemini") as EmbedProvider;

    const DEFAULTS: Record<EmbedProvider, { model: string }> = {
      gemini:     { model: t === "embed" ? "gemini-embedding-2-preview" : "gemini-2.0-flash-lite" },
      openai:     { model: t === "embed" ? "text-embedding-3-small" : "gpt-4o-mini" },
      openrouter: { model: t === "embed" ? "openai/text-embedding-3-large" : "google/gemini-2.0-flash-001" },
      cohere:     { model: t === "embed" ? "embed-v4.0" : "command-r-plus" },
      ollama:     { model: t === "embed" ? "nomic-embed-text" : "llama3.2" },
    };

    switch (provider) {
      case "gemini":
        return { provider, apiKey: process.env.GEMINI_API_KEY ?? s["ltm.gemini.apiKey"], model: s[`ltm.gemini.${t}Model`] ?? DEFAULTS.gemini.model };
      case "openai":
        return { provider, apiKey: process.env.OPENAI_API_KEY ?? s["ltm.openai.apiKey"], model: s[`ltm.openai.${t}Model`] ?? DEFAULTS.openai.model };
      case "openrouter":
        return { provider, apiKey: process.env.OPENROUTER_API_KEY ?? s["ltm.openrouter.apiKey"], model: s[`ltm.openrouter.${t}Model`] ?? DEFAULTS.openrouter.model, baseUrl: "https://openrouter.ai/api/v1" };
      case "cohere":
        return { provider, apiKey: process.env.COHERE_API_KEY ?? s["ltm.cohere.apiKey"], model: s[`ltm.cohere.${t}Model`] ?? DEFAULTS.cohere.model };
      case "ollama":
        return { provider, model: s[`ltm.ollama.${t}Model`] ?? DEFAULTS.ollama.model, baseUrl: s["ltm.ollama.baseUrl"] ?? "http://localhost:11434" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Returns the embedding provider, lazily initialised once per process. */
async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!_embeddingProviderCache) {
    _embeddingProviderCache = (async () => {
      const [{ loadConfig }, { loadProvider }] = await Promise.all([
        import("./config.js"),
        import("./providers/embeddingProvider.js"),
      ]);
      const cfg = await loadConfig();
      return loadProvider(cfg.embeddings);
    })();
  }
  return _embeddingProviderCache;
}

export function getLlmConfig(): ProviderConfig | null {
  if (_llmConfigCache !== undefined) return _llmConfigCache;
  _llmConfigCache = loadConfig("llm");
  return _llmConfigCache;
}

// --- Math utils ---

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function vecToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer);
}

export function blobToVec(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

// --- Provider-specific embed implementations ---

// Cached Gemini client + the key it was initialized with
interface GeminiGenerativeModel {
  embedContent(text: string): Promise<{ embedding: { values: number[] } }>;
}
interface GeminiAIClient {
  getGenerativeModel(params: { model: string }): GeminiGenerativeModel;
}
let _genAI: GeminiAIClient | null = null;
let _genAIKey: string | undefined;

async function embedGemini(text: string, cfg: ProviderConfig): Promise<Float32Array | null> {
  if (!cfg.apiKey) return null;
  if (!_genAI || _genAIKey !== cfg.apiKey) {
    // Dynamic import to avoid compile-time dependency on optional package
    const genAiModule = await (Function('return import("@google/generative-ai")')() as Promise<{
      GoogleGenerativeAI: new (apiKey: string) => GeminiAIClient;
    }>);
    const { GoogleGenerativeAI } = genAiModule;
    _genAI = new GoogleGenerativeAI(cfg.apiKey);
    _genAIKey = cfg.apiKey;
  }
  const model = _genAI.getGenerativeModel({ model: cfg.model });
  const result = await model.embedContent(text);
  return new Float32Array(result.embedding.values);
}

async function embedOpenAICompat(text: string, cfg: ProviderConfig): Promise<Float32Array | null> {
  if (!cfg.apiKey) return null;
  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, input: text }),
  });
  if (!res.ok) throw new Error(`${cfg.provider} API error: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data: Array<{ embedding: number[] }> };
  return new Float32Array(json.data[0]!.embedding);
}

async function embedCohere(text: string, cfg: ProviderConfig): Promise<Float32Array | null> {
  if (!cfg.apiKey) return null;
  const res = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: { "Authorization": `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, texts: [text], input_type: "search_document", embedding_types: ["float"] }),
  });
  if (!res.ok) throw new Error(`cohere API error: ${res.status} ${await res.text()}`);
  const json = await res.json() as { embeddings: { float: number[][] } };
  return new Float32Array(json.embeddings.float[0]!);
}

async function embedOllama(text: string, cfg: ProviderConfig): Promise<Float32Array | null> {
  const res = await fetch(`${cfg.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, input: text }),
  });
  if (!res.ok) throw new Error(`ollama API error: ${res.status} ${await res.text()}`);
  const json = await res.json() as { embeddings: number[][] };
  return new Float32Array(json.embeddings[0]!);
}

// --- Public API ---

/**
 * Embed text using the configured provider (from config.json embeddings block).
 * Returns null when provider is disabled or the API call fails.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  try {
    const provider = await getEmbeddingProvider();
    if (!await provider.available()) return null;
    return provider.generate(text);
  } catch (e) {
    process.stderr.write(`[embeddings] embedText error: ${e}\n`);
    return null;
  }
}

/**
 * Embed a memory by ID and write the embedding to the memory_embeddings table.
 */
export async function embedMemory(db: Database, id: number): Promise<void> {
  const row = db.query<{ content: string }, [number]>(
    `SELECT content FROM memories WHERE id=?`
  ).get(id);
  if (!row) return;

  const provider = await getEmbeddingProvider();
  if (!await provider.available()) return;

  const vec = await provider.generate(row.content);
  if (!vec) return;

  await setEmbedding(db, id, vecToBlob(vec), provider.model, provider.dim);
}

/**
 * Back-fill: embed all active memories that have no row in memory_embeddings.
 */
export async function backfill(db: Database): Promise<void> {
  const provider = await getEmbeddingProvider();
  if (!await provider.available()) {
    process.stderr.write(`[embeddings] Back-fill skipped: provider '${provider.name}' not available\n`);
    return;
  }

  const ids = listMemoryIdsMissingEmbedding(db, 1000);
  process.stderr.write(`[embeddings] Back-filling ${ids.length} memories...\n`);

  const BATCH = 20;
  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    await Promise.all(batch.map(async id => {
      const row = db.query<{ content: string }, [number]>(
        `SELECT content FROM memories WHERE id=?`
      ).get(id);
      if (!row) return;
      const vec = await provider.generate(row.content);
      if (vec) {
        await setEmbedding(db, id, vecToBlob(vec), provider.model, provider.dim);
        done++;
      }
    }));
    process.stderr.write(`[embeddings] ${Math.min(i + BATCH, ids.length)}/${ids.length} done\n`);
    if (i + BATCH < ids.length) await Bun.sleep(200);
  }
  process.stderr.write(`[embeddings] Back-fill complete: ${done}/${ids.length} embedded\n`);
}

// --- Semantic similarity search ---

export type SimilarMemory = { id: number; content: string; similarity: number };

/**
 * Find the top-N most similar memories to the given text using stored embeddings.
 */
export async function getSimilarMemories(text: string, topN = 5, threshold = 0.5): Promise<SimilarMemory[]> {
  const vec = await embedText(text);
  if (!vec) return [];

  const { getDb } = await import("./shared-db.js");
  const db = getDb();

  // Fast path: sqlite-vec vec0 KNN. Over-fetch so post-filtering on status and
  // threshold still yields topN. Falls through to brute force when the index is
  // unavailable or empty (e.g. a DB that predates the vec backfill).
  const { getCapabilities } = await import("./extensions.js");
  if (getCapabilities().vec) {
    const { knnVec } = await import("./vec/index.js");
    const hits = knnVec(db, vecToBlob(vec), Math.max(topN * 4, topN + 10));
    if (hits.length > 0) {
      const byId = new Map(hits.map(h => [h.id, h.similarity]));
      const ids = hits.map(h => h.id);
      const placeholders = ids.map(() => "?").join(",");
      const rows = db.query<{ id: number; content: string }, number[]>(
        `SELECT id, content FROM memories WHERE status='active' AND id IN (${placeholders})`
      ).all(...ids);
      return rows
        .map(row => ({ id: row.id, content: row.content, similarity: byId.get(row.id) ?? 0 }))
        .filter(r => r.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topN);
    }
  }

  // Brute-force JS cosine fallback.
  const rows = db.query<{ id: number; content: string; embedding: Buffer }, []>(
    `SELECT m.id, m.content, e.embedding
     FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id
     WHERE m.status = 'active'`
  ).all();

  return rows
    .map(row => ({ id: row.id, content: row.content, similarity: cosineSimilarity(vec, blobToVec(row.embedding)) }))
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}

// --- Relation classification ---

type AutoRelationType = "supports" | "contradicts" | "refines" | "related_to";

const CLASSIFY_PROMPT = `You are a memory relation classifier. Given two facts (A and B), respond with exactly ONE word:
- "supports" — B reinforces or agrees with A
- "contradicts" — B conflicts with or contradicts A
- "refines" — B adds detail or nuance to A
- "related_to" — B is on the same topic but no clear support/conflict/refinement
- "none" — B has no meaningful relation to A

Respond with exactly one of: supports, contradicts, refines, related_to, none`;

const VALID_RELATIONS = new Set<string>(["supports", "contradicts", "refines", "related_to"]);

export async function callLlm(
  cfg: ProviderConfig,
  userMessage: string,
  options?: { systemPrompt?: string; maxTokens?: number; raw?: boolean },
): Promise<string | null> {
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: options?.systemPrompt ?? CLASSIFY_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: options?.maxTokens ?? 10,
    temperature: 0,
  };

  try {
    let url: string;
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (cfg.provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
      headers["Authorization"] = `Bearer ${cfg.apiKey ?? ""}`;
    } else if (cfg.provider === "ollama") {
      url = `${cfg.baseUrl}/v1/chat/completions`;
    } else {
      // openai / openrouter
      url = cfg.baseUrl ? `${cfg.baseUrl}/chat/completions` : "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${cfg.apiKey ?? ""}`;
    }

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) return null;
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? null;
    if (content === null) return null;
    return options?.raw ? content.trim() : content.trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify the relation between two memory strings using a lightweight LLM call.
 * Returns null if no LLM provider configured or call fails.
 */
export async function classifyRelation(a: string, b: string): Promise<AutoRelationType | null> {
  const cfg = getLlmConfig();
  if (!cfg) return null;

  const userMessage = `Memory A: ${a}\n\nMemory B: ${b}`;
  const raw = await callLlm(cfg, userMessage);
  if (!raw || !VALID_RELATIONS.has(raw)) return null;
  return raw as AutoRelationType;
}

// CLI: bun embeddings.ts --backfill
if (import.meta.main) {
  void (async () => {
    const args = process.argv.slice(2);
    if (args.includes("--backfill")) {
      const { getDb } = await import("./shared-db.js");
      const db = getDb();
      await backfill(db);
    } else {
      process.stderr.write("Usage: bun embeddings.ts --backfill\n");
    }
  })();
}
