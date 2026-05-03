#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolveProject, PROJECTS_DIR, CLAUDE_DIR, getDbPath } from "../lib/resolveProject.js";
import { readStdinPassthrough, parseHookInput, readFileSafe, appendLine, trimToLines, safeRun } from "../lib/hookUtils.js";
import { logHook } from "../lib/hookLogger.js";
import { addItem } from "../../src/context.js";

const TOOL_NAMES = new Set(["Write", "Edit", "MultiEdit"]);
const MAX_PROGRESS_LINES = 20;
const MAX_DISPLAY_FILES = 5;
const DB_PATH = getDbPath();

function findTranscriptPath(
  transcriptPath: string | undefined,
  sessionId: string | undefined
): string | null {
  if (transcriptPath && existsSync(transcriptPath)) return transcriptPath;

  const historyFile = join(CLAUDE_DIR, "history.jsonl");
  if (!existsSync(historyFile)) return null;

  const lines = readFileSync(historyFile, "utf-8").trim().split("\n");
  let entry: Record<string, unknown> | null = null;

  if (sessionId) {
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i] ?? "") as Record<string, unknown>;
        if (parsed.sessionId === sessionId) { entry = parsed; break; }
      } catch {}
    }
  } else {
    try { entry = JSON.parse(lines[lines.length - 1] ?? "") as Record<string, unknown>; } catch {}
  }

  if (!entry?.sessionId || !entry?.project) return null;

  const filename = `${entry.sessionId}.jsonl`;
  const { projectDir } = resolveProject(entry.project as string);
  const primary = join(projectDir, filename);
  if (existsSync(primary)) return primary;

  try {
    for (const dir of readdirSync(PROJECTS_DIR)) {
      const candidate = join(PROJECTS_DIR, dir, filename);
      if (existsSync(candidate)) return candidate;
    }
  } catch {}

  return null;
}

function collectModifiedFiles(messages: Array<Record<string, unknown>>): Set<string> {
  const files = new Set<string>();
  for (const m of messages) {
    const content = (m.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "tool_use" && TOOL_NAMES.has(block.name as string)) {
        const input = block.input as Record<string, string> | undefined;
        const p = input?.file_path || input?.path;
        if (p) files.add(p);
      }
    }
  }
  return files;
}

function parseJsonLines(raw: string): Array<Record<string, unknown>> {
  return raw.trim().split("\n")
    .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  const raw = await readStdinPassthrough();

  const parsed = parseHookInput(raw);
  if (!parsed) return;

  const { input, cwd } = parsed;
  const { name, projectDir } = resolveProject(cwd);
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

  const tPath = findTranscriptPath(
    input.transcript_path as string | undefined,
    input.session_id as string | undefined
  );
  if (!tPath) return;

  const messages = parseJsonLines(readFileSync(tPath, "utf-8"));
  if (messages.length < 3) return;

  const sessionTag = input.session_id ? (input.session_id as string).substring(0, 8) : null;
  const today = new Date().toISOString().split("T")[0];
  const tagPart = sessionTag ? ` [${sessionTag}]` : "";

  const filesModified = collectModifiedFiles(messages);
  const sessionLine = filesModified.size > 0
    ? `✓ [${today}]${tagPart} Modified: ${[...filesModified].slice(0, MAX_DISPLAY_FILES).map(f => f.replace(homedir(), "~")).join(", ")}`
    : `✓ [${today}]${tagPart} Session (read-only, ${messages.length} messages)`;

  // Write to DB if available, fall back to .md file
  if (existsSync(DB_PATH)) {
    try {
      const prefixMatch = sessionLine.match(/^\[(decision|gotcha)\]\s*/i);
      if (prefixMatch) {
        const type = prefixMatch[1]!.toLowerCase() as "decision" | "gotcha";
        const strippedContent = sessionLine.slice(prefixMatch[0].length);
        addItem(name, type, strippedContent, sessionTag ?? undefined);
        // Phase 2: decisions/gotchas are auto-promoted to pending memories
        // by the janitor's runPromote() — no direct promote() call needed.
      } else {
        addItem(name, "progress", sessionLine, sessionTag ?? undefined);
      }
      logHook("UpdateContext", "info", `context DB updated for ${name}`);
      return;
    } catch (dbErr) {
      logHook("UpdateContext", "warn", "DB write failed, falling back to .md", String(dbErr));
      process.stderr.write(`[UpdateContext] DB write failed, falling back to .md: ${dbErr}\n`);
    }
  }

  // Fallback: write to markdown file
  const progressFile = join(projectDir, "context-progress.md");
  const existing = readFileSafe(progressFile);
  if (sessionTag && existing.includes(sessionTag)) return;

  appendLine(progressFile, sessionLine);

  const content = readFileSafe(progressFile);
  const lines = content.split("\n").filter(Boolean);
  if (lines.length > MAX_PROGRESS_LINES) {
    writeFileSync(progressFile, trimToLines(content, MAX_PROGRESS_LINES));
  }

  logHook("UpdateContext", "info", `context-progress.md updated for ${name}`);
}

await safeRun("UpdateContext", main);
