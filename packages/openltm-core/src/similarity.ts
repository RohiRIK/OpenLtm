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
 * Words that flip or bound a statement. Two memories that differ by one of
 * these say different things ("do not run X" vs "do run X"), even though
 * tokenize() drops "not"/"no" as stopwords and the rest of the text matches.
 */
const POLARITY_WORDS = new Set([
  "not", "no", "never", "always", "dont", "cannot", "cant", "wont", "without",
  "avoid", "allow", "deny", "forbid", "enable", "enabled", "disable", "disabled",
  "true", "false", "must", "should", "only", "required", "optional", "deprecated",
  "before", "after", "increase", "decrease", "more", "less", "min", "max",
]);

/** A marker-like token: short (counter/suffix/letter) or containing a digit. */
function isMarker(token: string): boolean {
  return isShortMarker(token) || /\d/.test(token);
}

/**
 * differsMeaningfully — true when two texts say different things even though
 * their content tokens largely match. Compared on the unfiltered token lists,
 * because tokenize() drops exactly these differences (short tokens, "not"/"no").
 *
 * Distinct when:
 *  - either side has a polarity word the other lacks ("do not run" vs "do run");
 *  - both sides have their own marker — a substitution ("plan A" vs "plan B",
 *    "retry 3" vs "retry 5");
 *  - the whole difference is short markers (the original "…-A" vs "…-B" rule).
 * An elaboration that only adds detail on one side ("… at 100 per 6 hours")
 * is not distinct.
 */
export function differsMeaningfully(a: string, b: string): boolean {
  const allA = new Set(tokenizeAll(a));
  const allB = new Set(tokenizeAll(b));
  const onlyA = [...allA].filter((t) => !allB.has(t));
  const onlyB = [...allB].filter((t) => !allA.has(t));
  const differing = [...onlyA, ...onlyB];
  if (differing.length === 0) return false;
  if (differing.some((t) => POLARITY_WORDS.has(t))) return true;
  if (onlyA.some(isMarker) && onlyB.some(isMarker)) return true;
  return differing.every(isShortMarker);
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

  // Differing by a marker, number, or polarity word → intentionally distinct.
  if (differsMeaningfully(a, b)) return false;

  const [smaller, larger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let contained = 0;
  for (const token of smaller) {
    if (larger.has(token)) contained++;
  }
  return contained === smaller.size;
}
