/**
 * hookUtils.ts
 * Shared utilities for Claude Code hooks.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { logHook } from "./hookLogger.js";

/**
 * Run an async hook body safely. Never throws.
 * Returns { ok: true, value } on success or { ok: false, error } on failure.
 * On failure, writes structured JSON to stderr (Claude Code reads hook stderr)
 * and records to the hook log.
 */
export async function safeRun<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logHook(label, "error", error.message, error.stack);
    process.stderr.write(
      JSON.stringify({
        hook: label,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }) + "\n",
    );
    return { ok: false, error };
  }
}

/** Read stdin fully as a string. */
export async function readStdin(): Promise<string> {
  let result = "";
  try {
    for await (const chunk of Bun.stdin.stream()) {
      result += new TextDecoder().decode(chunk);
    }
  } catch {}
  return result;
}

/** Read stdin and echo it to stdout (for passthrough hooks like Stop). */
export async function readStdinPassthrough(): Promise<string> {
  let result = "";
  try {
    for await (const chunk of Bun.stdin.stream()) {
      result += new TextDecoder().decode(chunk);
      process.stdout.write(chunk);
    }
  } catch {}
  return result;
}

/** Parse JSON input and extract cwd. Returns { input, cwd } or null if no cwd. */
export function parseHookInput(raw: string): { input: Record<string, any>; cwd: string } | null {
  let input: Record<string, any> = {};
  try { input = JSON.parse(raw); } catch {}

  const cwd: string = input.cwd || input.working_directory || input.session?.cwd || "";
  if (!cwd) return null;

  return { input, cwd };
}

/** Read a file safely, returning empty string if missing or unreadable. */
export function readFileSafe(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").trim();
}

/** Append a line to a file, creating it if needed. */
export function appendLine(path: string, line: string): void {
  const existing = readFileSafe(path);
  const content = existing ? `${existing}\n${line}\n` : `${line}\n`;
  writeFileSync(path, content);
}

/** Trim content to the last N lines. */
export function trimToLines(content: string, max: number): string {
  const lines = content.split("\n");
  if (lines.length <= max) return content;
  return lines.slice(lines.length - max).join("\n");
}

/**
 * Build a budget-capped section for context summaries.
 * @param lines   Content lines (no header)
 * @param label   Section heading text
 * @param budget  Max total lines including header + trailing blank
 */
export function budgetSection(lines: string[], label: string, budget: number): string {
  if (lines.length === 0) return "";
  const available = Math.max(0, budget - 3); // header(2) + trailing blank
  if (lines.length <= available) {
    return [`## ${label}`, "", ...lines, ""].join("\n");
  }
  const kept = lines.slice(-available);
  const omitted = lines.length - available;
  return [`## ${label}`, "", ...kept, `… (${omitted} more entries not shown)`, ""].join("\n");
}
