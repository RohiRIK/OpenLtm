/**
 * similarity.ts — Dependency-free text similarity helpers.
 *
 * Used by prefill selection (near-duplicate suppression) and learn hygiene
 * (near-duplicate reinforcement) so both paths agree on "same memory".
 */
import { normalizeKey } from "./dedup.js";

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "to", "of", "in", "on",
  "for", "with", "and", "or", "but", "not", "no", "it", "its", "this", "that", "these",
  "those", "as", "at", "by", "from", "if", "then", "so", "than", "we", "you", "our",
]);

/** Tokenize into comparable lowercase content tokens (stopwords removed). */
export function tokenize(text: string): string[] {
  if (typeof text !== "string") return [];
  return normalizeKey(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Tokenize without dropping anything — used where a difference matters. */
export function tokenizeAll(text: string): string[] {
  if (typeof text !== "string") return [];
  return normalizeKey(text).split(" ").filter(Boolean);
}

/** Jaccard token similarity in [0,1]. Empty-vs-empty is 0, not 1. */
export function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Tokens that look like a counter, suffix, or marker rather than content. */
function isShortMarker(token: string): boolean {
  return token.length <= 2;
}

/**
 * isNearDuplicate — true when two contents describe the same knowledge.
 *
 * Deliberately conservative, because this feeds the learn() path where a false
 * positive silently merges two memories the caller meant to keep apart. Only
 * one rule qualifies: full token containment, i.e. one memory is an elaboration
 * of the other. Looser similarity thresholds merged deliberate siblings
 * ("X high importance" vs "X low importance") and are deliberately absent —
 * reworded duplicates are left to the embedding-based `autoRelate` path.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size < 3 || tb.size < 3) return false;

  // Symmetric difference is computed on the *unfiltered* token list, because
  // stopword/short-token filtering would hide exactly the "…-A" vs "…-B"
  // difference this guard exists to protect.
  const allA = new Set(tokenizeAll(a));
  const allB = new Set(tokenizeAll(b));
  const differing = [
    ...[...allA].filter((t) => !allB.has(t)),
    ...[...allB].filter((t) => !allA.has(t)),
  ];

  // Differing only by short markers (counter/suffix) → intentionally distinct.
  if (differing.length > 0 && differing.every(isShortMarker)) return false;

  const [smaller, larger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let contained = 0;
  for (const token of smaller) {
    if (larger.has(token)) contained++;
  }
  return contained === smaller.size;
}
