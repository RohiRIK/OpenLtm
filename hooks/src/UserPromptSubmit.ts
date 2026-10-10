#!/usr/bin/env bun
/**
 * UserPromptSubmit.ts — per-prompt auto-recall.
 *
 * Claude Code parity with the Pi adapter's `before_agent_start` and OpenClaw's
 * `registerMemoryPromptPreparation`: before the model sees a prompt, look up
 * memories relevant to it and add them to context (stdout on exit 0 is injected).
 *
 * FTS-only and read-only (see lib/promptRecall.ts) so it stays well inside the
 * hook's 5s timeout. Prints nothing when there is nothing relevant.
 *
 * Skips: ltm.autoRecall === false, ltm.promptRecall === false, slash commands,
 * prompts shorter than ~15 chars, missing DB. Never re-injects a memory within
 * a session (IDs tracked in ${tmpdir}/ltm-prompt-recall-<session_id>.json).
 */
import { existsSync } from "fs";
import { readStdin, safeRun } from "../lib/hookUtils.js";
import { getDbPath, resolveProject } from "../lib/resolveProject.js";
import { logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { readConfigSync } from "../../src/config.js";
import {
  promptSkipReason, promptRecallLimit, searchPromptMemories, formatPromptRecall,
  readInjectedIds, recordInjectedIds,
} from "../lib/promptRecall.js";

async function main(): Promise<void> {
  let input: Record<string, unknown>;
  try { input = JSON.parse(await readStdin()) as Record<string, unknown>; }
  catch { return; } // no/malformed payload — nothing to recall against

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const cfg = readConfigSync();
  if (promptSkipReason(prompt, cfg)) return;

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return;

  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  const project = cwd ? resolveProject(cwd).name : null;
  const sessionId = typeof input.session_id === "string" ? input.session_id : undefined;

  const hits = searchPromptMemories(dbPath, {
    prompt,
    project,
    limit: promptRecallLimit(cfg),
    exclude: readInjectedIds(sessionId),
  });
  if (hits.length === 0) return;

  recordInjectedIds(sessionId, hits.map(h => h.id));
  process.stdout.write(formatPromptRecall(hits));
  logEvent("UserPromptSubmit", EVENTS.PROMPT_RECALL, { project: project ?? undefined, count: hits.length });
}

await safeRun("UserPromptSubmit", main);
