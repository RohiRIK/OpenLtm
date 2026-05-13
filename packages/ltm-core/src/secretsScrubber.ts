/**
 * secretsScrubber.ts — Redact secrets from LTM memory content before DB writes.
 * Called from learn() in db.ts. Must never throw.
 */

export interface ScrubResult {
  scrubbed: string;
  redactions: string[]; // deduplicated pattern IDs found
}

interface Pattern {
  id: string;
  regex: RegExp;
  replacement: string;
}

const PATTERNS: Pattern[] = [
  {
    id: "aws-access-key",
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED:aws-access-key]",
  },
  {
    id: "aws-secret-key",
    // 40-char base64 string near aws/secret context
    regex: /(?:aws|secret|SECRET)[^a-zA-Z0-9]{0,20}[0-9a-zA-Z/+]{40}(?![0-9a-zA-Z/+])/g,
    replacement: "[REDACTED:aws-secret-key]",
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

export function scrubSecrets(text: string): ScrubResult {
  try {
    if (!text) return { scrubbed: text, redactions: [] };

    let scrubbed = text;
    const found = new Set<string>();

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      const next = scrubbed.replace(pattern.regex, pattern.replacement);
      if (next !== scrubbed) found.add(pattern.id);
      scrubbed = next;
    }

    return { scrubbed, redactions: [...found] };
  } catch {
    // Never throw — return original text on any error
    return { scrubbed: text, redactions: [] };
  }
}
