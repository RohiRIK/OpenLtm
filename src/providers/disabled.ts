/**
 * providers/disabled.ts — No-op embedding provider.
 * Default when no provider is configured. Zero I/O, zero API key required.
 */
import type { EmbeddingProvider } from "./embeddingProvider.js";

export class DisabledProvider implements EmbeddingProvider {
  readonly name = "disabled" as const;
  readonly model = "none";
  readonly dim = 0;

  available(): Promise<boolean> {
    return Promise.resolve(false);
  }

  generate(_text: string): Promise<Float32Array | null> {
    return Promise.resolve(null);
  }
}
