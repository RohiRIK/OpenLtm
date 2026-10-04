#!/usr/bin/env bun
/**
 * EvaluateSession — SessionEnd hook (fires once, when the session ends).
 *
 * Reads the session transcript and writes, under the plugin DATA dir (never the
 * plugin install dir, which is replaced on update and is the git repo in dev):
 *   - learned/patterns/<date>-<session8>.md  per-session summary (errors, tools, files)
 *   - learned/summary.md                     rolling one-line-per-session index
 *   - proposals/<session-id>.json            memory proposals for /openltm:memory propose
 *
 * Writes nothing to stdout — SessionEnd output is not shown to anyone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resolveProject } from "../lib/resolveProject.js";
import { logHook, logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { readStdin, parseHookInput, safeRun } from "../lib/hookUtils.js";
import { extractProposals } from "../lib/llmExtract.js";
import { writeProposals, type MemoryProposal } from "../lib/proposalQueue.js";
import { readConfigSync } from "../../src/config.js";
import { emitEvent } from "@rohirik/openltm-core";

const PLUGIN_DATA_DIR = process.env.CLAUDE_PLUGIN_DATA
  || join(homedir(), ".claude", "plugins", "data", "OpenLtm-openltm");
const LEARNED_DIR = join(PLUGIN_DATA_DIR, "learned");
const PATTERNS_DIR = join(LEARNED_DIR, "patterns");
const SUMMARY_FILE = join(LEARNED_DIR, "summary.md");
const PROPOSALS_DIR = join(PLUGIN_DATA_DIR, "proposals");

const SUMMARY_TEMPLATE = "# Learned Patterns Summary\n\nThis file is auto-updated.\n\n---\n\n## Recent Sessions\n\n";
const MAX_SUMMARY_LINES = 50;
const SUMMARY_HEADER_LINES = 10;
const MIN_SESSION_MESSAGES = 5;
const MAX_ERROR_CHARS = 200;
const MIN_ERROR_CHARS = 40;
const MAX_ERROR_PROPOSALS = 3;
/** Stay inside the 60s SessionEnd timeout in hooks.json; callLlm has no timeout of its own. */
const LLM_TIMEOUT_MS = 45_000;

/**
 * Tool errors that come from the harness, permission prompts, or the user
 * stopping a tool — not from the project — so they make useless "gotchas".
 */
const NOISE_ERROR_PATTERNS: RegExp[] = [
  /<tool_use_error>/i,
  /InputValidationError/i,
  /file has not been read yet/i,
  /file has been (?:modified|changed) since read/i,
  /user doesn'?t want to proceed/i,
  /tool use was rejected/i,
  /interrupted by user/i,
  /haven'?t granted/i,
  /\bpermission\b[\s\S]*\b(?:has been|was|is) denied\b/i,
  /\bdenied by (?:the )?(?:user|hook|policy)/i,
];

type TranscriptEntry = {
  type?: string;
  error?: { message?: string };
  message?: { role?: string; content?: unknown };
};

function parseTranscript(raw: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed JSONL lines */ }
  }
  return entries;
}

function contentBlocks(entry: TranscriptEntry): any[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? content : [];
}

/** Project-relevant error messages: noise filtered out, normalised, deduplicated. */
function collectErrors(entries: TranscriptEntry[]): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  const consider = (raw: string) => {
    if (NOISE_ERROR_PATTERNS.some(re => re.test(raw))) return;
    const msg = raw.replace(/\s+/g, " ").trim().substring(0, MAX_ERROR_CHARS);
    if (msg.length < MIN_ERROR_CHARS || seen.has(msg)) return;
    seen.add(msg);
    errors.push(msg);
  };
  for (const entry of entries) {
    for (const block of contentBlocks(entry)) {
      if (block?.type !== "tool_result" || !block.is_error) continue;
      consider(Array.isArray(block.content)
        ? block.content.map((c: any) => c?.text || "").join(" ")
        : String(block.content || ""));
    }
    if (entry.type === "error") consider(entry.error?.message || "");
  }
  return errors;
}

function extractAssistantText(entries: TranscriptEntry[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.message?.role !== "assistant") continue;
    for (const block of contentBlocks(entry)) {
      if (block?.type === "text" && typeof block.text === "string") parts.push(block.text.trim());
    }
  }
  const full = parts.join("\n\n");
  return full.length > 8000 ? full.slice(-8000) : full;
}

function renderPatternFile(
  today: string, sessionId: string | undefined, messageCount: number,
  errors: string[], toolUses: any[],
): string {
  const toolCounts: Record<string, number> = {};
  const files = new Set<string>();
  for (const block of toolUses) {
    toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
    if (block.name === "Write" || block.name === "Edit" || block.name === "MultiEdit") {
      const path = block.input?.file_path || block.input?.path;
      if (path) files.add(path);
    }
  }
  const topTools = Object.entries(toolCounts).sort(([, a], [, b]) => b - a).slice(0, 10);
  return [
    `# Session Patterns: ${today}`,
    `**Session ID:** ${sessionId || "unknown"}`,
    `**Messages:** ${messageCount}`,
    "", "---", "",
    "## Errors Encountered",
    ...errors.slice(0, 10).map(msg => `- ${msg}`),
    "",
    "## Tools Used",
    ...topTools.map(([tool, count]) => `- ${tool} (${count} times)`),
    "",
    "## Files Modified",
    ...[...files].slice(0, 20).map(f => `- ${f}`),
    "",
  ].join("\n");
}

/** Append one line per session to the rolling summary (dedup by short id). */
function updateSummary(today: string, shortId: string, messageCount: number, errorCount: number): void {
  const summary = existsSync(SUMMARY_FILE) ? readFileSync(SUMMARY_FILE, "utf-8") : SUMMARY_TEMPLATE;
  if (summary.includes(`Session ${shortId}`)) return;
  const lines = (summary + `- **${today}** (${messageCount} msgs): Session ${shortId}... (Errors: ${errorCount})\n`).split("\n");
  const kept = lines.length > MAX_SUMMARY_LINES
    ? [...lines.slice(0, SUMMARY_HEADER_LINES), ...lines.slice(lines.length - (MAX_SUMMARY_LINES - SUMMARY_HEADER_LINES))]
    : lines;
  writeFileSync(SUMMARY_FILE, kept.join("\n"));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** LLM-extracted proposals when ltm.evaluateSessionLlm is on; [] otherwise or on failure. */
async function llmProposals(
  entries: TranscriptEntry[], projectName: string, sessionId: string | undefined,
): Promise<MemoryProposal[]> {
  try {
    if (!readConfigSync().ltm?.evaluateSessionLlm) return [];
    const text = extractAssistantText(entries);
    if (text.length <= 100) return [];
    const result = await withTimeout(
      extractProposals(text, projectName, { source: "evaluate-session", sessionId }),
      LLM_TIMEOUT_MS,
    );
    if (!result) {
      logHook("EvaluateSession", "warn", `LLM extraction timed out after ${LLM_TIMEOUT_MS}ms`);
      return [];
    }
    return result.proposals;
  } catch (err) {
    logHook("EvaluateSession", "warn", "LLM extraction failed", String(err));
    return [];
  }
}

function queueProposals(sessionId: string | undefined, proposals: MemoryProposal[]): void {
  if (proposals.length === 0) return;
  const fileId = sessionId ? sessionId.replace(/[^\w-]/g, "_") : `unknown-${Date.now()}`;
  const proposalsPath = join(PROPOSALS_DIR, `${fileId}.json`);
  writeProposals(proposalsPath, proposals);
  logHook("EvaluateSession", "info", `${proposals.length} proposals written`, proposalsPath);
}

async function main(): Promise<void> {
  const parsed = parseHookInput(await readStdin());
  if (!parsed) return;
  const { input, cwd } = parsed;

  // Claude Code always passes transcript_path to hooks; nothing to evaluate without it.
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";
  if (!transcriptPath || !existsSync(transcriptPath)) return;
  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : undefined;

  const entries = parseTranscript(readFileSync(transcriptPath, "utf-8"));
  const messageCount = entries.length;
  if (messageCount < MIN_SESSION_MESSAGES) return;

  const errors = collectErrors(entries);
  const toolUses = entries.flatMap(e => contentBlocks(e).filter(b => b?.type === "tool_use"));
  const today = new Date().toISOString().split("T")[0]!;
  const shortId = sessionId ? sessionId.substring(0, 8).replace(/[^\w-]/g, "_") : "unknown";

  mkdirSync(PATTERNS_DIR, { recursive: true });
  writeFileSync(
    join(PATTERNS_DIR, `${today}-${shortId}.md`),
    renderPatternFile(today, sessionId, messageCount, errors, toolUses),
  );
  updateSummary(today, shortId, messageCount, errors.length);

  const projectName = resolveProject(cwd).name;
  const errorProposals: MemoryProposal[] = errors.slice(0, MAX_ERROR_PROPOSALS).map(content => ({
    content, category: "gotcha", importance: 3, source: "evaluate-session",
  }));
  queueProposals(sessionId, [...errorProposals, ...await llmProposals(entries, projectName, sessionId)]);

  logEvent("EvaluateSession", EVENTS.SESSION_EVALUATED, { project: projectName, count: messageCount });
  emitEvent({ hook: "EvaluateSession", event: EVENTS.SESSION_EVALUATED, project: projectName, count: messageCount, ts: new Date().toISOString() });
}

await safeRun("EvaluateSession", main);
// A timed-out LLM request would otherwise hold the process open until Claude Code kills it.
process.exit(0);
