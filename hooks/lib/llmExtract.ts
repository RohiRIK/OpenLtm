/**
 * llmExtract.ts — Shared LLM extraction logic for EvaluateSession and GitCommit.
 * Sends text to an LLM and stores extracted decisions/gotchas/patterns as LTM memories.
 */
import { learn } from "../../src/db.js";
import { getLlmConfig, callLlm } from "../../src/embeddings.js";
import type { MemoryCategory } from "../../src/db.js";
import type { MemoryProposal } from "./proposalQueue.js";

const SYSTEM_PROMPT = `Extract learnings from the provided text. Return ONLY valid JSON:
{"decisions":["..."],"gotchas":["..."],"patterns":["..."],"progress":"..."}
- decisions: architectural choices made (max 5, <120 chars each)
- gotchas: problems hit and how fixed (max 5, <120 chars each)
- patterns: reusable patterns discovered (max 5, <120 chars each)
- progress: single sentence of what was accomplished
Empty array if nothing found. No markdown fences.`;

const LEARN_ITEMS: Array<{ key: "decisions" | "gotchas" | "patterns"; category: MemoryCategory; importance: number }> = [
  { key: "decisions", category: "architecture", importance: 3 },
  { key: "gotchas",   category: "gotcha",       importance: 4 },
  { key: "patterns",  category: "pattern",       importance: 3 },
];

export interface ExtractOptions {
  source: string;
  tags?: string[];
  sessionId?: string;
  preamble?: string;
}

/** Returns the progress string if extracted, or undefined. */
export async function extractAndLearn(
  text: string,
  projectName: string,
  opts: ExtractOptions,
): Promise<string | undefined> {
  const cfg = getLlmConfig();
  if (!cfg) return;

  const input = opts.preamble ? `${opts.preamble}\n\n${text}` : text;

  const raw = await callLlm(cfg, input, { systemPrompt: SYSTEM_PROMPT, maxTokens: 800, raw: true });
  if (!raw) return;

  let extracted: { decisions: string[]; gotchas: string[]; patterns: string[]; progress: string };
  try {
    extracted = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim());
  } catch {
    return undefined;
  }

  for (const { key, category, importance } of LEARN_ITEMS) {
    for (const item of ((extracted[key] as string[]) ?? []).slice(0, 5)) {
      if (item.length > 10) {
        learn({
          content: item,
          category,
          importance,
          project_scope: projectName,
          source: opts.source,
          tags: opts.tags,
          skipExport: true,
        });
      }
    }
  }

  return extracted.progress?.length > 5 ? extracted.progress : undefined;
}

/** Returns memory proposals without writing to the DB. Caller decides what to persist. */
export async function extractProposals(
  text: string,
  projectName: string,
  opts: ExtractOptions,
): Promise<{ proposals: MemoryProposal[]; progress: string | undefined }> {
  const cfg = getLlmConfig();
  if (!cfg) return { proposals: [], progress: undefined };

  const input = opts.preamble ? `${opts.preamble}\n\n${text}` : text;

  const raw = await callLlm(cfg, input, { systemPrompt: SYSTEM_PROMPT, maxTokens: 800, raw: true });
  if (!raw) return { proposals: [], progress: undefined };

  let extracted: { decisions: string[]; gotchas: string[]; patterns: string[]; progress: string };
  try {
    extracted = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim());
  } catch {
    return { proposals: [], progress: undefined };
  }

  const proposals: MemoryProposal[] = [];
  for (const { key, category, importance } of LEARN_ITEMS) {
    for (const item of ((extracted[key] as string[]) ?? []).slice(0, 5)) {
      if (item.length > 10) {
        proposals.push({ content: item, category, importance, source: opts.source });
      }
    }
  }

  const progress = extracted.progress?.length > 5 ? extracted.progress : undefined;
  return { proposals, progress };
}
