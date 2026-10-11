/**
 * janitor/providers/llamacpp.ts — janitor embedding adapter for llama-server.
 * Same endpoint as providers/llamacpp.ts. Embed failures return no vectors
 * so a down server degrades to FTS instead of throwing on the default path.
 */
import { getSetting } from "../../shared-db.js";
import { probeLlamaCpp, llamaCppBaseUrl, llamaCppModel, LLAMACPP_DEFAULT_DIM } from "../../providers/llamacpp.js";
import {
  SETTING_KEYS,
  getDefault,
  type EmbedInput,
  type EmbedResult,
  type EmbeddingProvider,
  type EmbeddingVector,
} from "./types.js";

function baseUrl(): string {
  return llamaCppBaseUrl({
    baseUrl: getSetting(SETTING_KEYS.LLAMACPP_BASE_URL) || getDefault(SETTING_KEYS.LLAMACPP_BASE_URL),
  });
}

function model(): string {
  return llamaCppModel({
    model: process.env["LTM_EMBED_MODEL"]
      || getSetting(SETTING_KEYS.LLAMACPP_EMBED_MODEL)
      || getDefault(SETTING_KEYS.LLAMACPP_EMBED_MODEL),
  });
}

async function embedOne(text: string, embedModel: string, url: string): Promise<EmbeddingVector | null> {
  const res = await fetch(`${url}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const values = json?.data?.[0]?.embedding;
  if (!values || values.length === 0) return null;
  return new Float32Array(values);
}

export const llamacppEmbedding: EmbeddingProvider = {
  name: "llamacpp",

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const url = baseUrl();
    const embedModel = model();
    if (!await probeLlamaCpp(url)) {
      return { vectors: [], model: embedModel, dimensions: LLAMACPP_DEFAULT_DIM, totalTokens: 0 };
    }
    // Callers map vectors[i] → texts[i], so a gap would shift every later
    // vector onto the wrong memory. Stop at the first miss and return the
    // aligned prefix; the rest stay un-embedded and are retried next run.
    const vectors: EmbeddingVector[] = [];
    for (const text of input.texts) {
      let vec: EmbeddingVector | null = null;
      try {
        vec = await embedOne(text, embedModel, url);
      } catch {
        vec = null;
      }
      if (!vec) break;
      vectors.push(vec);
    }
    return {
      vectors,
      model: embedModel,
      dimensions: vectors[0]?.length ?? LLAMACPP_DEFAULT_DIM,
      totalTokens: 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    const url = baseUrl();
    const ok = await probeLlamaCpp(url);
    return ok
      ? { ok: true }
      : { ok: false, error: `llama-server not reachable at ${url}. Start it with: llama-server -m bge-m3.gguf --embeddings --pooling mean --port 8080` };
  },
};
