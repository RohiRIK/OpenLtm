#!/usr/bin/env bun
/**
 * config.ts — Loader and validator for ~/.claude/config.json
 * Manual validation (no zod dependency) matching config.schema.json constraints.
 *
 * CLI: bun config.ts --validate
 */
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { getDbPath } from "./paths.js";

const CONFIG_PATH = join(homedir(), ".claude", "config.json");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LtmConfig {
  dbPath: string;
  decayEnabled: boolean;
  injectTopN: number;
  autoRelate: boolean;
  autoRecall: boolean;
  graphReasoning: boolean;
  evaluateSessionLlm: boolean;
  semanticFallback: boolean;
  gitLearnEnabled: boolean;
  gitLearnMinDiffChars: number;
  gitLearnFileFilter: string[];
  gitLearnIgnorePatterns: string[];
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
    autoRecall: true,
    graphReasoning: false,
    evaluateSessionLlm: false,
    semanticFallback: true,
    gitLearnEnabled: false,
    gitLearnMinDiffChars: 200,
    gitLearnFileFilter: [],
    gitLearnIgnorePatterns: ["package-lock.json", "*.lock", "dist/", ".min.js"],
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

// ── Validation ─────────────────────────────────────────────────────────────────

function isPortValid(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 1024 && v <= 65535;
}

export function validateConfig(raw?: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const cfg = (raw ?? {}) as Record<string, unknown>;

  if ("ltm" in cfg) {
    const ltm = cfg["ltm"] as Record<string, unknown>;
    if (typeof ltm !== "object" || ltm === null) {
      errors.push("ltm: must be an object");
    } else {
      if ("dbPath" in ltm && typeof ltm["dbPath"] !== "string") {
        errors.push("ltm.dbPath: must be a string");
      }
      if ("decayEnabled" in ltm && typeof ltm["decayEnabled"] !== "boolean") {
        errors.push("ltm.decayEnabled: must be a boolean");
      }
      if ("autoRecall" in ltm && typeof ltm["autoRecall"] !== "boolean") {
        errors.push("ltm.autoRecall: must be a boolean");
      }
      if ("graphReasoning" in ltm && typeof ltm["graphReasoning"] !== "boolean") {
        errors.push("ltm.graphReasoning: must be a boolean");
      }
      if ("evaluateSessionLlm" in ltm && typeof ltm["evaluateSessionLlm"] !== "boolean") {
        errors.push("ltm.evaluateSessionLlm: must be a boolean");
      }
      if ("semanticFallback" in ltm && typeof ltm["semanticFallback"] !== "boolean") {
        errors.push("ltm.semanticFallback: must be a boolean");
      }
      if ("gitLearnEnabled" in ltm && typeof ltm["gitLearnEnabled"] !== "boolean") {
        errors.push("ltm.gitLearnEnabled: must be a boolean");
      }
      if ("gitLearnMinDiffChars" in ltm) {
        const n = ltm["gitLearnMinDiffChars"];
        if (typeof n !== "number" || !Number.isInteger(n) || (n as number) < 0) {
          errors.push("ltm.gitLearnMinDiffChars: must be a non-negative integer");
        }
      }
      if ("gitLearnFileFilter" in ltm && !Array.isArray(ltm["gitLearnFileFilter"])) {
        errors.push("ltm.gitLearnFileFilter: must be an array");
      }
      if ("gitLearnIgnorePatterns" in ltm && !Array.isArray(ltm["gitLearnIgnorePatterns"])) {
        errors.push("ltm.gitLearnIgnorePatterns: must be an array");
      }
      if ("injectTopN" in ltm) {
        const n = ltm["injectTopN"];
        if (
          typeof n !== "number" ||
          !Number.isInteger(n) ||
          (n as number) < 1 ||
          (n as number) > 50
        ) {
          errors.push("ltm.injectTopN: must be an integer between 1 and 50");
        }
      }
    }
  }

  if ("server" in cfg) {
    const srv = cfg["server"] as Record<string, unknown>;
    if (typeof srv !== "object" || srv === null) {
      errors.push("server: must be an object");
    } else {
      if ("apiPort" in srv && !isPortValid(srv["apiPort"])) {
        errors.push("server.apiPort: must be an integer between 1024 and 65535");
      }
      if ("uiPort" in srv && !isPortValid(srv["uiPort"])) {
        errors.push("server.uiPort: must be an integer between 1024 and 65535");
      }
    }
  }

  if ("sync" in cfg) {
    const sync = cfg["sync"] as Record<string, unknown>;
    if (typeof sync !== "object" || sync === null) {
      errors.push("sync: must be an object");
    } else {
      if ("enabled" in sync && typeof sync["enabled"] !== "boolean") {
        errors.push("sync.enabled: must be a boolean");
      }
      if ("provider" in sync) {
        const p = sync["provider"];
        if (p !== null && p !== "s3" && p !== "r2") {
          errors.push('sync.provider: must be "s3", "r2", or null');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Loader ─────────────────────────────────────────────────────────────────────

/** Sync flag reader — for use in fire-and-forget contexts like autoDetectRelations */
export function readConfigSync(): Partial<Config> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(require("fs").readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<Config> {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await Bun.file(CONFIG_PATH).text()) as Record<string, unknown>;
  } catch {
    process.stderr.write(`[config] Failed to parse config.json — using defaults\n`);
    return { ...DEFAULTS };
  }

  const { valid, errors } = validateConfig(raw);
  if (!valid) {
    process.stderr.write(
      `[config] Validation warnings:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
    );
  }

  const ltm = (raw["ltm"] ?? {}) as Partial<LtmConfig>;
  const server = (raw["server"] ?? {}) as Partial<ServerConfig>;
  const sync = (raw["sync"] ?? {}) as Partial<SyncConfig>;

  return {
    ltm: {
      dbPath:       ltm.dbPath       ?? DEFAULTS.ltm.dbPath,
      decayEnabled: ltm.decayEnabled ?? DEFAULTS.ltm.decayEnabled,
      injectTopN:   ltm.injectTopN   ?? DEFAULTS.ltm.injectTopN,
      autoRelate:         ltm.autoRelate         ?? DEFAULTS.ltm.autoRelate,
      autoRecall:         ltm.autoRecall         ?? DEFAULTS.ltm.autoRecall,
      graphReasoning:     ltm.graphReasoning     ?? DEFAULTS.ltm.graphReasoning,
      evaluateSessionLlm:     ltm.evaluateSessionLlm     ?? DEFAULTS.ltm.evaluateSessionLlm,
      semanticFallback:       ltm.semanticFallback       ?? DEFAULTS.ltm.semanticFallback,
      gitLearnEnabled:        ltm.gitLearnEnabled        ?? DEFAULTS.ltm.gitLearnEnabled,
      gitLearnMinDiffChars:   ltm.gitLearnMinDiffChars   ?? DEFAULTS.ltm.gitLearnMinDiffChars,
      gitLearnFileFilter:     ltm.gitLearnFileFilter     ?? DEFAULTS.ltm.gitLearnFileFilter,
      gitLearnIgnorePatterns: ltm.gitLearnIgnorePatterns ?? DEFAULTS.ltm.gitLearnIgnorePatterns,
    },
    server: {
      apiPort: server.apiPort ?? DEFAULTS.server.apiPort,
      uiPort:  server.uiPort  ?? DEFAULTS.server.uiPort,
    },
    sync: {
      enabled:  sync.enabled  ?? DEFAULTS.sync.enabled,
      provider: sync.provider ?? DEFAULTS.sync.provider,
    },
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const arg = process.argv[2];

  if (arg === "--validate") {
    if (!existsSync(CONFIG_PATH)) {
      console.log(`config.json not found at ${CONFIG_PATH} — using defaults`);
      process.exit(0);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await Bun.file(CONFIG_PATH).text());
    } catch (err) {
      console.error(`Failed to parse config.json: ${err}`);
      process.exit(1);
    }

    const { valid, errors } = validateConfig(raw);
    if (valid) {
      console.log("config.json is valid");
    } else {
      console.error("config.json has validation errors:");
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: bun config.ts --validate");
    process.exit(1);
  }
}
