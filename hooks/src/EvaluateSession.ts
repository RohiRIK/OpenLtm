#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resolveProject, PROJECTS_DIR, CLAUDE_DIR, getDbPath } from "../lib/resolveProject.js";
import { logHook, logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { safeRun } from "../lib/hookUtils.js";
import { extractProposals } from "../lib/llmExtract.js";
import { writeProposals, type MemoryProposal } from "../lib/proposalQueue.js";
import { readConfigSync } from "../../src/config.js";
import type { Config } from "../../src/config.js";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(CLAUDE_DIR, "memory");
const LEARNED_DIR = join(PLUGIN_ROOT, "skills", "Learned");
const PATTERNS_DIR = join(LEARNED_DIR, "patterns");
const SUMMARY_FILE = join(LEARNED_DIR, "summary.md");
const HISTORY_FILE = join(CLAUDE_DIR, "history.jsonl");
const MAX_SUMMARY_LINES = 50;
const SUMMARY_HEADER_LINES = 10;
const MIN_SESSION_MESSAGES = 5; // Lowered for testing

// Proposals dir: ${CLAUDE_PLUGIN_DATA}/proposals/ or fallback to plugin data dir
const PLUGIN_DATA_DIR = process.env.CLAUDE_PLUGIN_DATA
  ?? join(homedir(), ".claude", "plugins", "data", "ltm-ltm");
const PROPOSALS_DIR = join(PLUGIN_DATA_DIR, "proposals");

async function findTranscript(sessionId: string | undefined): Promise<{ path: string, id: string } | null> {
  if (!existsSync(HISTORY_FILE)) return null;

  const historyLines = readFileSync(HISTORY_FILE, "utf-8").trim().split('\n');
  if (historyLines.length === 0) return null;

  // Find the entry matching sessionId, or the last one if not provided
  let historyEntry: any = null;
  if (sessionId) {
    // Search backwards
    for (let i = historyLines.length - 1; i >= 0; i--) {
      try {
        const line = JSON.parse(historyLines[i] ?? "");
        if (line.sessionId === sessionId) {
          historyEntry = line;
          break;
        }
      } catch (e) {} // silent: malformed JSONL lines are expected and safely skipped
    }
  } else {
    // Just take the last valid one
    try {
      historyEntry = JSON.parse(historyLines[historyLines.length - 1] ?? "");
    } catch (e) {} // silent: malformed JSONL line is safely skipped
  }

  if (!historyEntry) return null;

  const finalSessionId = historyEntry.sessionId;
  const projectPath = historyEntry.project;
  if (!finalSessionId || !projectPath) return null;

  const filename = `${finalSessionId}.jsonl`;

  // Try registry-resolved project dir first, then scan all project dirs for the session file
  const { projectDir } = resolveProject(projectPath);
  let transcriptPath = join(projectDir, filename);

  if (!existsSync(transcriptPath)) {
    // Claude Code may use a different slug format — scan all dirs
    try {
      const dirs = readdirSync(PROJECTS_DIR);
      for (const dir of dirs) {
        const candidate = join(PROJECTS_DIR, dir, filename);
        if (existsSync(candidate)) {
          transcriptPath = candidate;
          break;
        }
      }
    } catch (_) {} // silent: dir scan failure means we fall through to existsSync check
  }

  if (!existsSync(transcriptPath)) return null;

  return { path: transcriptPath, id: finalSessionId };
}

function extractAssistantText(messages: any[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const content = m?.message?.content;
    if (!Array.isArray(content)) continue;
    if (m?.message?.role !== "assistant") continue;
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string")
        parts.push(block.text.trim());
    }
  }
  const full = parts.join("\n\n");
  return full.length > 8000 ? full.slice(-8000) : full;
}

async function main() {
  let inputStr = "";
  // Hook inputs are optional for this tool now, but we pass through stdin
  try {
    for await (const chunk of Bun.stdin.stream()) {
      const text = new TextDecoder().decode(chunk);
      inputStr += text;
      process.stdout.write(chunk); // Pass through immediately
    }
  } catch (stdinErr) {
    // Stdin might be empty or closed — non-fatal
    logHook("EvaluateSession", "warn", "stdin read failed", String(stdinErr));
  }

  let input: any = {};
  try {
    input = JSON.parse(inputStr);
  } catch {
    // Non-JSON input is acceptable — hooks may receive empty or plain-text stdin
  }

  {
    let transcriptPath = input.transcript_path;
    let sessionId = input.session_id;

    if (!transcriptPath || !existsSync(transcriptPath)) {
      const found = await findTranscript(sessionId);
      if (found) {
        transcriptPath = found.path;
        sessionId = found.id;
      }
    }

    if (!transcriptPath || !existsSync(transcriptPath)) {
      return;
    }

    const transcriptContent = readFileSync(transcriptPath, "utf-8");
    // Parse JSONL
    const messages = transcriptContent.trim().split('\n').map(l => {
        try { return JSON.parse(l); } catch(e) { return null; }
    }).filter(Boolean);

    const messageCount = messages.length;

    if (messageCount < MIN_SESSION_MESSAGES) {
      return;
    }

    if (!existsSync(PATTERNS_DIR)) mkdirSync(PATTERNS_DIR, { recursive: true });

    const today = new Date().toISOString().split('T')[0];
    const patternFile = join(PATTERNS_DIR, `${today}.md`);

    let fileContent = `# Session Patterns: ${today}\n`;
    fileContent += `**Session ID:** ${sessionId || "unknown"}\n`;
    fileContent += `**Messages:** ${messageCount}\n\n---\n\n`;

    // Collect all tool_use content blocks from assistant messages
    const toolUseBlocks: any[] = [];
    messages.forEach((m: any) => {
      const content = m.message?.content;
      if (Array.isArray(content)) {
        content.forEach((block: any) => {
          if (block.type === 'tool_use') toolUseBlocks.push(block);
        });
      }
    });

    // Collect tool result blocks (errors) from user messages
    const errorBlocks: string[] = [];
    messages.forEach((m: any) => {
      const content = m.message?.content;
      if (Array.isArray(content)) {
        content.forEach((block: any) => {
          if (block.type === 'tool_result' && block.is_error) {
            const output = Array.isArray(block.content)
              ? block.content.map((c: any) => c.text || '').join(' ')
              : String(block.content || '');
            errorBlocks.push(output.substring(0, 200).replace(/\n/g, ' '));
          }
        });
      }
      // Also catch top-level error messages
      if (m.type === 'error') {
        errorBlocks.push((m.error?.message || 'Unknown error').substring(0, 200));
      }
    });

    fileContent += "## Errors Encountered\n";
    errorBlocks.slice(0, 10).forEach(msg => fileContent += `- ${msg}\n`);
    fileContent += "\n";

    // Extract Tool Usage
    const toolUsage: Record<string, number> = {};
    toolUseBlocks.forEach((block: any) => {
      toolUsage[block.name] = (toolUsage[block.name] || 0) + 1;
    });

    fileContent += "## Tools Used\n";
    Object.entries(toolUsage)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 10)
      .forEach(([tool, count]) => fileContent += `- ${tool} (${count} times)\n`);
    fileContent += "\n";

    // Extract Files Modified
    const files = new Set<string>();
    toolUseBlocks.forEach((block: any) => {
      if (block.name === 'Write' || block.name === 'Edit' || block.name === 'MultiEdit') {
        const path = block.input?.file_path || block.input?.path;
        if (path) files.add(path);
      }
    });
    fileContent += "## Files Modified\n";
    [...files].slice(0, 20).forEach(f => fileContent += `- ${f}\n`);
    fileContent += "\n";

    writeFileSync(patternFile, fileContent);

    const projectName = resolveProject(input.cwd ?? "").name;

    const proposals: MemoryProposal[] = [];

    for (const msg of errorBlocks.slice(0, 3)) {
      if (msg.trim().length > 20) {
        proposals.push({
          content: msg.trim(),
          category: "gotcha",
          importance: 3,
          source: "evaluate-session",
        });
      }
    }

    try {
      if ((readConfigSync() as Config).ltm?.evaluateSessionLlm) {
        const assistantText = extractAssistantText(messages);
        if (assistantText.length > 100) {
          extractProposals(assistantText, projectName, { source: "evaluate-session", sessionId })
            .then(({ proposals: llmProposals }) => {
              const merged = [...proposals, ...llmProposals];
              if (merged.length > 0) {
                const sid = sessionId ?? `unknown-${Date.now()}`;
                const proposalsPath = join(PROPOSALS_DIR, `${sid}.json`);
                writeProposals(proposalsPath, merged);
                process.stdout.write(
                  JSON.stringify({ type: "ltm_proposal", count: merged.length, proposalsPath }) + "\n"
                );
                logHook("EvaluateSession", "info", `${merged.length} proposals written`, proposalsPath);
              }
            })
            .catch((err: unknown) => {
              logHook("EvaluateSession", "warn", "LLM extraction failed", String(err));
              if (proposals.length > 0) {
                const sid = sessionId ?? `unknown-${Date.now()}`;
                const proposalsPath = join(PROPOSALS_DIR, `${sid}.json`);
                writeProposals(proposalsPath, proposals);
                process.stdout.write(
                  JSON.stringify({ type: "ltm_proposal", count: proposals.length, proposalsPath }) + "\n"
                );
              }
            });
        } else if (proposals.length > 0) {
          // No LLM extraction but we have error-block proposals
          const sid = sessionId ?? `unknown-${Date.now()}`;
          const proposalsPath = join(PROPOSALS_DIR, `${sid}.json`);
          writeProposals(proposalsPath, proposals);
          process.stdout.write(
            JSON.stringify({ type: "ltm_proposal", count: proposals.length, proposalsPath }) + "\n"
          );
          logHook("EvaluateSession", "info", `${proposals.length} proposals written`, proposalsPath);
        }
      } else if (proposals.length > 0) {
        // LLM disabled — write error-block proposals only
        const sid = sessionId ?? `unknown-${Date.now()}`;
        const proposalsPath = join(PROPOSALS_DIR, `${sid}.json`);
        writeProposals(proposalsPath, proposals);
        process.stdout.write(
          JSON.stringify({ type: "ltm_proposal", count: proposals.length, proposalsPath }) + "\n"
        );
        logHook("EvaluateSession", "info", `${proposals.length} proposals written`, proposalsPath);
      }
    } catch (cfgErr) {
      logHook("EvaluateSession", "warn", "Failed to read config for LLM extraction", String(cfgErr));
    }

    logEvent("EvaluateSession", EVENTS.SESSION_EVALUATED, { project: projectName, count: messageCount });

    // Update Summary (deduplicate by sessionId)
    if (!existsSync(SUMMARY_FILE)) {
      writeFileSync(SUMMARY_FILE, "# Learned Patterns Summary\n\nThis file is auto-updated.\n\n---\n\n## Recent Sessions\n\n");
    }

    const summaryContent = readFileSync(SUMMARY_FILE, "utf-8");
    const shortId = sessionId ? sessionId.substring(0, 8) : 'unknown';
    if (!summaryContent.includes(shortId)) {
      const newLine = `- **${today}** (${messageCount} msgs): Session ${shortId}... (Errors: ${errorBlocks.length})\n`;
      const updatedLines = (summaryContent + newLine).split('\n');
      const newSummary = updatedLines.length > MAX_SUMMARY_LINES
        ? updatedLines.slice(0, SUMMARY_HEADER_LINES)
            .concat(updatedLines.slice(updatedLines.length - (MAX_SUMMARY_LINES - SUMMARY_HEADER_LINES)))
            .join('\n')
        : summaryContent + newLine;
      writeFileSync(SUMMARY_FILE, newSummary);
    }
  }
}

await safeRun("EvaluateSession", main);
