/**
 * providers/openai.ts — OpenAI embedding provider (EmbeddingProvider interface).
 */
import type { EmbeddingProvider, EmbeddingProviderName, EmbeddingConfig } from "./embeddingProvider.js";

export class OpenAIProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName = "openai";
  readonly model: string;
  readonly dim = 1536;

  private apiKey: string;

  constructor(config: Partial<EmbeddingConfig>) {
    this.model = config.model ?? "text-embedding-3-small";
    this.apiKey = config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(text: string): Promise<Float32Array | null> {
    if (!this.apiKey) return null;
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { embedding?: number[] }[] };
    const values = json?.data?.[0]?.embedding;
    if (!values) return null;
    return new Float32Array(values);
  }
}
