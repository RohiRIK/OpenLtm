/**
 * providers/embeddingProvider.ts — Pluggable embedding provider interface.
 * loadProvider() is the single factory used by learn() and recall().
 * The "disabled" provider is the default — no API key required.
 */

export type EmbeddingProviderName = "gemini" | "openai" | "ollama" | "disabled";

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  confidenceThreshold: number;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "disabled",
  confidenceThreshold: 0.6,
};

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly dim: number;
  available(): Promise<boolean>;
  generate(text: string): Promise<Float32Array | null>;
}

/** Factory — returns the configured provider. Defaults to "disabled" if unrecognised. */
export async function loadProvider(config?: Partial<EmbeddingConfig>): Promise<EmbeddingProvider> {
  const providerName = config?.provider ?? "disabled";

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
