/**
 * prefill.ts — Shared session-start context builder for host adapters.
 *
 * Keeps the "already pre-filled" experience consistent across Claude Code,
 * OpenCode, Pi, and any future host that can call into openltm-core.
 *
 * Prefill v2 behaviour:
 *   - project-scoped memories are prioritised over globals
 *   - category quotas stop one noisy category from filling the block
 *   - near-duplicate entries are suppressed
 *   - the block is hard-capped by line budget for every host
 */
import { getContextMerge, computeDecayScore, type Memory } from "./db.js";
import { readConfigSync } from "./config.js";
import { isNearDuplicate } from "./similarity.js";
import { DB_PATH } from "./shared-db.js";
import { getDataDir, getRegistryPath } from "./paths.js";
import { legacyLastSegment, loadProjectRegistry, resolveProjectName } from "./project.js";
import { createProjectDataProbe } from "./projectProbe.js";

export interface PrefillOptions {
  project: string;
  maxMemories?: number;
  maxGlobalMemories?: number;
  maxLines?: number;
  header?: string;
  /** Per-category caps applied before the global budget. */
  quotas?: Partial<Record<PrefillCategory, number>>;
}

export interface PrefillSelection {
  globals: Memory[];
  scoped: Memory[];
}

export type PrefillCategory =
  | "preference"
  | "architecture"
  | "gotcha"
  | "pattern"
  | "workflow"
  | "constraint";

export interface PrefillQuotaReport {
  selected: number;
  suppressedDuplicates: number;
  quotaLimited: number;
}

const DEFAULT_HEADER = "## Prior Knowledge (LTM)";

/**
 * Shared prefill budget for every host adapter.
 *
 * Adapters pass these instead of literal numbers so Claude, OpenCode, and Pi
 * cannot drift apart: the block a user sees is the same shape everywhere.
 */
export const PREFILL_DEFAULTS = { maxMemories: 10, maxLines: 18 } as const;

/**
 * Category quotas. The block stays useful when a project has 40 gotchas and no
 * decisions: gotcha is capped and the freed slots go to the other categories.
 */
const DEFAULT_QUOTAS: Record<PrefillCategory, number> = {
  preference: 2,
  architecture: 2,
  gotcha: 3,
  pattern: 3,
  workflow: 2,
  constraint: 2,
};

/** Order used when a category is over its quota and slots are contested. */
const CATEGORY_PRIORITY: PrefillCategory[] = [
  "constraint",
  "preference",
  "gotcha",
  "architecture",
  "workflow",
  "pattern",
];

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function clampNonNegativeInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function trimLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, Math.max(0, maxLines - 1));
  trimmed.push("… (truncated)");
  return trimmed;
}

/**
 * Project name for `cwd`, via the shared resolver (registry → repo root → cwd
 * basename). Hosts that call this (Pi, OpenCode, the bunx hook CLI) used the raw
 * last path segment before 2.17; that name is kept while it is the only one
 * with rows in the database, so no existing memory is orphaned.
 */
export function deriveProjectFromCwd(cwd: string): string {
  const dataDir = getDataDir(DB_PATH);
  return resolveProjectName(cwd, {
    registry: loadProjectRegistry(getRegistryPath(dataDir)),
    legacyName: legacyLastSegment(cwd),
    legacyScope: "all",
    hasProjectData: createProjectDataProbe(DB_PATH),
  });
}

/** Rank key: higher is better. Project scope wins ties against globals. */
function rank(memory: Memory, scopeRank: number): number {
  return memory.importance * 1000 + computeDecayScore(memory) * 10 + scopeRank;
}

function sortForSelection(memories: Memory[], scopeRank: number): Memory[] {
  return [...memories].sort((a, b) => {
    const diff = rank(b, scopeRank) - rank(a, scopeRank);
    if (diff !== 0) return diff;
    return a.id - b.id; // deterministic tie-break
  });
}

/**
 * Apply per-category quotas, then fill any leftover slots with the highest
 * ranked remaining memories so the block is never artificially small.
 */
function applyQuotas(
  ordered: Memory[],
  quotas: Partial<Record<PrefillCategory, number>>,
  budget: number,
): { picked: Memory[]; quotaLimited: number } {
  const counts = new Map<PrefillCategory, number>();
  const picked: Memory[] = [];
  const deferred: Memory[] = [];
  let quotaLimited = 0;

  for (const memory of ordered) {
    if (picked.length >= budget) break;
    const category = memory.category as PrefillCategory;
    const cap = quotas[category];
    const used = counts.get(category) ?? 0;
    if (cap !== undefined && used >= cap) {
      quotaLimited++;
      deferred.push(memory);
      continue;
    }
    counts.set(category, used + 1);
    picked.push(memory);
  }

  for (const memory of deferred) {
    if (picked.length >= budget) break;
    picked.push(memory);
  }

  return { picked, quotaLimited };
}

/** Suppress near-duplicate memories, keeping the highest ranked occurrence. */
function dedupe(memories: Memory[]): { kept: Memory[]; suppressed: number } {
  const kept: Memory[] = [];
  let suppressed = 0;
  for (const memory of memories) {
    const duplicate = kept.some((existing) => isNearDuplicate(existing.content, memory.content));
    if (duplicate) {
      suppressed++;
      continue;
    }
    kept.push(memory);
  }
  return { kept, suppressed };
}

export function selectPrefillMemories(
  project: string,
  opts: Omit<PrefillOptions, "project"> = {},
): PrefillSelection & { report: PrefillQuotaReport } {
  const cfg = readConfigSync();
  const configuredTopN = cfg.ltm?.injectTopN;
  const maxMemories = clampPositiveInt(opts.maxMemories, configuredTopN ?? 8);

  const quotas: Partial<Record<PrefillCategory, number>> = { ...DEFAULT_QUOTAS, ...(opts.quotas ?? {}) };

  const merged = getContextMerge(project);

  // Project-scoped candidates come first and outrank globals of equal strength.
  const scopedOrdered = sortForSelection(merged.scoped, 2);
  const globalCeiling = clampNonNegativeInt(opts.maxGlobalMemories, Math.max(1, Math.ceil(maxMemories / 3)));
  const globalsOrdered = sortForSelection(merged.globals, 0).slice(0, Math.min(merged.globals.length, globalCeiling + maxMemories));

  const scopedBudget = Math.max(0, maxMemories - Math.min(globalCeiling, merged.globals.length));
  const scopedResult = applyQuotas(scopedOrdered, quotas, scopedBudget);
  const globalsResult = applyQuotas(globalsOrdered, quotas, maxMemories - scopedResult.picked.length);

  const { kept: scoped, suppressed: scopedDupes } = dedupe(scopedResult.picked);
  const { kept: globals, suppressed: globalDupes } = dedupe(globalsResult.picked);
  const crossDupes = globals.filter((g) => scoped.some((s) => isNearDuplicate(s.content, g.content))).length;

  return {
    scoped,
    globals: globals.filter((g) => !scoped.some((s) => isNearDuplicate(s.content, g.content))),
    report: {
      selected: scoped.length + globals.length,
      suppressedDuplicates: scopedDupes + globalDupes + crossDupes,
      quotaLimited: scopedResult.quotaLimited + globalsResult.quotaLimited,
    },
  };
}

export function buildPrefillContext(opts: PrefillOptions): string {
  const maxLines = clampPositiveInt(opts.maxLines, 18);
  const { globals, scoped } = selectPrefillMemories(opts.project, opts);
  if (globals.length === 0 && scoped.length === 0) return "";

  const lines: string[] = [opts.header ?? DEFAULT_HEADER, ""];

  if (scoped.length > 0) {
    lines.push(`Project (${opts.project}):`);
    for (const memory of scoped) lines.push(renderLine(memory));
    lines.push("");
  }

  if (globals.length > 0) {
    lines.push("Global:");
    for (const memory of globals) lines.push(renderLine(memory));
    lines.push("");
  }

  return trimLines(lines, maxLines).join("\n").trimEnd() + "\n";
}

function renderLine(memory: Pick<Memory, "id" | "content" | "category" | "importance">): string {
  return `- [${memory.id}] (${memory.category}/${memory.importance}) ${oneLine(memory.content)}`;
}
