/**
 * pii.ts — Mask personal data before text leaves for a third-party model.
 *
 * Secrets are scrubbed on every write (secretsScrubber.ts). Personal data is
 * different: an email or phone number in a memory is often the point of the
 * memory, so it is stored and shown to the agent as written. What changes is
 * egress to providers: the categoriser, session-end extraction, relation
 * classification, the janitor's LLM, and embedding providers get placeholders
 * instead ([EMAIL], [PHONE], [CREDIT_CARD], [SSN], [IP_ADDRESS]).
 *
 * Mode (env LTM_MASK_PII, else config ltm.maskPii):
 *   providers (default)  mask on the way to LLM / embedding providers
 *   all                  also mask everything sent to the agent (MCP, hooks)
 *   off                  never mask
 *
 * Patterns are English/US-centric on purpose (the store is English-only) and
 * err toward precision: card numbers must pass Luhn, loopback and unspecified
 * IPs are left alone. Hermes has a twin in _pii.py with the same pattern ids.
 * Inspired by memvid's query-time PII masking.
 */
import { readConfigSync } from "./config.js";

export type PiiMode = "off" | "providers" | "all";
export const PII_MODES: readonly PiiMode[] = ["off", "providers", "all"];

export interface PiiPattern {
  id: string;
  placeholder: string;
  regex: RegExp;
  /** Extra check on a match; false keeps the original text. */
  accept?: (match: string) => boolean;
}

/** Luhn checksum over the digits of a candidate card number. */
export function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const NON_PERSONAL_IPS = new Set(["127.0.0.1", "0.0.0.0", "255.255.255.255"]);

/** Order matters: cards before phones (a card has phone-like runs). */
export const PII_PATTERNS: readonly PiiPattern[] = [
  { id: "email", placeholder: "[EMAIL]", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { id: "credit-card", placeholder: "[CREDIT_CARD]", regex: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, accept: luhnValid },
  { id: "ssn", placeholder: "[SSN]", regex: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g },
  {
    id: "phone",
    placeholder: "[PHONE]",
    // +<country> groups, or a US-style (555) 123-4567 / 555-123-4567 / 555.123.4567.
    regex: /(?<![\w+.-])(?:\+\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,3}|(?:\(\d{3}\) ?|\d{3}[.-])\d{3}[.-]\d{4})(?![\w-])/g,
  },
  {
    id: "ipv4",
    placeholder: "[IP_ADDRESS]",
    regex: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
    accept: (m) => !NON_PERSONAL_IPS.has(m) && !m.startsWith("127."),
  },
];

export const PII_PLACEHOLDERS: readonly string[] = PII_PATTERNS.map((p) => p.placeholder);

export interface PiiMaskResult {
  masked: string;
  /** Pattern ids that matched, deduplicated, in pattern order. */
  found: string[];
}

/** Replace personal data with placeholders. Pure; never throws (returns the input on error). */
export function maskPii(text: string): PiiMaskResult {
  if (!text) return { masked: text, found: [] };
  try {
    let masked = text;
    const found: string[] = [];
    for (const p of PII_PATTERNS) {
      p.regex.lastIndex = 0;
      let hit = false;
      masked = masked.replace(p.regex, (m) => {
        if (p.accept && !p.accept(m)) return m;
        hit = true;
        return p.placeholder;
      });
      if (hit) found.push(p.id);
    }
    return { masked, found };
  } catch {
    return { masked: text, found: [] };
  }
}

/** True when `text` holds a placeholder that `original` did not: provider output built on masked input. */
export function introducesPiiPlaceholder(text: string, original: string): boolean {
  return PII_PLACEHOLDERS.some((ph) => text.includes(ph) && !original.includes(ph));
}

let cachedMode: PiiMode | null = null;

/** The active mode. Read once per process; tests reset it with _resetPiiModeForTesting. */
export function piiMode(): PiiMode {
  if (cachedMode) return cachedMode;
  const env = process.env.LTM_MASK_PII?.trim().toLowerCase();
  let mode: PiiMode = "providers";
  if (env && (PII_MODES as readonly string[]).includes(env)) mode = env as PiiMode;
  else {
    try {
      const cfg = readConfigSync() as { ltm?: { maskPii?: unknown } };
      const v = typeof cfg.ltm?.maskPii === "string" ? cfg.ltm.maskPii.toLowerCase() : undefined;
      if (v && (PII_MODES as readonly string[]).includes(v)) mode = v as PiiMode;
    } catch { /* unreadable config: default */ }
  }
  cachedMode = mode;
  return mode;
}

/** Test seam: forget the cached mode so the next call re-reads env/config. */
export function _resetPiiModeForTesting(): void {
  cachedMode = null;
}

/** Mask for a provider-bound text unless the mode is off. */
export function maskPiiForProvider(text: string): string {
  return piiMode() === "off" ? text : maskPii(text).masked;
}

/** Mask for an agent-bound text only in "all" mode. */
export function maskPiiForAgent(text: string): string {
  return piiMode() === "all" ? maskPii(text).masked : text;
}
