/**
 * ollama.ts — Ollama local provider for embeddings and LLM chat.
 * Connects to a local Ollama instance (default http://localhost:11434).
 * No API key required — fully local inference.
 */
import { getSetting } from "../../shared-db.js";
import {
  SETTING_KEYS,
  getDefault,
  type ChatInput,
  type ChatResult,
  type EmbedInput,
  type EmbedResult,
  type EmbeddingProvider,
  type EmbeddingVector,
  type LLMProvider,
} from "./types.js";

function getBaseUrl(): string {
  return (
    getSetting(SETTING_KEYS.OLLAMA_BASE_URL) ||
    process.env.OLLAMA_BASE_URL ||
    getDefault(SETTING_KEYS.OLLAMA_BASE_URL)
  );
}

function getEmbedModel(): string {
  return (
    getSetting(SETTING_KEYS.OLLAMA_EMBED_MODEL) ||
    getDefault(SETTING_KEYS.OLLAMA_EMBED_MODEL)
  );
}

function getLlmModel(): string {
  return (
    getSetting(SETTING_KEYS.OLLAMA_LLM_MODEL) ||
    getDefault(SETTING_KEYS.OLLAMA_LLM_MODEL)
  );
}

/**
 * Verify Ollama is reachable and the specified model is pulled.
 * Shared between embedding and LLM providers.
 */
async function verifyModel(model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const baseUrl = getBaseUrl();

    const pingRes = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!pingRes.ok) {
      return { ok: false, error: `Ollama not reachable at ${baseUrl}` };
    }

    const tags = (await pingRes.json()) as {
      models: Array<{ name: string }>;
    };
    const available = tags.models.map((m) => m.name.split(":")[0]);
    if (!available.includes(model.split(":")[0])) {
      return {
        ok: false,
        error: `Model "${model}" not found. Available: ${available.join(", ")}. Run: ollama pull ${model}`,
      };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const ollamaEmbedding: EmbeddingProvider = {
  name: "ollama",

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const baseUrl = getBaseUrl();
    const model = getEmbedModel();

    // Ollama doesn't support batch embedding natively; we call per-text
    // and parallelize with Promise.all (local, so latency is low)
    const results = await Promise.all(
      input.texts.map(async (text) => {
        const res = await fetch(`${baseUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: text }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Ollama embed failed (${res.status}): ${body}`);
        }

        const data = (await res.json()) as {
          embeddings: number[][];
        };

        const embedding = data.embeddings[0];
        if (!embedding) throw new Error("Ollama returned empty embedding");
        return embedding;
      }),
    );

    const vectors: EmbeddingVector[] = results.map(
      (v) => new Float32Array(v),
    );
    const dimensions = vectors[0]?.length ?? 0;

    return {
      vectors,
      model,
      dimensions,
      // Ollama doesn't report token usage for embeddings
      totalTokens: 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    return verifyModel(getEmbedModel());
  },
};

export const ollamaLLM: LLMProvider = {
  name: "ollama",

  async chat(input: ChatInput): Promise<ChatResult> {
    const baseUrl = getBaseUrl();
    const model = getLlmModel();

    const body: Record<string, unknown> = {
      model,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        num_predict: input.maxTokens ?? 1024,
        temperature: input.temperature ?? 0.1,
      },
    };

    if (input.jsonMode) {
      body.format = "json";
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      message: { content: string };
      model: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content ?? "",
      model: data.model || model,
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    return verifyModel(getLlmModel());
  },
};
