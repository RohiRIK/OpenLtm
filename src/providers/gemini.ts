/**
 * providers/gemini.ts — Gemini embedding provider (EmbeddingProvider interface).
 * Filled in by T5. Stub here to satisfy tsc for T3.
 */
import type { EmbeddingProvider, EmbeddingProviderName, EmbeddingConfig } from "./embeddingProvider.js";

export class GeminiProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName = "gemini";
  readonly model: string;
  readonly dim = 768;

  private apiKey: string;

  constructor(config: Partial<EmbeddingConfig>) {
    this.model = config.model ?? "text-embedding-004";
    this.apiKey = config.apiKey ?? process.env["GEMINI_API_KEY"] ?? "";
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(text: string): Promise<Float32Array | null> {
    if (!this.apiKey) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: `models/${this.model}`, content: { parts: [{ text }] } }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { embedding?: { values?: number[] } };
    const values = json?.embedding?.values;
    if (!values) return null;
    return new Float32Array(values);
  }
}
