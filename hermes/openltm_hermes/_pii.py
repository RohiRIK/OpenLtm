"""_pii.py — Mask personal data before text leaves for a third-party model.

Twin of OpenLTM core's pii.ts: same pattern ids, placeholders and modes, and
the same precision rules (card numbers must pass Luhn; loopback and
unspecified IPs stay). Memories store personal data as written; only text
bound for an embedding provider is masked. Mode comes from LTM_MASK_PII:
``providers`` (default), ``all`` (also tool results to the agent) or ``off``.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Callable, Optional

PII_MODES = ("off", "providers", "all")


def luhn_valid(candidate: str) -> bool:
    digits = re.sub(r"\D", "", candidate)
    if len(digits) < 13 or len(digits) > 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


_NON_PERSONAL_IPS = frozenset({"127.0.0.1", "0.0.0.0", "255.255.255.255"})


@dataclass(frozen=True)
class PiiPattern:
    id: str
    placeholder: str
    regex: "re.Pattern[str]"
    accept: Optional[Callable[[str], bool]] = None


# Keep in parity with PII_PATTERNS in packages/openltm-core/src/pii.ts (order matters).
PII_PATTERNS = (
    PiiPattern("email", "[EMAIL]", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")),
    PiiPattern("credit-card", "[CREDIT_CARD]", re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])"), luhn_valid),
    PiiPattern("ssn", "[SSN]", re.compile(r"(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])")),
    PiiPattern(
        "phone",
        "[PHONE]",
        re.compile(
            r"(?<![\w+.-])(?:\+\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,3}"
            r"|(?:\(\d{3}\) ?|\d{3}[.-])\d{3}[.-]\d{4})(?![\w-])"
        ),
    ),
    PiiPattern(
        "ipv4",
        "[IP_ADDRESS]",
        re.compile(r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])"),
        lambda m: m not in _NON_PERSONAL_IPS and not m.startswith("127."),
    ),
)


def mask_pii(text: str) -> tuple[str, list[str]]:
    """Return (masked text, matched pattern ids). Never raises: returns the input on error."""
    if not text:
        return text, []
    try:
        masked = text
        found: list[str] = []
        for p in PII_PATTERNS:
            hit = False

            def repl(m: "re.Match[str]", p: PiiPattern = p) -> str:
                nonlocal hit
                if p.accept and not p.accept(m.group(0)):
                    return m.group(0)
                hit = True
                return p.placeholder

            masked = p.regex.sub(repl, masked)
            if hit:
                found.append(p.id)
        return masked, found
    except Exception:  # pragma: no cover - defensive
        return text, []


def pii_mode() -> str:
    mode = (os.environ.get("LTM_MASK_PII") or "").strip().lower()
    return mode if mode in PII_MODES else "providers"


def mask_pii_for_provider(text: str) -> str:
    return text if pii_mode() == "off" else mask_pii(text)[0]


def mask_pii_for_agent(text: str) -> str:
    return mask_pii(text)[0] if pii_mode() == "all" else text
