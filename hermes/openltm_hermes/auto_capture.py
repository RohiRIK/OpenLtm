"""auto_capture — the single source of truth for automatic memory capture.

Before this module the plugin had the same extraction logic living in two
places (`sync_turn` and `on_session_end`) with two different keyword lists, two
different distillation behaviours, and a stack of one-off regexes patched on
after individual incidents. This module replaces that with:

  * one ordered, declarative rule table (:data:`RULES`)
  * named guards (:func:`is_transient_operational`,
    :func:`is_read_only_memory_request`) that are individually testable
  * one distillation routine shared by every capture path
  * two entry points — :func:`evaluate_turn` and :func:`evaluate_session` — that
    return *decisions*, so callers only decide what to do with them

Callers should treat a returned decision as "this is worth remembering" and are
free to skip storing it; nothing here touches the database.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

__all__ = [
    "CaptureDecision",
    "CaptureRule",
    "RULES",
    "USER_RULES",
    "ASSISTANT_RULES",
    "SPEECH_MARKERS",
    "distill",
    "evaluate_session",
    "evaluate_turn",
    "is_read_only_memory_request",
    "is_transient_operational",
]


# ── Rules ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CaptureRule:
    """A single class of knowledge worth remembering automatically."""

    name: str
    #: Which side of the turn the rule applies to: ``"user"`` or ``"assistant"``.
    side: str
    #: Any one of these substrings (lowercased) activates the rule.
    keywords: tuple[str, ...]
    category: str
    importance: int


# Order matters: the first matching rule wins. Constraints are evaluated before
# preferences because a statement like "Always use Bun, never npm" is a hard rule
# that also contains "use ", and misfiling it as a soft preference loses its
# weight. A correction still outranks everything so it is never downgraded.
USER_RULES: tuple[CaptureRule, ...] = (
    CaptureRule(
        name="correction",
        side="user",
        keywords=(
            "wrong", "incorrect", "no,", "no.", "don't", "dont", "stop",
            "fix", "error", "mistake", "that's not", "thats not", "not right",
            "bad idea", "revert", "undo",
        ),
        category="gotcha",
        importance=4,
    ),
    CaptureRule(
        name="constraint",
        side="user",
        keywords=(
            "never", "always", "must", "don't ever", "do not", "should not",
            "can't", "cannot", "only if", "required", "make sure",
        ),
        category="constraint",
        importance=4,
    ),
    CaptureRule(
        name="preference",
        side="user",
        keywords=(
            "prefer", "like", "want", "use ", "always use", "i need",
            "i'd rather", "id rather", "favorite", "favourite", "wish",
            "hope", "expect", "let's stick with", "stick to",
        ),
        category="preference",
        importance=3,
    ),
    CaptureRule(
        name="decision",
        side="user",
        keywords=(
            "let's", "lets ", "we'll", "well ", "going with", "decided",
            "choose", "use this", "settled on", "picked", "agreed", "we chose",
        ),
        category="architecture",
        importance=3,
    ),
)

ASSISTANT_RULES: tuple[CaptureRule, ...] = (
    CaptureRule(
        name="discovery",
        side="assistant",
        keywords=(
            "found that", "discovered", "turns out", "the fix is",
            "is configured as", "is set to", "the error was",
            "the issue is", "root cause", "solution is", "works by",
            "note that", "remember that", "key insight",
        ),
        category="gotcha",
        importance=3,
    ),
)

#: Every rule, in evaluation order.
RULES: tuple[CaptureRule, ...] = USER_RULES + ASSISTANT_RULES


@dataclass(frozen=True)
class CaptureDecision:
    """A distilled fact the caller may store."""

    content: str
    category: str
    importance: int
    rule: str


# ── Guards ───────────────────────────────────────────────────────────────────

# Runtime notifications that broad auto-store wrongly captured as durable
# memories. These are ops noise, not facts.
_TRANSIENT_OPS_RE = re.compile(
    r"async delegation batch complete"
    r"|context compaction\s*[—\-–]\s*reference only"
    r"|background process\s+\w+\s+completed"
    r"|\[?important:\s*background process",
    re.IGNORECASE,
)

_READ_ONLY_MEMORY_TOOL = r"openltm_(?:recall|context|graph|brain_stats)"

_MARKDOWN_WRAPPED_READ_ONLY_TOOL_RE = re.compile(
    rf"[`*_~]+({_READ_ONLY_MEMORY_TOOL})[`*_~]+",
    re.IGNORECASE,
)

_READ_ONLY_MEMORY_CALL_RE = re.compile(
    rf"(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?"
    rf"(?:call|invoke|run|query|check|use)\s+(?:the\s+)?"
    rf"{_READ_ONLY_MEMORY_TOOL}"
    rf"(?:\s+(?:now|exactly\s+once))?"
    rf"(?:\s*(?:,|and)\s*(?:report|return|show)\s+"
    rf"(?:the\s+)?(?:status|result|results|stats|statistics|output))?",
    re.IGNORECASE,
)

# Generalises the former hard-coded sentence fragment: any request that refers
# to "the openltm tool that …" as a read-only operation counts, not just the one
# wording that happened to be reported. NOTE: the quantifier braces are escaped
# ({{0,2}}) because this is an f-string.
_DESCRIBED_READ_ONLY_TOOL_RE = re.compile(
    rf"(?:call|invoke|run|use)\s+(?:the\s+)?openltm(?:\s+\w+){{0,2}}\s+tool"
    rf"[^.]*?\b(?:reports?|returns?|gives?|shows?|lists?)\b[^.]*?"
    rf"(?:statistics|stats|results?|counts?|memory)[^.]*",
    re.IGNORECASE,
)

_OPERATIONAL_REPORT_RE = re.compile(
    r"(?:report|return|show)\s+(?:the\s+)?"
    r"(?:status|result|results|stats|statistics|output)",
    re.IGNORECASE,
)

_NO_MEMORY_WRITE_RE = re.compile(
    r"(?:do\s+not|don't|must\s+not)\s+"
    r"(?:write|store|save|add|learn|delete|forget)(?:\s+(?:to|from))?"
    r"(?:\s+or\s+(?:write|store|save|add|learn|delete|forget)"
    r"(?:\s+(?:to|from))?)?\s+(?:any\s+)?memor(?:y|ies)",
    re.IGNORECASE,
)

#: Minimum message lengths, kept here so both entry points agree.
MIN_USER_LEN = 8
MIN_ASSISTANT_LEN = 5

#: Session-end extraction is conservative on purpose.
SESSION_MAX_EXTRACT = 5


def is_transient_operational(text: str) -> bool:
    """True when ``text`` is a runtime notification rather than knowledge."""
    return bool(text) and _TRANSIENT_OPS_RE.search(text) is not None


def _clauses(text: str) -> list[str]:
    normalized = _MARKDOWN_WRAPPED_READ_ONLY_TOOL_RE.sub(r"\1", text)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return [c.strip() for c in re.split(r"[;.!?]+", normalized) if c.strip()]


def is_read_only_memory_request(text: str) -> bool:
    """True when every clause of ``text`` is one read-only OpenLTM request.

    A message that *mixes* such a request with a durable rule is not exempt, so
    constraints stated alongside "call openltm_context" are still captured.
    """
    if not text:
        return False

    clauses = _clauses(text)
    if not clauses:
        return False

    first = clauses[0]
    opener_ok = (
        _READ_ONLY_MEMORY_CALL_RE.fullmatch(first) is not None
        or _DESCRIBED_READ_ONLY_TOOL_RE.fullmatch(first) is not None
    )
    if not opener_ok:
        return False

    return all(
        _OPERATIONAL_REPORT_RE.fullmatch(c) is not None
        or _NO_MEMORY_WRITE_RE.fullmatch(c) is not None
        for c in clauses[1:]
    )


# ── Distillation ─────────────────────────────────────────────────────────────

#: Generic speech-marker prefixes that carry no factual content. Negations
#: ("don't", "never", "must not") are deliberately absent so meaning survives.
SPEECH_MARKERS: tuple[str, ...] = (
    "i prefer ", "i'd rather ", "id rather ", "i like ", "i want ", "i need ",
    "we'll ", "we decided ", "we chose ", "let's ", "lets ", "going with ",
    "settled on ", "picked ", "agreed ", "the fix is ",
    "the solution is ", "the issue is ", "root cause ",
    "i found that ", "i discovered ", "turns out ", "note that ",
    "remember that ", "key insight ",
)

MAX_FACT_LEN = 500


def distill(text: str, keywords: Iterable[str]) -> str:
    """Reduce a message to a self-contained declarative fact.

    Keeps the sentence containing the trigger, strips a speech-marker prefix
    when one is present, capitalises, and truncates. Negations are preserved so
    a correction never inverts into an approval.
    """
    keywords = tuple(keywords)
    sentences = re.split(r"(?<=[.!?])\s+|\n+", text)

    target = None
    for sentence in sentences:
        if any(kw in sentence.lower() for kw in keywords):
            target = sentence
            break
    if not target:
        target = text[:MAX_FACT_LEN]

    low = target.lower()
    for marker in SPEECH_MARKERS:
        if low.startswith(marker):
            target = target[len(marker):].strip()
            break

    target = target.strip()
    if not target:
        target = text[:MAX_FACT_LEN].strip()
    if target and target[0].isalpha():
        target = target[0].upper() + target[1:]
    return target[:MAX_FACT_LEN]


# ── Evaluation ───────────────────────────────────────────────────────────────


def _match_rule(text: str, rules: Iterable[CaptureRule]) -> Optional[CaptureRule]:
    if not text:
        return None
    low = text.lower()
    for rule in rules:
        if any(kw in low for kw in rule.keywords):
            return rule
    return None


def _decide(text: str, rule: CaptureRule) -> CaptureDecision:
    return CaptureDecision(
        content=distill(text, rule.keywords),
        category=rule.category,
        importance=rule.importance,
        rule=rule.name,
    )


def evaluate_turn(user_content: str, assistant_content: str) -> Optional[CaptureDecision]:
    """Decide whether a completed turn carries a storable fact.

    User-side rules are evaluated first (corrections, preferences, constraints,
    decisions); assistant-side discovery rules are the fallback.
    """
    if len(user_content) < MIN_USER_LEN and len(assistant_content) < MIN_ASSISTANT_LEN:
        return None

    # Ops noise and read-only memory bookkeeping are never knowledge. A *mixed*
    # message still passes, so a constraint riding along with a tool request is
    # kept.
    if is_transient_operational(user_content) or is_transient_operational(assistant_content):
        return None
    if is_read_only_memory_request(user_content):
        return None

    if len(user_content) >= MIN_USER_LEN:
        rule = _match_rule(user_content, USER_RULES)
        if rule is not None:
            return _decide(user_content, rule)

    if len(assistant_content) >= MIN_ASSISTANT_LEN:
        rule = _match_rule(assistant_content, ASSISTANT_RULES)
        if rule is not None:
            return _decide(assistant_content, rule)

    return None


def _message_text(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, list):
        return " ".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return content if isinstance(content, str) else ""


def evaluate_session(
    messages: Iterable[dict],
    max_extract: int = SESSION_MAX_EXTRACT,
) -> list[CaptureDecision]:
    """Decide which facts to keep from a whole conversation.

    Only user turns are considered — the agent's own output is already covered
    per-turn by :func:`evaluate_turn`. A correction is only trusted when the
    agent had just said something, so an opening user message is not treated as
    a rebuttal to nothing.
    """
    decisions: list[CaptureDecision] = []
    messages = list(messages)

    for index, message in enumerate(messages):
        if len(decisions) >= max_extract:
            break
        if message.get("role") != "user":
            continue

        content = _message_text(message)
        if is_transient_operational(content) or is_read_only_memory_request(content):
            continue

        rule = _match_rule(content, USER_RULES)
        if rule is None:
            continue
        if rule.name == "correction":
            previous = messages[index - 1] if index > 0 else None
            if not previous or previous.get("role") != "assistant":
                continue

        decisions.append(_decide(content, rule))

    return decisions
