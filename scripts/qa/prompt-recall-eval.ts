#!/usr/bin/env bun
/**
 * qa/prompt-recall-eval.ts — measures UserPromptSubmit relevance on the labelled
 * corpus in src/__tests__/hooks/fixtures/promptRecallCorpus.ts: per-prompt hits,
 * noise (hits that are neither wanted nor harmless) and missed wanted memories.
 *
 * Usage (repo root): bun run scripts/qa/prompt-recall-eval.ts [--verbose]
 */
import { join } from "path";
import { CORPUS, PROMPTS } from "../../src/__tests__/hooks/fixtures/promptRecallCorpus";
import { DEFAULT_PROMPT_RECALL_LIMIT, searchPromptMemories } from "../../hooks/lib/promptRecall";
import { initSandboxDb, makeSandbox, seedMemory } from "../../src/__tests__/hooks/hookHarness";

export interface EvalResult { prompts: number; hits: number; noise: number; wanted: number; found: number; noisyPrompts: number; rows: string[] }

export function evaluate(): EvalResult {
  const sb = makeSandbox("prompt-eval");
  try {
    initSandboxDb(sb);
    const idToKey = new Map<number, string>();
    for (const m of CORPUS) idToKey.set(seedMemory(sb, { content: m.content, category: m.category, project: m.project }), m.key);
    const r: EvalResult = { prompts: PROMPTS.length, hits: 0, noise: 0, wanted: 0, found: 0, noisyPrompts: 0, rows: [] };
    for (const p of PROMPTS) {
      const keys = searchPromptMemories(sb.dbPath, { prompt: p.prompt, project: p.project, limit: DEFAULT_PROMPT_RECALL_LIMIT })
        .map((h) => idToKey.get(h.id)!);
      const noise = keys.filter((k) => !p.want.includes(k) && !(p.ok ?? []).includes(k));
      const missed = p.want.filter((k) => !keys.includes(k));
      r.hits += keys.length;
      r.noise += noise.length;
      r.wanted += p.want.length;
      r.found += p.want.length - missed.length;
      if (noise.length > 0) r.noisyPrompts++;
      r.rows.push(`${noise.length || missed.length ? "✗" : "✓"} [${p.project}] ${p.prompt}\n    hits=${keys.join(",") || "-"}${noise.length ? `  NOISE=${noise.join(",")}` : ""}${missed.length ? `  MISSED=${missed.join(",")}` : ""}`);
    }
    return r;
  } finally {
    sb.cleanup();
  }
}

if (import.meta.main) {
  const r = evaluate();
  if (process.argv.includes("--verbose")) console.log(r.rows.join("\n") + "\n");
  const precision = r.hits ? (r.hits - r.noise) / r.hits : 1;
  console.log(`prompts=${r.prompts} injected=${r.hits} noise=${r.noise} (${r.noisyPrompts} prompts with noise)`);
  console.log(`precision=${(precision * 100).toFixed(1)}%  recall=${((r.found / r.wanted) * 100).toFixed(1)}% (${r.found}/${r.wanted} wanted memories surfaced)`);
}
