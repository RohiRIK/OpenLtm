/**
 * recall/categorise.ts — Heuristic + LLM-fallback category classifier.
 *
 * Strategy:
 *   1. Score each MemoryCategory by keyword density in the content.
 *   2. If the top score meets or exceeds confidenceThreshold → return it.
 *   3. Otherwise call Anthropic Messages API (claude-haiku) to classify.
 *   4. If LLM call fails, fall back to the best heuristic guess.
 */

import type { MemoryCategory } from "../db.js";

export interface CategoriseResult {
  category: MemoryCategory;
  confidence: number;
  source: "heuristic" | "llm";
}

// ── Keyword tables ─────────────────────────────────────────────────────────────

const KEYWORDS: Record<MemoryCategory, string[]> = {
  preference: [
    "prefer", "always use", "convention", "style", "format", "naming",
    "use .* not", "default", "standard", "i like", "we use",
  ],
  architecture: [
    "architecture", "design", "structure", "system", "component", "module",
    "layer", "schema", "database", "api", "interface", "integration",
    "dependency", "abstraction", "service",
  ],
  gotcha: [
    "warning", "pitfall", "bug", "avoid", "never", "don't", "dont",
    "broken", "fail", "trap", "careful", "watch out", "⚠", "issue",
    "error", "problem", "beware",
  ],
  pattern: [
    "pattern", "approach", "recipe", "template", "boilerplate",
    "solution", "technique", "method", "strategy", "implement",
    "how to", "example", "reusable",
  ],
  workflow: [
    "process", "step", "procedure", "workflow", "pipeline",
    "sequence", "flow", "first", "then", "finally", "checklist",
    "before", "after", "when to",
  ],
  constraint: [
    "must", "required", "mandatory", "cannot", "should not",
    "limit", "restriction", "enforce", "rule", "policy", "compliance",
    "always", "never allowed", "forbidden",
  ],
};

// ── Heuristic scorer ───────────────────────────────────────────────────────────

function scoreHeuristic(content: string): { category: MemoryCategory; confidence: number } {
  const lower = content.toLowerCase();

  const scores = Object.entries(KEYWORDS).map(([cat, keywords]) => {
    let hits = 0;
    for (const kw of keywords) {
      const re = new RegExp(kw, "gi");
      const matches = lower.match(re);
      if (matches) hits += matches.length;
    }
    return { category: cat as MemoryCategory, hits };
  });

  const total = scores.reduce((s, x) => s + x.hits, 0);
  const best = scores.sort((a, b) => b.hits - a.hits)[0];

  if (!best || best.hits === 0) {
    return { category: "pattern", confidence: 0 };
  }

  // Confidence = share of total hits, clamped to [0, 1].
  // A dominant category scores high; if two categories are equal, confidence halves.
  const confidence = Math.min(best.hits / Math.max(total, 1), 1);
  return { category: best.category, confidence };
}

// ── LLM fallback ───────────────────────────────────────────────────────────────

const CATEGORIES_LIST = Object.keys(KEYWORDS).join(", ");
const VALID_CATEGORIES = new Set<string>(Object.keys(KEYWORDS));

async function classifyWithLlm(content: string): Promise<MemoryCategory | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        messages: [{
          role: "user",
          content: `Classify this memory into exactly one category. Reply with only the category name, nothing else.\n\nCategories: ${CATEGORIES_LIST}\n\nMemory: ${content.slice(0, 500)}`,
        }],
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;

    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.[0]?.text?.trim().toLowerCase() ?? "";

    return VALID_CATEGORIES.has(text) ? (text as MemoryCategory) : null;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function categorise(
  content: string,
  confidenceThreshold = 0.6,
): Promise<CategoriseResult> {
  const heuristic = scoreHeuristic(content);

  if (heuristic.confidence >= confidenceThreshold) {
    return { ...heuristic, source: "heuristic" };
  }

  const llmCategory = await classifyWithLlm(content);
  if (llmCategory) {
    return { category: llmCategory, confidence: 1.0, source: "llm" };
  }

  // LLM unavailable or failed — return best heuristic guess regardless of confidence
  return { ...heuristic, source: "heuristic" };
}
