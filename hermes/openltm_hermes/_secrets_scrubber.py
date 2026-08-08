"""_secrets_scrubber.py — Redact secrets from memory content before embedding.

Ported from OpenLTM TypeScript secretsScrubber.ts. Called before any embedding
to prevent secrets from leaking via embedding provider requests. Must never throw.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class ScrubResult:
    """Result of secret scrubbing."""
    scrubbed: str
    redactions: list[str]  # deduplicated pattern IDs found


@dataclass(frozen=True)
class Pattern:
    """Secret detection pattern."""
    id: str
    regex: re.Pattern
    replacement: str


# Pre-compiled patterns for performance — order matters (specific before generic)
PATTERNS: Final[tuple[Pattern, ...]] = (
    Pattern(
        id="aws-access-key",
        regex=re.compile(r"AKIA[0-9A-Z]{16}"),
        replacement="[REDACTED:aws-access-key]",
    ),
    Pattern(
        id="aws-secret-key",
        # 40-char base64 string near aws/secret context
        regex=re.compile(r"(?:aws|secret|SECRET)[^a-zA-Z0-9]{0,20}[0-9a-zA-Z/+]{40}(?![0-9a-zA-Z/+])"),
        replacement="[REDACTED:aws-secret-key]",
    ),
    Pattern(
        id="github-token",
        regex=re.compile(r"gh[ps]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82}"),
        replacement="[REDACTED:github-token]",
    ),
    Pattern(
        id="openai-key",
        regex=re.compile(r"sk-proj-[a-zA-Z0-9_-]{40,}(?![a-zA-Z0-9_-])|sk-[a-zA-Z0-9]{40,}(?![a-zA-Z0-9_-])"),
        replacement="[REDACTED:openai-key]",
    ),
    Pattern(
        id="anthropic-key",
        regex=re.compile(r"sk-ant-[a-zA-Z0-9_-]{93,}"),
        replacement="[REDACTED:anthropic-key]",
    ),
    Pattern(
        id="google-api-key",
        regex=re.compile(r"AIza[0-9A-Za-z_-]{35}"),
        replacement="[REDACTED:google-api-key]",
    ),
    Pattern(
        id="stripe-key",
        regex=re.compile(r"(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}"),
        replacement="[REDACTED:stripe-key]",
    ),
    Pattern(
        id="slack-token",
        regex=re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}"),
        replacement="[REDACTED:slack-token]",
    ),
    Pattern(
        id="jwt",
        regex=re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
        replacement="[REDACTED:jwt]",
    ),
    Pattern(
        id="bearer-token",
        regex=re.compile(r"Bearer\s+[A-Za-z0-9._\-]{20,}", re.IGNORECASE),
        replacement="Bearer [REDACTED:bearer-token]",
    ),
    Pattern(
        id="connection-string",
        regex=re.compile(r"(?:postgres|mysql|mongodb|redis):\/\/[^@\s]+@[^\s]+", re.IGNORECASE),
        replacement="[REDACTED:connection-string]",
    ),
    Pattern(
        id="private-key",
        regex=re.compile(r"-----BEGIN [\w\s]*PRIVATE KEY-----[\s\S]*?-----END [\w\s]*PRIVATE KEY-----"),
        replacement="[REDACTED:private-key]",
    ),
    Pattern(
        id="generic-api-key",
        regex=re.compile(r"(?:api[_-]?key|secret[_-]?key|access[_-]?token)[^a-zA-Z].*?['\"][A-Za-z0-9_\-]{20,}['\"]", re.IGNORECASE),
        replacement="[REDACTED:generic-api-key]",
    ),
)


def scrub_secrets(text: str) -> ScrubResult:
    """Redact known secret patterns from text before embedding/storage.

    Never throws — returns original text on any error.
    """
    try:
        if not text:
            return ScrubResult(scrubbed=text, redactions=[])

        scrubbed = text
        found: set[str] = set()

        for pattern in PATTERNS:
            # Reset regex lastIndex for global patterns
            next_scrubbed = pattern.regex.sub(pattern.replacement, scrubbed)
            if next_scrubbed != scrubbed:
                found.add(pattern.id)
            scrubbed = next_scrubbed

        return ScrubResult(scrubbed=scrubbed, redactions=sorted(found))
    except Exception:
        # Never throw — fail open, return original
        return ScrubResult(scrubbed=text, redactions=[])


def scrub_secrets_for_embedding(text: str) -> str:
    """Convenience wrapper: return only the scrubbed text for embedding calls."""
    return scrub_secrets(text).scrubbed