/**
 * anthropic.ts — Anthropic Claude provider for LLM chat (no embedding API).
 */
import {
  SETTING_KEYS,
  type ChatInput,
  type ChatResult,
  type LLMProvider,
} from "./types.js";
import { httpErrorResult, makeApiKeyGetter, makeModelGetter } from "./utils.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

const getApiKey = makeApiKeyGetter(SETTING_KEYS.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY", "Anthropic");
const getLlmModel = makeModelGetter(SETTING_KEYS.ANTHROPIC_LLM_MODEL);

function authHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

export const anthropicLLM: LLMProvider = {
  name: "anthropic",

  async chat(input: ChatInput): Promise<ChatResult> {
    const apiKey = getApiKey();
    const model = getLlmModel();

    // Anthropic uses a single `system` string; only the first system message is used.
    const systemMsg = input.messages.find((m) => m.role === "system");
    const messages = input.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: input.maxTokens ?? 1024,
      temperature: input.temperature ?? 0.1,
    };
    if (systemMsg) body.system = systemMsg.content;

    const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const { error } = await httpErrorResult(res);
      throw new Error(`Anthropic chat failed: ${error}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      content: data.content.find((b) => b.type === "text")?.text ?? "",
      model: data.model,
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    };
  },

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = getApiKey();
      const model = getLlmModel();
      const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
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
