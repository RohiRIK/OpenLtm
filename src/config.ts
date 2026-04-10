#!/usr/bin/env bun
/**
 * config.ts — Loader and validator for ~/.claude/config.json
 */
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { getDbPath } from "./paths.js";

// Lazy-computed config path
function getConfigPath(): string {
  return join(homedir(), ".claude", "config.json");
}

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── Defaults ───────────────────────────────────────────────────────────────────

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
  if (!existsSync(configPath)) return { ...DEFAULTS };

  let raw: Record<string, unknown>;
  try { raw = JSON.parse(await Bun.file(configPath).text()) as Record<string, unknown>; }
  catch { return { ...DEFAULTS }; }

  const { valid, errors } = validateConfig(raw);
  if (!valid) process.stderr.write(`[config] Validation: ${errors.join(", ")}\n`);

  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
  const server = (raw["server"] ?? {}) as Partial<ServerConfig>;
  const sync = (raw["sync"] ?? {}) as Partial<SyncConfig>;

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
  };
}
