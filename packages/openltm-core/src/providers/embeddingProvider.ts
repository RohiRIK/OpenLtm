/**
 * providers/embeddingProvider.ts — Pluggable embedding provider interface.
 * loadProvider() is the single factory used by learn() and recall().
 * Unset config resolves to llamacpp (local llama-server). A down server
 * reports unavailable and recall stays on FTS. Gemini is opt-in.
 */

export type EmbeddingProviderName = "llamacpp" | "gemini" | "openai" | "ollama" | "disabled";

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  confidenceThreshold: number;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "llamacpp",
  confidenceThreshold: 0.6,
};

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  /** Expected dim. Providers may update this from the first returned vector. */
  dim: number;
  available(): Promise<boolean>;
  generate(text: string): Promise<Float32Array | null>;
}

const PROVIDER_NAMES: readonly EmbeddingProviderName[] = ["llamacpp", "gemini", "openai", "ollama", "disabled"];

/** LTM_EMBED_PROVIDER wins over config.json. Unknown values are ignored. */
export function explicitEmbedProvider(): EmbeddingProviderName | null {
  const raw = process.env["LTM_EMBED_PROVIDER"]?.trim().toLowerCase();
  if (!raw) return null;
  return (PROVIDER_NAMES as readonly string[]).includes(raw) ? raw as EmbeddingProviderName : null;
}

/** Factory — returns the configured provider. Defaults to "disabled" if unrecognised. */
export async function loadProvider(config?: Partial<EmbeddingConfig>): Promise<EmbeddingProvider> {
  const providerName = explicitEmbedProvider() ?? config?.provider ?? "llamacpp";

  if (providerName === "llamacpp") {
    const { LlamaCppProvider } = await import("./llamacpp.js");
    return new LlamaCppProvider(config ?? {});
  }
  if (providerName === "gemini") {
    const { GeminiProvider } = await import("./gemini.js");
    return new GeminiProvider(config ?? {});
  }
  if (providerName === "openai") {
    const { OpenAIProvider } = await import("./openai.js");
    return new OpenAIProvider(config ?? {});
  }
  if (providerName === "ollama") {
    const { OllamaProvider } = await import("./ollama.js");
    return new OllamaProvider(config ?? {});
  }

  const { DisabledProvider } = await import("./disabled.js");
  return new DisabledProvider();
}
