/**
 * providers/ollama.ts — Ollama embedding provider (EmbeddingProvider interface).
 */
import type { EmbeddingProvider, EmbeddingProviderName, EmbeddingConfig } from "./embeddingProvider.js";

export class OllamaProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName = "ollama";
  readonly model: string;
  readonly dim = 768;

  private baseUrl: string;

  constructor(config: Partial<EmbeddingConfig>) {
    this.model = config.model ?? "nomic-embed-text";
    this.baseUrl = config.baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(text: string): Promise<Float32Array | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) return null;
      const json = await res.json() as { embedding?: number[] };
      const values = json?.embedding;
      if (!values) return null;
      return new Float32Array(values);
    } catch {
      return null;
    }
  }
}
