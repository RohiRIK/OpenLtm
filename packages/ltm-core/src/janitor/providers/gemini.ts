/**
 * gemini.ts — Google Gemini provider for embeddings and LLM chat.
 * Uses the Gemini REST API directly (no SDK dependency).
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

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const getApiKey = makeApiKeyGetter(SETTING_KEYS.GEMINI_API_KEY, "GEMINI_API_KEY", "Gemini");
const getEmbedModel = makeModelGetter(SETTING_KEYS.GEMINI_EMBED_MODEL);
const getLlmModel = makeModelGetter(SETTING_KEYS.GEMINI_LLM_MODEL);

export const geminiEmbedding: EmbeddingProvider = {
  name: "gemini",

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const apiKey = getApiKey();
    const model = getEmbedModel();

    // Gemini batchEmbedContents supports up to 100 texts per call
    const requests = input.texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }));

    const res = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini embed failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      embeddings: Array<{ values: number[] }>;
    };

    const vectors: EmbeddingVector[] = data.embeddings.map(
      (e) => new Float32Array(e.values),
    );
    const dimensions = vectors[0]?.length ?? 0;

    return {
      vectors,
      model,
      dimensions,
      // Gemini doesn't return token counts for embeddings; estimate
      totalTokens: input.texts.reduce(
        (sum, t) => sum + Math.ceil(t.length / 4),
        0,
      ),
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      // Verify the key by listing models — works regardless of which embed model is configured
      const res = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}&pageSize=1`);
      if (!res.ok) return httpErrorResult(res);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export const geminiLLM: LLMProvider = {
  name: "gemini",

  async chat(input: ChatInput): Promise<ChatResult> {
    const apiKey = getApiKey();
    const model = getLlmModel();

    // Convert ChatMessage[] to Gemini format
    // Gemini uses "user"/"model" roles; system goes in systemInstruction
    const systemMsg = input.messages.find((m) => m.role === "system");
    const contents = input.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: input.maxTokens ?? 1024,
        temperature: input.temperature ?? 0.1,
        ...(input.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const res = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini chat failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return {
      content,
      model,
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      const res = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}&pageSize=1`);
      if (!res.ok) return httpErrorResult(res);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};
