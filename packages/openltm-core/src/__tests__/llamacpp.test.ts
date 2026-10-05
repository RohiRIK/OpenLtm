import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { LlamaCppProvider, resetLlamaCppProbeForTesting, LLAMACPP_DEFAULT_DIM } from "../providers/llamacpp.js";
import { loadProvider } from "../providers/embeddingProvider.js";
import { listMemoryIdsNeedingEmbedding } from "../dao/embeddings.js";
import { SETTING_KEYS, SETTING_DEFAULTS } from "../janitor/providers/types.js";

describe("llamacpp embedding provider", () => {
  const prevFetch = globalThis.fetch;
  const prevEnv = {
    embed: process.env.LTM_EMBED_PROVIDER,
    url: process.env.LTM_LLAMA_CPP_URL,
    model: process.env.LTM_EMBED_MODEL,
  };

  beforeEach(() => {
    resetLlamaCppProbeForTesting();
    delete process.env.LTM_EMBED_PROVIDER;
    delete process.env.LTM_LLAMA_CPP_URL;
    delete process.env.LTM_EMBED_MODEL;
  });

  afterEach(() => {
    globalThis.fetch = prevFetch;
    resetLlamaCppProbeForTesting();
    if (prevEnv.embed === undefined) delete process.env.LTM_EMBED_PROVIDER;
    else process.env.LTM_EMBED_PROVIDER = prevEnv.embed;
    if (prevEnv.url === undefined) delete process.env.LTM_LLAMA_CPP_URL;
    else process.env.LTM_LLAMA_CPP_URL = prevEnv.url;
    if (prevEnv.model === undefined) delete process.env.LTM_EMBED_MODEL;
    else process.env.LTM_EMBED_MODEL = prevEnv.model;
  });

  it("loadProvider returns LlamaCppProvider for llamacpp", async () => {
    const provider = await loadProvider({ provider: "llamacpp", confidenceThreshold: 0.6 });
    expect(provider.name).toBe("llamacpp");
    expect(provider.model).toBe("bge-m3");
    expect(provider.dim).toBe(LLAMACPP_DEFAULT_DIM);
  });

  it("available() is false when /health fails, and the miss is cached", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("offline");
    }) as typeof fetch;
    const provider = new LlamaCppProvider({ baseUrl: "http://127.0.0.1:9" });
    expect(await provider.available()).toBe(false);
    expect(await provider.available()).toBe(false);
    expect(calls).toBe(1);
    expect(await provider.generate("hello")).toBeNull();
  });

  it("unset LTM_EMBED_PROVIDER defaults to llamacpp and a down server never calls Gemini", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      throw new Error("offline");
    }) as typeof fetch;
    const provider = await loadProvider(undefined);
    expect(provider.name).toBe("llamacpp");
    expect(provider.model).toBe("bge-m3");
    expect(await provider.generate("fresh memory without gemini")).toBeNull();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith("http://127.0.0.1:8080/"))).toBe(true);
    expect(urls.some((u) => /googleapis|generativelanguage|gemini/i.test(u))).toBe(false);
  });

  it("generate() parses the OpenAI embeddings payload and records actual dim", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      if (url.endsWith("/v1/embeddings")) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const provider = new LlamaCppProvider({ baseUrl: "http://127.0.0.1:8080", model: "bge-m3" });
    const vec = await provider.generate("local memory");
    expect(vec).not.toBeNull();
    expect(vec!.length).toBe(3);
    expect(vec![0]).toBeCloseTo(0.1);
    expect(vec![2]).toBeCloseTo(0.3);
    expect(provider.dim).toBe(3);
  });
});

describe("listMemoryIdsNeedingEmbedding", () => {
  it("returns missing rows and rows stamped with another model or dim", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY, status TEXT, importance INTEGER, created_at TEXT, content TEXT);
      CREATE TABLE memory_embeddings (
        memory_id INTEGER PRIMARY KEY, embedding BLOB, model TEXT, dim INTEGER, created_at TEXT
      );
      INSERT INTO memories (id, status, importance, created_at, content) VALUES
        (1, 'active', 5, '2026-01-01', 'a'),
        (2, 'active', 4, '2026-01-02', 'b'),
        (3, 'active', 3, '2026-01-03', 'c'),
        (4, 'archived', 9, '2026-01-04', 'd');
      INSERT INTO memory_embeddings (memory_id, embedding, model, dim) VALUES
        (2, X'00', 'text-embedding-004', 768),
        (3, X'00', 'bge-m3', 1024);
    `);
    const ids = listMemoryIdsNeedingEmbedding(db, "bge-m3", 1024, 10);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
  });
});

describe("provider defaults (local-first)", () => {
  it("embeddings default to llamacpp; janitor LLM defaults to ollama (Gemini opt-in)", () => {
    expect(SETTING_DEFAULTS[SETTING_KEYS.EMBED_PROVIDER]).toBe("llamacpp");
    expect(SETTING_DEFAULTS[SETTING_KEYS.LLM_PROVIDER]).toBe("ollama");
    expect(SETTING_DEFAULTS[SETTING_KEYS.LLM_PROVIDER]).not.toBe("gemini");
  });
});
