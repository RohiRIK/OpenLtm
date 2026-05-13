/**
 * jsonlLogger.ts — Structured JSONL event log for the LTM plugin.
 *
 * Write path: ${CLAUDE_PLUGIN_DATA}/logs/ltm.jsonl
 * Rotation: 10MB → keep last 7MB (byte-slice, no rename needed).
 *
 * Supplements hookLogger.ts — does NOT replace it.
 * Never throws — all errors are silently swallowed to protect hook execution.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export interface LtmEvent {
  ts: string;
  hook: string;
  event: string;
  project?: string;
  count?: number;
  durationMs?: number;
  detail?: string;
  level?: "info" | "warn" | "error";
}

const MAX_BYTES  = 10 * 1024 * 1024;  // 10 MB
const KEEP_BYTES =  7 * 1024 * 1024;  //  7 MB kept after rotation
const ROTATE_INTERVAL_MS = 60_000;     // at most one rotation check per minute

let _logPath: string | null = null;
let _dirEnsured = false;
let _lastRotateCheck = 0;

export function getLogPath(): string {
  if (_logPath) return _logPath;
  const base = process.env.CLAUDE_PLUGIN_DATA
    ?? join(homedir(), ".claude", "plugins", "data", "ltm-ltm");
  _logPath = join(base, "logs", "ltm.jsonl");
  return _logPath;
}

function ensureDir(logPath: string): void {
  if (_dirEnsured) return;
  mkdirSync(dirname(logPath), { recursive: true });
  _dirEnsured = true;
}

function maybeRotate(logPath: string): void {
  const now = Date.now();
  if (now - _lastRotateCheck < ROTATE_INTERVAL_MS) return;
  _lastRotateCheck = now;
  try {
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size <= MAX_BYTES) return;
    // Slice the tail — keep the most recent KEEP_BYTES
    const content = readFileSync(logPath);
    writeFileSync(logPath, content.slice(content.length - KEEP_BYTES));
  } catch { /* rotation failure is non-fatal */ }
}

export function emitEvent(event: LtmEvent): void {
  try {
    const logPath = getLogPath();
    ensureDir(logPath);
    maybeRotate(logPath);
    const entry: LtmEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch { /* never throw from logger */ }
}

export function readRecentEvents(limit: number): LtmEvent[] {
  try {
    const logPath = getLogPath();
    if (!existsSync(logPath)) return [];
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    const tail = lines.slice(-Math.max(limit, 0));
    const events: LtmEvent[] = [];
    for (const line of tail) {
      try { events.push(JSON.parse(line) as LtmEvent); } catch { /* skip malformed lines */ }
    }
    return events;
  } catch {
    return [];
  }
}

/** Reset cached state — test-only. */
export function _resetForTesting(): void {
  _logPath = null;
  _dirEnsured = false;
  _lastRotateCheck = 0;
}
