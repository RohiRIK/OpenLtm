/**
 * cohere.ts — Cohere provider for embeddings and LLM chat (v2 API).
 */
import {
  SETTING_KEYS,
  type ChatInput,
  type ChatResult,
  type EmbedInput,
  type EmbedResult,
  type EmbeddingProvider,
  type EmbeddingVector,
  type LLMProvider,
} from "./types.js";
import { httpErrorResult, makeApiKeyGetter, makeModelGetter } from "./utils.js";

const COHERE_API_BASE = "https://api.cohere.com/v2";

const getApiKey = makeApiKeyGetter(SETTING_KEYS.COHERE_API_KEY, "COHERE_API_KEY", "Cohere");
const getEmbedModel = makeModelGetter(SETTING_KEYS.COHERE_EMBED_MODEL);
const getLlmModel = makeModelGetter(SETTING_KEYS.COHERE_LLM_MODEL);

function authHeaders(apiKey: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

export const cohereEmbedding: EmbeddingProvider = {
  name: "cohere",

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const apiKey = getApiKey();
    const model = getEmbedModel();

    const res = await fetch(`${COHERE_API_BASE}/embed`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        texts: input.texts,
        input_type: "search_document",
        embedding_types: ["float"],
      }),
    });

    if (!res.ok) {
      const { error } = await httpErrorResult(res);
      throw new Error(`Cohere embed failed: ${error}`);
    }

    const data = (await res.json()) as {
      embeddings: { float: number[][] };
      meta?: { billed_units?: { input_tokens?: number } };
    };

    const vectors: EmbeddingVector[] = data.embeddings.float.map(
      (e) => new Float32Array(e),
    );

    return {
      vectors,
      model,
      dimensions: vectors[0]?.length ?? 0,
      totalTokens: data.meta?.billed_units?.input_tokens ?? 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.embed({ texts: ["test"] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export const cohereLLM: LLMProvider = {
  name: "cohere",

  async chat(input: ChatInput): Promise<ChatResult> {
    const apiKey = getApiKey();
    const model = getLlmModel();

    const res = await fetch(`${COHERE_API_BASE}/chat`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: input.messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
          content: m.content,
        })),
        max_tokens: input.maxTokens ?? 1024,
        temperature: input.temperature ?? 0.1,
        ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!res.ok) {
      const { error } = await httpErrorResult(res);
      throw new Error(`Cohere chat failed: ${error}`);
    }

    const data = (await res.json()) as {
      message: { content: Array<{ type: string; text: string }> };
      usage?: { billed_units?: { input_tokens?: number; output_tokens?: number } };
    };

    return {
      content: data.message.content.find((b) => b.type === "text")?.text ?? "",
      model,
      promptTokens: data.usage?.billed_units?.input_tokens ?? 0,
      completionTokens: data.usage?.billed_units?.output_tokens ?? 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      const model = getLlmModel();
      const res = await fetch(`${COHERE_API_BASE}/chat`, {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with OK" }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) return httpErrorResult(res);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};
