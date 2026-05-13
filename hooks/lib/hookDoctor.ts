#!/usr/bin/env bun
/**
 * hookDoctor.ts
 * Diagnoses health of all registered Claude Code hooks.
 * Run: bun ~/.claude/hooks/lib/hookDoctor.ts
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { LogEntry } from "./hookLogger.js";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
const LOG_PATH = join(CLAUDE_DIR, "logs", "hooks.log");

interface HookReport {
  file: string;
  exists: boolean;
  event: string;
  errors24h: number;
  warns24h: number;
  lastError?: string;
}

function extractHookFiles(settings: Record<string, unknown>): Array<{ event: string; file: string }> {
  const results: Array<{ event: string; file: string }> = [];
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) return results;

  for (const [event, handlers] of Object.entries(hooks)) {
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      if (typeof handler !== "object" || handler === null) continue;
      const h = handler as Record<string, unknown>;
      // Nested format: { matcher, hooks: [{ type, command }] }
      const nested = h.hooks as Array<Record<string, unknown>> | undefined;
      const cmds: string[] = [];
      if (nested) {
        for (const n of nested) {
          if (typeof n.command === "string") cmds.push(n.command);
        }
      } else if (typeof h.command === "string") {
        cmds.push(h.command);
      }
      for (const cmd of cmds) {
        // Only care about `bun /path/to/Hook.ts` entries
        const match = cmd.match(/bun\s+(\/[^\s]+\.ts)/);
        if (match?.[1]) results.push({ event, file: match[1] });
      }
    }
  }
  return results;
}

function hookName(file: string): string {
  return file.split("/").pop()!.replace(/\.ts$/, "");
}

function parseLog(): LogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const entries: LogEntry[] = [];
    for (const line of readFileSync(LOG_PATH, "utf-8").trim().split("\n")) {
      if (!line) continue;
      try { entries.push(JSON.parse(line) as LogEntry); } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return []; // silent: log file unreadable (permissions or partial write); report will show zero entries
  }
}

function buildReport(): void {
  // Load settings
  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try { settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")); } catch {} // silent: malformed settings.json; hook list will be empty
  } else {
    console.log("⚠  settings.json not found at", SETTINGS_PATH);
  }

  const hookFiles = extractHookFiles(settings);

  // Deduplicate by file
  const seen = new Set<string>();
  const unique = hookFiles.filter(h => { if (seen.has(h.file)) return false; seen.add(h.file); return true; });

  // Parse log entries from last 24h
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const entries = parseLog().filter(e => new Date(e.ts).getTime() >= cutoff);

  // Count by hook name (basename without extension)
  const errorsByHook = new Map<string, LogEntry[]>();
  const warnsByHook = new Map<string, number>();
  for (const e of entries) {
    const key = e.hook;
    if (e.level === "error") {
      if (!errorsByHook.has(key)) errorsByHook.set(key, []);
      errorsByHook.get(key)!.push(e);
    } else if (e.level === "warn") {
      warnsByHook.set(key, (warnsByHook.get(key) ?? 0) + 1);
    }
  }

  // Build reports
  const reports: HookReport[] = unique.map(({ event, file }) => {
    const name = hookName(file);
    const errs = errorsByHook.get(name) ?? [];
    return {
      file,
      exists: existsSync(file),
      event,
      errors24h: errs.length,
      warns24h: warnsByHook.get(name) ?? 0,
      lastError: errs[errs.length - 1]?.msg,
    };
  });

  // Output
  console.log("\n## Hook Doctor Report\n");
  console.log(`Log: ${existsSync(LOG_PATH) ? LOG_PATH : "⚠  not found (no hooks have run yet)"}`);
  console.log(`Entries in last 24h: ${entries.length}\n`);

  const colW = 28;
  console.log(`${"Hook".padEnd(colW)} ${"Event".padEnd(18)} ${"File".padEnd(8)} ${"Errors".padEnd(8)} ${"Warns".padEnd(8)} Last Error`);
  console.log("─".repeat(100));

  let healthy = 0;
  let unhealthy = 0;

  for (const r of reports) {
    const name = hookName(r.file);
    const fileIcon = r.exists ? "✅" : "❌";
    const healthIcon = !r.exists ? "❌" : r.errors24h >= 3 ? "🔴" : r.errors24h > 0 ? "🟡" : "🟢";
    const lastErr = r.lastError ? r.lastError.substring(0, 35) + (r.lastError.length > 35 ? "…" : "") : "";

    console.log(
      `${(healthIcon + " " + name).padEnd(colW)} ${r.event.padEnd(18)} ${fileIcon.padEnd(8)} ${String(r.errors24h).padEnd(8)} ${String(r.warns24h).padEnd(8)} ${lastErr}`
    );

    if (!r.exists || r.errors24h >= 3) unhealthy++;
    else healthy++;
  }

  console.log("\n" + "─".repeat(100));
  console.log(`Healthy: ${healthy}  |  Needs attention: ${unhealthy}`);

  if (unhealthy > 0) {
    console.log("\n⚠  Run: tail -50 ~/.claude/logs/hooks.log | bunx json -ga ts hook level msg detail");
  } else {
    console.log("\n✅ All registered hooks look healthy.");
  }
  console.log();
}

buildReport();
