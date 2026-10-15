"""_secrets_scrubber.py — Redact secrets from memory content before embedding.

Ported from OpenLTM TypeScript secretsScrubber.ts. Called before any embedding
to prevent secrets from leaking via embedding provider requests. Must never throw.
"""

from __future__ import annotations

from typing import Optional

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
    replacement: object  # str, or a callable taking the match (re.sub semantics)


_KEY_ID_LABELS = frozenset({"accesskeyid", "secretkeyid", "keyid"})


def is_aws_secret_label(label: str) -> bool:
    """Label normalization (lowercase, strip _ - spaces) used ONLY to decide a match.

    Any label containing "aws" or "secret" counts, except "secretary" and key-id
    labels (secret_key_id, AccessKeyId). Keep in parity with secretsScrubber.ts.
    """
    n = re.sub(r"[_\-\s]", "", label.lower())
    if "aws" not in n and "secret" not in n:
        return False
    if "secretary" in n or n in _KEY_ID_LABELS:  # secret_key_id, AccessKeyId
        return False
    return True


def _aws_proximity_repl(m: "re.Match[str]") -> str:
    anchor, rest, sep = m.group(1), m.group(2), m.group(3)
    if not is_aws_secret_label(anchor + rest):
        return m.group(0)
    return f"{anchor}{rest}{sep}[REDACTED:aws-secret-key]"


def _aws_secret_repl(m: "re.Match[str]") -> str:
    label, sep = m.group(1), m.group(2)
    return f"{label}{sep}[REDACTED:aws-secret-key]" if is_aws_secret_label(label) else m.group(0)


# Pre-compiled patterns for performance — order matters (specific before generic)
PATTERNS: Final[tuple[Pattern, ...]] = (
    Pattern(
        id="aws-access-key",
        regex=re.compile(r"(?:AKIA|ASIA)[0-9A-Z]{16}"),  # AKIA long-term, ASIA STS temporary
        replacement="[REDACTED:aws-access-key]",
    ),
    Pattern(
        id="aws-secret-key",
        # label, separator (":" / "=" / whitespace, optional quotes), 40-48 char value.
        # The label decides via is_aws_secret_label; only the VALUE span is replaced.
        regex=re.compile(r"(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]{0,255})([\"']?[ \t]*(?:=>|->|[:=])[ \t]*(?:\r?\n[ \t]{0,16})?[\"']?|[\"']?[ \t]+[\"']?)([0-9a-zA-Z/+]{40,48})(?![0-9a-zA-Z/+])"),
        replacement=_aws_secret_repl,
    ),
    Pattern(
        id="aws-secret-key",
        # Second pass (proximity): aws/secret word, up to 20 name chars, up to 20
        # non-alphanumerics, then a 40-48 char value. Only the value is replaced.
        regex=re.compile(r"([Aa][Ww][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt])([A-Za-z_-]{0,20})([^a-zA-Z0-9]{0,20})([0-9a-zA-Z/+]{40,48})(?![0-9a-zA-Z/+])"),
        replacement=_aws_proximity_repl,
    ),
    Pattern(
        id="aws-session-token",
        # STS SessionToken / AWS_SESSION_TOKEN values are long base64 blobs.
        regex=re.compile(r"([Ss][Ee][Ss][Ss][Ii][Oo][Nn][_-]?[Tt][Oo][Kk][Ee][Nn][^a-zA-Z0-9]{0,20})([A-Za-z0-9/+=]{100,})"),
        replacement=r"\1[REDACTED:aws-session-token]",  # value only; label + separator kept
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
        regex=re.compile(r"(?:api[_-]?key|secret[_-]?key|access[_-]?token)[^a-zA-Z][^\n'\"]{0,200}?['\"][A-Za-z0-9_\-]{20,}['\"]", re.IGNORECASE),
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

class ScrubRefusedError(ValueError):
    """Raised when text cannot be scrubbed; the caller must not store or send it raw."""


def scrub_or_refuse(text: Optional[str]) -> Optional[str]:
    """Fail-closed scrub for writes, twin of the TS scrubOrRefuse.

    Returns the redacted text (None/empty pass through). Unlike scrub_secrets,
    any error raises ScrubRefusedError instead of returning the raw input.
    """
    if text is None or text == "":
        return text
    if not isinstance(text, str):
        raise ScrubRefusedError("refusing to store non-string text")
    try:
        scrubbed = text
        for pattern in PATTERNS:
            scrubbed = pattern.regex.sub(pattern.replacement, scrubbed)
        return scrubbed
    except Exception as e:  # pragma: no cover - defensive
        raise ScrubRefusedError("secret scrubber failed; refusing to store raw text") from e


def scrub_line_for_egress(text: Optional[str]) -> Optional[str]:
    """Scrub one line bound for a prompt; None means drop the line (never emit it raw)."""
    try:
        return scrub_or_refuse(text or "")
    except ScrubRefusedError:
        return None


SCRUB_FAILED_PLACEHOLDER = "[scrub-failed]"


def scrub_payload(obj, _depth: int = 0):
    """Deep-scrub a tool result before it leaves the plugin (twin of TS scrubMemoryPayload).

    Every string in dicts/lists/tuples is scrubbed; a string that cannot be
    scrubbed, or anything nested past depth 32, becomes a stub, never raw.
    """
    if _depth > 32:
        return SCRUB_FAILED_PLACEHOLDER
    if isinstance(obj, str):
        out = scrub_line_for_egress(obj)
        return SCRUB_FAILED_PLACEHOLDER if out is None else out
    if isinstance(obj, dict):
        return {k: scrub_payload(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [scrub_payload(v, _depth + 1) for v in obj]
    return obj
