#!/usr/bin/env bun
/**
 * config.ts — Loader and validator for the LTM config.json.
 * Location: see getConfigPath() in paths.ts (LTM_CONFIG_PATH → <dataDir>/config.json
 * → legacy ~/.claude/config.json).
 */
import { existsSync, readFileSync } from "fs";
import { getConfigPath, getDbPath } from "./paths.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmbeddingsConfig {
  provider: "llamacpp" | "gemini" | "openai" | "ollama" | "disabled";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  confidenceThreshold: number;
}

export interface LtmConfig {
  dbPath: string;
  decayEnabled: boolean;
  injectTopN: number;
  autoRelate: boolean;
  graphReasoning: boolean;
  evaluateSessionLlm: boolean;
  semanticFallback: boolean;
  gitLearnEnabled: boolean;
  gitLearnMinDiffChars: number;
  gitLearnFileFilter: string[];
  gitLearnIgnorePatterns: string[];
  autoRecall: boolean;
}

export interface ServerConfig {
  apiPort: number;
  uiPort: number;
}

export interface SyncConfig {
  enabled: boolean;
  provider: "s3" | "r2" | null;
}

export interface Config {
  ltm: LtmConfig;
  server: ServerConfig;
  sync: SyncConfig;
  embeddings: EmbeddingsConfig;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_EMBEDDINGS: EmbeddingsConfig = {
  provider: "llamacpp",
  confidenceThreshold: 0.6,
};

const DEFAULTS: Config = {
  ltm: {
    dbPath: getDbPath(),
    decayEnabled: true,
    injectTopN: 15,
    autoRelate: true,
    graphReasoning: false,
    evaluateSessionLlm: false,
    semanticFallback: true,
    gitLearnEnabled: false,
    gitLearnMinDiffChars: 200,
    gitLearnFileFilter: [],
    gitLearnIgnorePatterns: [],
    autoRecall: true,
  },
  server: {
    apiPort: 7331,
    uiPort: 7332,
  },
  sync: {
    enabled: false,
    provider: null,
  },
  embeddings: DEFAULT_EMBEDDINGS,
};

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(raw: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (raw && typeof raw === "object") {
    const ltm = raw["ltm"] as Record<string, unknown> | undefined;
    if (ltm) {
      if ("decayEnabled" in ltm && typeof ltm["decayEnabled"] !== "boolean") errors.push("ltm.decayEnabled: must be boolean");
      if ("injectTopN" in ltm && typeof ltm["injectTopN"] !== "number") errors.push("ltm.injectTopN: must be number");
      if ("autoRecall" in ltm && typeof ltm["autoRecall"] !== "boolean") errors.push("ltm.autoRecall: must be boolean");
      if ("graphReasoning" in ltm && typeof ltm["graphReasoning"] !== "boolean") errors.push("ltm.graphReasoning: must be boolean");
      if ("autoRelate" in ltm && typeof ltm["autoRelate"] !== "boolean") errors.push("ltm.autoRelate: must be boolean");
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── Loader ─────────────────────────────────────────────────────────────────────

export function readConfigSync(): Partial<Config> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  try { return JSON.parse(readFileSync(configPath, "utf8")) as Partial<Config>; } 
  catch { return {}; }
}

export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return { ...DEFAULTS, embeddings: { ...DEFAULT_EMBEDDINGS } };

  let raw: Record<string, unknown>;
  try { raw = JSON.parse(await Bun.file(configPath).text()) as Record<string, unknown>; }
  catch { return { ...DEFAULTS, embeddings: { ...DEFAULT_EMBEDDINGS } }; }

  const { valid, errors } = validateConfig(raw);
  if (!valid) process.stderr.write(`[config] Validation: ${errors.join(", ")}\n`);

  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
  const server = (raw["server"] ?? {}) as Partial<ServerConfig>;
  const sync = (raw["sync"] ?? {}) as Partial<SyncConfig>;
  const emb = (raw["embeddings"] ?? {}) as Partial<EmbeddingsConfig>;

  // Resolve apiKey from env when not set in config
  const envProvider = process.env["LTM_EMBED_PROVIDER"]?.trim().toLowerCase();
  const provider = (envProvider === "llamacpp" || envProvider === "gemini" || envProvider === "openai" || envProvider === "ollama" || envProvider === "disabled")
    ? envProvider
    : (emb.provider ?? DEFAULT_EMBEDDINGS.provider);

  const resolvedApiKey = emb.apiKey
    ?? (provider === "gemini" ? process.env["GEMINI_API_KEY"] : undefined)
    ?? (provider === "openai" ? process.env["OPENAI_API_KEY"] : undefined)
    ?? (provider === "ollama" ? process.env["OLLAMA_API_KEY"] : undefined);
  const resolvedBaseUrl = emb.baseUrl
    ?? (provider === "llamacpp" ? process.env["LTM_LLAMA_CPP_URL"] : undefined);
  const resolvedModel = emb.model
    ?? (provider === "llamacpp" ? process.env["LTM_EMBED_MODEL"] : undefined);

  return {
    ltm: {
      dbPath: ltm.dbPath ?? DEFAULTS.ltm.dbPath,
      decayEnabled: ltm.decayEnabled ?? DEFAULTS.ltm.decayEnabled,
      injectTopN: ltm.injectTopN ?? DEFAULTS.ltm.injectTopN,
      autoRelate: ltm.autoRelate ?? DEFAULTS.ltm.autoRelate,
      graphReasoning: ltm.graphReasoning ?? DEFAULTS.ltm.graphReasoning,
      evaluateSessionLlm: ltm.evaluateSessionLlm ?? DEFAULTS.ltm.evaluateSessionLlm,
      semanticFallback: ltm.semanticFallback ?? DEFAULTS.ltm.semanticFallback,
      gitLearnEnabled: ltm.gitLearnEnabled ?? DEFAULTS.ltm.gitLearnEnabled,
      gitLearnMinDiffChars: ltm.gitLearnMinDiffChars ?? DEFAULTS.ltm.gitLearnMinDiffChars,
      gitLearnFileFilter: ltm.gitLearnFileFilter ?? DEFAULTS.ltm.gitLearnFileFilter,
      gitLearnIgnorePatterns: ltm.gitLearnIgnorePatterns ?? DEFAULTS.ltm.gitLearnIgnorePatterns,
      autoRecall: ltm.autoRecall ?? DEFAULTS.ltm.autoRecall,
    },
    server: { apiPort: server.apiPort ?? DEFAULTS.server.apiPort, uiPort: server.uiPort ?? DEFAULTS.server.uiPort },
    sync: { enabled: sync.enabled ?? DEFAULTS.sync.enabled, provider: sync.provider ?? DEFAULTS.sync.provider },
    embeddings: {
      provider,
      apiKey: resolvedApiKey,
      model: resolvedModel,
      baseUrl: resolvedBaseUrl,
      confidenceThreshold: emb.confidenceThreshold ?? DEFAULT_EMBEDDINGS.confidenceThreshold,
    },
  };
}
