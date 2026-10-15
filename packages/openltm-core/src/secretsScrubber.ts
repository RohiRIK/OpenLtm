/**
 * secretsScrubber.ts — Redact secrets from LTM memory content before DB writes.
 *
 * Fail-closed: on any scrub error, return a placeholder — never the original
 * text. Callers must use scrubOrRefuse() (or scrubSecrets()) before INSERT/UPDATE
 * of durable content so secrets cannot land in SQLite via a write bypass.
 */

export interface ScrubResult {
  scrubbed: string;
  redactions: string[]; // deduplicated pattern IDs found
}

/** Stored when scrub itself fails — never the original caller text. */
export const SCRUB_FAILED_PLACEHOLDER = "[REDACTED:scrub-failed]";

interface Pattern {
  id: string;
  regex: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

/**
 * Label normalization for AWS secret keys: lowercase and strip "_", "-" and spaces,
 * used ONLY to decide whether a label names an AWS secret. Matches any label
 * containing "aws" or "secret" (aws_secret=, AWS_SECRET_ACCESS_KEY, SecretAccessKey,
 * Aws_Secret_Access_Key, terraform secret_key, MY_..._AWS_SECRET_ACCESS_KEY), but not
 * "secretary" or a label that is exactly accesskeyid/secretkeyid/keyid once normalized.
 * Keep in parity with _secrets_scrubber.py.
 */
const KEY_ID_LABELS = new Set(["accesskeyid", "secretkeyid", "keyid"]);

export function isAwsSecretLabel(label: string): boolean {
  const n = label.toLowerCase().replace(/[_\-\s]/g, "");
  if (!n.includes("aws") && !n.includes("secret")) return false;
  if (n.includes("secretary") || KEY_ID_LABELS.has(n)) return false; // secret_key_id, AccessKeyId
  return true;
}

const PATTERNS: Pattern[] = [
  {
    id: "aws-access-key",
    regex: /(?:AKIA|ASIA)[0-9A-Z]{16}/g, // long-term (AKIA) and STS temporary (ASIA) key ids
    replacement: "[REDACTED:aws-access-key]",
  },
  {
    id: "aws-secret-key",
    // label, separator (":" / "=" / whitespace, optional quotes), 40-48 char value.
    // The label decides via isAwsSecretLabel; only the VALUE span is replaced.
    regex: /(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]{0,255})(["']?[ \t]*(?:=>|->|[:=])[ \t]*(?:\r?\n[ \t]{0,16})?["']?|["']?[ \t]+["']?)([0-9a-zA-Z/+]{40,48})(?![0-9a-zA-Z/+])/g,
    replacement: (m: string, label: string, sep: string) =>
      isAwsSecretLabel(label) ? `${label}${sep}[REDACTED:aws-secret-key]` : m,
  },
  {
    id: "aws-secret-key",
    // Second pass (proximity): an aws/secret word, up to 20 name chars, up to 20
    // non-alphanumerics, then a 40-48 char value: aws-<v>, aws secret, <v>,
    // AWS_SECRET_ACCESS_KEY(<v>), s3://bucket/aws/<v>/x. Only the value is replaced.
    regex: /([Aa][Ww][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt])([A-Za-z_-]{0,20})([^a-zA-Z0-9]{0,20})([0-9a-zA-Z/+]{40,48})(?![0-9a-zA-Z/+])/g,
    replacement: (m: string, anchor: string, rest: string, sep: string) =>
      isAwsSecretLabel(anchor + rest) ? `${anchor}${rest}${sep}[REDACTED:aws-secret-key]` : m,
  },
  {
    id: "aws-session-token",
    // STS SessionToken / AWS_SESSION_TOKEN values are long base64 blobs.
    regex: /([Ss][Ee][Ss][Ss][Ii][Oo][Nn][_-]?[Tt][Oo][Kk][Ee][Nn][^a-zA-Z0-9]{0,20})([A-Za-z0-9/+=]{100,})/g,
    replacement: "$1[REDACTED:aws-session-token]", // value only; label + separator kept
  },
  {
    id: "github-token",
    regex: /gh[ps]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82}/g,
    replacement: "[REDACTED:github-token]",
  },
  {
    id: "openai-key",
    regex: /sk-proj-[a-zA-Z0-9_-]{40,}(?![a-zA-Z0-9_-])|sk-[a-zA-Z0-9]{40,}(?![a-zA-Z0-9_-])/g,
    replacement: "[REDACTED:openai-key]",
  },
  {
    id: "anthropic-key",
    regex: /sk-ant-[a-zA-Z0-9_-]{93,}/g,
    replacement: "[REDACTED:anthropic-key]",
  },
  {
    id: "google-api-key",
    regex: /AIza[0-9A-Za-z_-]{35}/g,
    replacement: "[REDACTED:google-api-key]",
  },
  {
    id: "stripe-key",
    regex: /(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}/g,
    replacement: "[REDACTED:stripe-key]",
  },
  {
    id: "slack-token",
    regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
    replacement: "[REDACTED:slack-token]",
  },
  {
    id: "jwt",
    regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "[REDACTED:jwt]",
  },
  {
    id: "bearer-token",
    regex: /Bearer\s+[A-Za-z0-9._\-]{20,}/gi,
    replacement: "Bearer [REDACTED:bearer-token]",
  },
  {
    id: "connection-string",
    regex: /(?:postgres|mysql|mongodb|redis):\/\/[^@\s]+@[^\s]+/gi,
    replacement: "[REDACTED:connection-string]",
  },
  {
    id: "private-key",
    regex: /-----BEGIN [\w\s]*PRIVATE KEY-----[\s\S]*?-----END [\w\s]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:private-key]",
  },
  {
    id: "generic-api-key",
    regex: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)[^a-zA-Z].*?['"][A-Za-z0-9_\-]{20,}['"]/gi,
    replacement: "[REDACTED:generic-api-key]",
  },
];

/** Test-only: force scrubSecrets into its catch path. */
let forceThrowForTesting = false;

/** @internal — used by scrub-writes tests to exercise fail-closed catch. */
export function _forceScrubThrowForTesting(value: boolean): void {
  forceThrowForTesting = value;
}

/**
 * Redact known secret patterns. Fail-closed: on any error returns
 * SCRUB_FAILED_PLACEHOLDER, never the original text.
 */
export function scrubSecrets(text: string): ScrubResult {
  try {
    if (forceThrowForTesting) throw new Error("scrub forced throw (test)");
    if (!text) return { scrubbed: text, redactions: [] };

    let scrubbed = text;
    const found = new Set<string>();

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      const next = scrubbed.replace(pattern.regex, pattern.replacement as never);
      if (next !== scrubbed) found.add(pattern.id);
      scrubbed = next;
    }

    return { scrubbed, redactions: [...found] };
  } catch {
    // Fail-closed — never return original text into a durable write path.
    return { scrubbed: SCRUB_FAILED_PLACEHOLDER, redactions: ["scrub-failed"] };
  }
}

/**
 * Shared write-path helper. All durable content INSERT/UPDATE sites should call
 * this (or scrubSecrets — same fail-closed contract) before persisting text.
 */
export function scrubOrRefuse(text: string): ScrubResult {
  return scrubSecrets(text);
}

/**
 * Scrub text before it leaves the process (hooks, MCP, LLM/embed providers).
 *
 * Egress fail-closed (different shape from store):
 * - On success: redacted text (secrets replaced)
 * - On scrub failure: SCRUB_FAILED_PLACEHOLDER stub — NEVER the raw original
 * Callers may omit the item entirely when scrubbed === SCRUB_FAILED_PLACEHOLDER;
 * they must not send raw text either way.
 */
export function scrubForEgress(text: string): string {
  const { scrubbed, redactions } = scrubOrRefuse(text);
  if (redactions.includes("scrub-failed")) return SCRUB_FAILED_PLACEHOLDER;
  return scrubbed;
}

/** True when egress should prefer omitting the item over showing a stub. */
export function isEgressScrubFailed(scrubbed: string): boolean {
  return scrubbed === SCRUB_FAILED_PLACEHOLDER;
}
