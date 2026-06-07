/**
 * openrouter.ts — OpenRouter provider for embeddings and LLM chat.
 * Uses OpenAI-compatible API endpoints.
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

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

function getApiKey(): string {
  const key =
    getSetting(SETTING_KEYS.OPENROUTER_API_KEY) ||
    process.env.OPENROUTER_API_KEY ||
    "";
  if (!key) throw new Error("OpenRouter API key not configured. Set it in Settings or OPENROUTER_API_KEY env var.");
  return key;
}

function getEmbedModel(): string {
  return (
    getSetting(SETTING_KEYS.OPENROUTER_EMBED_MODEL) ||
    getDefault(SETTING_KEYS.OPENROUTER_EMBED_MODEL)
  );
}

function getLlmModel(): string {
  return (
    getSetting(SETTING_KEYS.OPENROUTER_LLM_MODEL) ||
    getDefault(SETTING_KEYS.OPENROUTER_LLM_MODEL)
  );
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/rohirikman/claude-ltm",
    "X-Title": "Claude LTM Janitor",
  };
}

export const openrouterEmbedding: EmbeddingProvider = {
  name: "openrouter",

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const apiKey = getApiKey();
    const model = getEmbedModel();

    const res = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model,
        input: input.texts,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter embed failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      model: string;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };

    // Sort by index to maintain input order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    const vectors: EmbeddingVector[] = sorted.map(
      (d) => new Float32Array(d.embedding),
    );
    const dimensions = vectors[0]?.length ?? 0;

    return {
      vectors,
      model: data.model || model,
      dimensions,
      totalTokens: data.usage?.total_tokens ?? 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      const model = getEmbedModel();
      const res = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ model, input: ["test"] }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `${res.status}: ${body}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export const openrouterLLM: LLMProvider = {
  name: "openrouter",

  async chat(input: ChatInput): Promise<ChatResult> {
    const apiKey = getApiKey();
    const model = getLlmModel();

    const body: Record<string, unknown> = {
      model,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: input.maxTokens ?? 1024,
      temperature: input.temperature ?? 0.1,
    };

    if (input.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenRouter chat failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model || model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      const model = getLlmModel();
      const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with OK" }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `${res.status}: ${body}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};
