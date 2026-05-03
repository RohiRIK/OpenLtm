#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveProject, getDbPath } from "../lib/resolveProject.js";
import { readStdin, parseHookInput, readFileSafe, budgetSection, safeRun } from "../lib/hookUtils.js";
import { logHook, logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { getItems, exportContextMarkdown } from "../../src/context.js";

const DB_PATH = getDbPath();

async function buildSummaryFromDb(name: string, cwd: string): Promise<string | null> {
  try {
    exportContextMarkdown(name);
    const toLines = (items: Array<{ content: string }>) => items.map(i => i.content);
    const timestamp = new Date().toISOString().replace("T", " ").replace(/\..+/, "");
    return [
      `# Context Summary\n**Project:** ${name} (${cwd})\n**Compaction checkpoint:** ${timestamp}\n`,
      budgetSection(toLines(getItems(name, "goal")),       "Current Goal",        10),
      budgetSection(toLines(getItems(name, "progress", 20)), "Recent Progress",   20),
      budgetSection(toLines(getItems(name, "decision")),   "Key Decisions",       15),
      budgetSection(toLines(getItems(name, "gotcha")),     "Gotchas / Watch Out", 15),
    ].join("");
  } catch (_) {
    return null;
  }
}

function buildSummaryFromFiles(name: string, cwd: string, projectDir: string): string {
  const toLines = (raw: string) => raw.split("\n").filter(Boolean);
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\..+/, "");
  return [
    `# Context Summary\n**Project:** ${name} (${cwd})\n**Compaction checkpoint:** ${timestamp}\n`,
    budgetSection(toLines(readFileSafe(join(projectDir, "context-goals.md"))),     "Current Goal",        10),
    budgetSection(toLines(readFileSafe(join(projectDir, "context-progress.md"))),  "Recent Progress",     20),
    budgetSection(toLines(readFileSafe(join(projectDir, "context-decisions.md"))), "Key Decisions",       15),
    budgetSection(toLines(readFileSafe(join(projectDir, "context-gotchas.md"))),   "Gotchas / Watch Out", 15),
  ].join("");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const parsed = parseHookInput(raw);

  if (!parsed) {
    logHook("PreCompact", "warn", "No cwd found in input, skipping");
    process.stderr.write("[PreCompact] No cwd found in input, skipping\n");
    return;
  }

  const { cwd } = parsed;
  const { name, projectDir } = resolveProject(cwd);

  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

  // Try DB first; fall back to .md files if DB doesn't exist yet
  const finalSummary = existsSync(DB_PATH)
    ? ((await buildSummaryFromDb(name, cwd)) ?? buildSummaryFromFiles(name, cwd, projectDir))
    : buildSummaryFromFiles(name, cwd, projectDir);

  writeFileSync(join(projectDir, "context-summary.md"), finalSummary);
  logHook("PreCompact", "info", `Saved context summary for "${name}" (${finalSummary.split("\n").length} lines)`);
  logEvent("PreCompact", EVENTS.COMPACT_PRE, { project: name });
}

await safeRun("PreCompact", main);
