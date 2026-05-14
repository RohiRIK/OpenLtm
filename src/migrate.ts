#!/usr/bin/env bun
/**
 * migrate.ts — One-time migration from Markdown context files to SQLite LTM.
 *
 * Part A: Per-project context files (goals, decisions, progress, gotchas)
 * Part B: Learned patterns from skills/learned/*.md
 *
 * Safe to re-run — dedup_key prevents duplicates in memories table.
 * skipExport=true used throughout to avoid hundreds of redundant file writes.
 * Run: bun src/migrate.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_DIR   = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const LEARNED_DIR  = join(CLAUDE_DIR, "skills/Learned");

const { addItem, exportContextMarkdown } = await import("@rohirik/ltm-core");
const { learn, exportMarkdown }          = await import("@rohirik/ltm-core");

function readFileSafe(p: string): string {
  try { return existsSync(p) ? readFileSync(p, "utf-8") : ""; } catch { return ""; }
}

function parseLines(raw: string): string[] {
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"));
}

// ============================================================
// Part A: Per-project context files
// ============================================================

type ContextType = "goal" | "decision" | "progress" | "gotcha";

const FILES: Array<{ file: string; type: ContextType }> = [
  { file: "context-goals.md",     type: "goal" },
  { file: "context-decisions.md", type: "decision" },
  { file: "context-progress.md",  type: "progress" },
  { file: "context-gotchas.md",   type: "gotcha" },
];

// Read registry to map dir names → friendly project names
const registryPath = join(PROJECTS_DIR, "registry.json");
const registry: Record<string, string> = existsSync(registryPath)
  ? JSON.parse(readFileSync(registryPath, "utf-8"))
  : {};

// Reverse map: slug dir name → registry name
const reversedRegistry = new Map<string, string>(
  Object.entries(registry).map(([path, name]) => [
    path.replace(/\//g, "-").replace(/\./g, "-"),
    name,
  ])
);

let ctxGoals = 0, ctxDecisions = 0, ctxProgress = 0, ctxGotchas = 0;
let projectCount = 0;

if (existsSync(PROJECTS_DIR)) {
  for (const dirName of readdirSync(PROJECTS_DIR)) {
    if (dirName === "registry.json") continue;

    const dirPath = join(PROJECTS_DIR, dirName);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch { continue; }

    const projectName = reversedRegistry.get(dirName) ?? dirName;
    let hadAny = false;

    for (const { file, type } of FILES) {
      const raw = readFileSafe(join(dirPath, file));
      if (!raw.trim()) continue;

      for (const line of parseLines(raw)) {
        // Skip truncation notices
        if (line.startsWith("…")) continue;
        try {
          // skipExport=true: avoid writing context-summary.md on every insert
          addItem(projectName, type, line, undefined, true);
          hadAny = true;
          if (type === "goal")     ctxGoals++;
          if (type === "decision") ctxDecisions++;
          if (type === "progress") ctxProgress++;
          if (type === "gotcha")   ctxGotchas++;
        } catch (_) {}
      }
    }

    if (hadAny) {
      // Write context-summary.md once per project after all items are inserted
      exportContextMarkdown(projectName);
      projectCount++;
    }
  }
}

console.log(`\n[migrate] Part A: Context files`);
console.log(`  Projects processed: ${projectCount}`);
console.log(`  Goals: ${ctxGoals}, Decisions: ${ctxDecisions}, Progress: ${ctxProgress}, Gotchas: ${ctxGotchas}`);

// ============================================================
// Part B: Learned patterns from skills/learned/*.md
// ============================================================

type MemoryCategory = "preference" | "architecture" | "gotcha" | "pattern" | "workflow" | "constraint";

function inferCategory(content: string, filename: string): MemoryCategory {
  const lower = (content + filename).toLowerCase();
  if (lower.includes("gotcha") || lower.includes("warning") || lower.includes("watch out") || lower.includes("never")) return "gotcha";
  if (lower.includes("prefer") || lower.includes("always use") || lower.includes("instead of")) return "preference";
  if (lower.includes("architect") || lower.includes("design") || lower.includes("schema") || lower.includes("database")) return "architecture";
  if (lower.includes("workflow") || lower.includes("process") || lower.includes("step")) return "workflow";
  if (lower.includes("constraint") || lower.includes("limit") || lower.includes("max")) return "constraint";
  return "pattern";
}

function parseLearnedFile(filePath: string): Array<{ content: string; category: MemoryCategory }> {
  const raw = readFileSafe(filePath);
  if (!raw.trim()) return [];

  const filename = filePath.split("/").pop() ?? "";
  const results: Array<{ content: string; category: MemoryCategory }> = [];

  const sectionRegex = /^##\s+(.+)$/gm;
  const sections: Array<{ title: string; start: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(raw)) !== null) {
    sections.push({ title: (match[1] ?? "").trim(), start: match.index + match[0].length });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section) continue;
    const { title, start } = section;
    const end = i + 1 < sections.length ? (sections[i + 1]?.start ?? raw.length) : raw.length;
    const body = raw.slice(start, end).trim();

    if (!body || body.length < 10) continue;
    if (title.toLowerCase().includes("example")) continue;

    const firstLine = (body.split("\n")[0] ?? "").trim().replace(/^[-*]\s+/, "");
    if (firstLine.length < 10) continue;

    results.push({
      content: `[${title}] ${firstLine}`,
      category: inferCategory(firstLine, filename),
    });
  }

  // Fallback: use first meaningful line if no sections parsed
  if (results.length === 0) {
    const first = parseLines(raw).find(l => l.length > 15);
    if (first) results.push({ content: first, category: inferCategory(first, filename) });
  }

  return results;
}

let learnCreated = 0, learnReinforced = 0;

if (existsSync(LEARNED_DIR)) {
  for (const file of readdirSync(LEARNED_DIR).filter(f => f.endsWith(".md"))) {
    for (const { content, category } of parseLearnedFile(join(LEARNED_DIR, file))) {
      try {
        const result = learn({ content, category, importance: 3, source: `migration:${file}`, skipExport: true });
        if (result.action === "created") learnCreated++;
        else learnReinforced++;
      } catch (_) {}
    }
  }
}

// Write docs/memory-long-term.md once at the end
exportMarkdown();

console.log(`\n[migrate] Part B: Learned patterns`);
console.log(`  Created: ${learnCreated}, Reinforced/skipped: ${learnReinforced}`);
console.log(`\n[migrate] Done. docs/memory-long-term.md regenerated.`);
