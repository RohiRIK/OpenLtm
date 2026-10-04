#!/usr/bin/env bun
/**
 * UpdateContext — Stop hook. Claude Code fires Stop after EVERY assistant turn,
 * so this keeps one progress line per session up to date (an upsert keyed on
 * session_id) rather than appending a line per turn. It writes nothing to
 * stdout: Claude Code parses a Stop hook's stdout as hook output.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolveProject, getDbPath } from "../lib/resolveProject.js";
import { readStdin, parseHookInput, readFileSafe, safeRun } from "../lib/hookUtils.js";
import { logHook, logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { appendProgress, emitEvent } from "@rohirik/openltm-core";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const MAX_PROGRESS_LINES = 20;
const MAX_DISPLAY_FILES = 5;
const MIN_TRANSCRIPT_LINES = 3;

/**
 * One pass over the transcript JSONL. Only lines mentioning "tool_use" are
 * JSON-parsed — this runs every turn and transcripts reach tens of MB.
 */
function scanTranscript(raw: string): { lineCount: number; files: string[] } {
  const files = new Set<string>();
  let lineCount = 0;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    lineCount++;
    if (!line.includes('"tool_use"')) continue;
    let entry: { message?: { content?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || !EDIT_TOOLS.has(block.name)) continue;
      const path = block.input?.file_path || block.input?.path;
      if (typeof path === "string" && path) files.add(path);
    }
  }
  return { lineCount, files: [...files] };
}

function progressLine(files: string[], lineCount: number, sessionTag: string | undefined): string {
  const today = new Date().toISOString().split("T")[0];
  const prefix = `✓ [${today}]${sessionTag ? ` [${sessionTag}]` : ""}`;
  if (files.length === 0) return `${prefix} Session (read-only, ${lineCount} messages)`;
  const home = homedir();
  const shown = files.slice(0, MAX_DISPLAY_FILES).map(f => f.replace(home, "~")).join(", ");
  const more = files.length > MAX_DISPLAY_FILES ? ` (+${files.length - MAX_DISPLAY_FILES} more)` : "";
  return `${prefix} Modified: ${shown}${more}`;
}

/** No-DB fallback: same one-line-per-session semantics, in context-progress.md. */
function writeProgressMarkdown(projectDir: string, line: string, sessionTag: string | undefined): void {
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
  const progressFile = join(projectDir, "context-progress.md");
  const marker = sessionTag ? `[${sessionTag}]` : null;
  const lines = readFileSafe(progressFile).split("\n")
    .filter(l => l && !(marker && l.includes(marker)));
  lines.push(line);
  writeFileSync(progressFile, lines.slice(-MAX_PROGRESS_LINES).join("\n") + "\n");
}

async function main(): Promise<void> {
  const parsed = parseHookInput(await readStdin());
  if (!parsed) return;
  const { input, cwd } = parsed;

  // Claude Code always passes transcript_path to hooks; nothing to record without it.
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";
  if (!transcriptPath || !existsSync(transcriptPath)) return;

  const { lineCount, files } = scanTranscript(readFileSync(transcriptPath, "utf-8"));
  if (lineCount < MIN_TRANSCRIPT_LINES) return;

  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : undefined;
  const sessionTag = sessionId?.substring(0, 8);
  const line = progressLine(files, lineCount, sessionTag);
  const { name, projectDir } = resolveProject(cwd);

  if (existsSync(getDbPath())) {
    try {
      await appendProgress(name, line, sessionId);
      logHook("UpdateContext", "info", `context DB updated for ${name}`);
      logEvent("UpdateContext", EVENTS.CONTEXT_UPDATED, { project: name });
      emitEvent({ hook: "UpdateContext", event: EVENTS.CONTEXT_UPDATED, project: name, ts: new Date().toISOString() });
      return;
    } catch (dbErr) {
      logHook("UpdateContext", "warn", "DB write failed, falling back to .md", String(dbErr));
      process.stderr.write(`[UpdateContext] DB write failed, falling back to .md: ${dbErr}\n`);
    }
  }

  writeProgressMarkdown(projectDir, line, sessionTag);
  logHook("UpdateContext", "info", `context-progress.md updated for ${name}`);
}

await safeRun("UpdateContext", main);
