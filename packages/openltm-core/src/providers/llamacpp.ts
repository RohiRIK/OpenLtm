/**
 * providers/llamacpp.ts — local embeddings via llama-server's OpenAI-compatible
 * /v1/embeddings endpoint. No API key. A missing server is a miss, not an error:
 * available() probes once per process so a down server cannot stall a hook.
 */
import type { EmbeddingProvider, EmbeddingProviderName, EmbeddingConfig } from "./embeddingProvider.js";

export const LLAMACPP_DEFAULT_URL = "http://127.0.0.1:8080";
export const LLAMACPP_DEFAULT_MODEL = "bge-m3";
/** bge-m3 dense size. Overwritten from the first vector if the server disagrees. */
export const LLAMACPP_DEFAULT_DIM = 1024;

const PROBE_TIMEOUT_MS = 400;

let probeCache: boolean | null = null;

export function resetLlamaCppProbeForTesting(): void {
  probeCache = null;
}

export function llamaCppBaseUrl(config?: Partial<EmbeddingConfig>): string {
  return (
    config?.baseUrl
    ?? process.env["LTM_LLAMA_CPP_URL"]
    ?? LLAMACPP_DEFAULT_URL
  ).replace(/\/$/, "");
}

export function llamaCppModel(config?: Partial<EmbeddingConfig>): string {
  return config?.model ?? process.env["LTM_EMBED_MODEL"] ?? LLAMACPP_DEFAULT_MODEL;
}

/** GET /health (llama-server) with a short timeout. Cached for the process. */
export async function probeLlamaCpp(baseUrl: string): Promise<boolean> {
  if (probeCache !== null) return probeCache;
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    probeCache = res.ok;
  } catch {
    probeCache = false;
  }
  return probeCache;
}

export class LlamaCppProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName = "llamacpp";
  readonly model: string;
  dim: number;

  private baseUrl: string;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.model = llamaCppModel(config);
    this.baseUrl = llamaCppBaseUrl(config);
    this.dim = LLAMACPP_DEFAULT_DIM;
  }

  async available(): Promise<boolean> {
    return probeLlamaCpp(this.baseUrl);
  }

  async generate(text: string): Promise<Float32Array | null> {
    if (!await this.available()) return null;
    try {
      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
      const values = json?.data?.[0]?.embedding;
      if (!values || values.length === 0) return null;
      this.dim = values.length;
      return new Float32Array(values);
    } catch {
      return null;
    }
  }
}
