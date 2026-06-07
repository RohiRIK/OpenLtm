/**
 * openai.ts — OpenAI provider for embeddings and LLM chat.
 * Supports text-embedding-3-* for embeddings and GPT-4o family for LLM.
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

const OPENAI_API_BASE = "https://api.openai.com/v1";

const getApiKey = makeApiKeyGetter(SETTING_KEYS.OPENAI_API_KEY, "OPENAI_API_KEY", "OpenAI");
const getEmbedModel = makeModelGetter(SETTING_KEYS.OPENAI_EMBED_MODEL);
const getLlmModel = makeModelGetter(SETTING_KEYS.OPENAI_LLM_MODEL);

function authHeaders(apiKey: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

export const openaiEmbedding: EmbeddingProvider = {
  name: "openai",

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const apiKey = getApiKey();
    const model = getEmbedModel();

    const res = await fetch(`${OPENAI_API_BASE}/embeddings`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model, input: input.texts }),
    });

    if (!res.ok) return Promise.reject(new Error((await httpErrorResult(res)).error));

    const data = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { total_tokens: number };
    };

    // OpenAI guarantees response order matches input order
    const vectors: EmbeddingVector[] = data.data.map((e) => new Float32Array(e.embedding));
    const dimensions = vectors[0]?.length ?? 0;

    return { vectors, model, dimensions, totalTokens: data.usage.total_tokens };
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

export const openaiLLM: LLMProvider = {
  name: "openai",

  async chat(input: ChatInput): Promise<ChatResult> {
    const apiKey = getApiKey();
    const model = getLlmModel();

    const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: input.messages,
        max_tokens: input.maxTokens ?? 1024,
        temperature: input.temperature ?? 0.1,
        ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!res.ok) {
      const { error } = await httpErrorResult(res);
      throw new Error(`OpenAI chat failed: ${error}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message.content ?? "",
      model: data.model,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      const model = getLlmModel();
      const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
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
