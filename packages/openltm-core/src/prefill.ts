/**
 * prefill.ts — Shared session-start context builder for host adapters.
 *
 * Keeps the "already pre-filled" experience consistent across Claude Code,
 * OpenCode, Pi, and any future host that can call into openltm-core.
 */
import { getContextMerge, type Memory } from "./db.js";
import { readConfigSync } from "./config.js";

export interface PrefillOptions {
  project: string;
  maxMemories?: number;
  maxGlobalMemories?: number;
  maxLines?: number;
  header?: string;
}

export interface PrefillSelection {
  globals: Memory[];
  scoped: Memory[];
}

const DEFAULT_HEADER = "## Prior Knowledge (LTM)";

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function formatMemory(memory: Pick<Memory, "id" | "content" | "category" | "importance">): string {
  return `- [${memory.id}] (${memory.category}/${memory.importance}) ${oneLine(memory.content)}`;
}

function trimLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, Math.max(0, maxLines - 1));
  trimmed.push("… (truncated)");
  return trimmed;
}

export function deriveProjectFromCwd(cwd: string): string {
  return cwd.replace(/\/$/, "").split("/").pop() ?? "";
}

export function selectPrefillMemories(project: string, opts: Omit<PrefillOptions, "project"> = {}): PrefillSelection {
  const cfg = readConfigSync();
  const configuredTopN = cfg.ltm?.injectTopN;
  const maxMemories = clampPositiveInt(opts.maxMemories, configuredTopN ?? 8);
  const desiredGlobals = clampPositiveInt(opts.maxGlobalMemories, Math.min(3, Math.max(1, Math.ceil(maxMemories / 3))));

  const merged = getContextMerge(project);

  const globals = merged.globals.slice(0, Math.min(desiredGlobals, maxMemories));
  const remaining = Math.max(0, maxMemories - globals.length);
  const scoped = merged.scoped.slice(0, remaining);

  if (scoped.length < remaining && globals.length < maxMemories) {
    const refillGlobals = merged.globals.slice(globals.length, Math.min(merged.globals.length, maxMemories - scoped.length));
    globals.push(...refillGlobals);
  }

  return { globals, scoped };
}

export function buildPrefillContext(opts: PrefillOptions): string {
  const maxLines = clampPositiveInt(opts.maxLines, 18);
  const { globals, scoped } = selectPrefillMemories(opts.project, opts);
  if (globals.length === 0 && scoped.length === 0) return "";

  const lines: string[] = [opts.header ?? DEFAULT_HEADER, ""];

  if (globals.length > 0) {
    lines.push("Global:");
    for (const memory of globals) lines.push(formatMemory(memory));
    lines.push("");
  }

  if (scoped.length > 0) {
    lines.push(`Project (${opts.project}):`);
    for (const memory of scoped) lines.push(formatMemory(memory));
    lines.push("");
  }

  return trimLines(lines, maxLines).join("\n").trimEnd() + "\n";
}
