"""
OpenLTM Deterministic Extraction Logic
=======================================
Heuristic-based memory extraction from conversations.
No LLM calls — keyword matching, pattern recognition, and scoring.

Design principles:
  1. Fast: O(n) scan with precompiled patterns, no ML inference
  2. Conservative: high thresholds, better to miss than to store noise
  3. Category-aware: different signal patterns per memory category
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ── Data Models ──────────────────────────────────────────────────────────────

class Category(Enum):
    PREFERENCE = "preference"       # "I prefer X", "always use Y"
    ARCHITECTURE = "architecture"   # "the system uses X", "we decided on Y"
    GOTCHA = "gotcha"              # "be careful", "watch out", "pitfall"
    PATTERN = "pattern"            # "the pattern is", "this always happens"
    WORKFLOW = "workflow"           # "the process is", "step 1, step 2"
    CONSTRAINT = "constraint"      # "must not", "required to", "limitation"


@dataclass
class ExtractedFact:
    content: str            # The extracted fact as a sentence
    category: Category
    importance: int         # 1-5
    confidence: float       # 0.0-1.0 (how sure the heuristic is)
    source_turn: int        # Turn index where this was found (-1 for session-level)
    keywords_matched: list[str] = field(default_factory=list)


# ── Pattern Definitions ──────────────────────────────────────────────────────

# Each category has:
#   - signal_patterns: regexes that indicate this category's topic
#   - trigger_patterns: phrases that signal a *memory-worthy* moment
#   - noise_patterns: phrases that look like signals but are trivial

CORRECTION_PATTERNS = [
    # User correcting assistant
    r"\bno[,.]?\s+(actually|it's|i meant|the correct|that's wrong)\b",
    r"\bthat'?s?\s+(not right|incorrect|wrong|off)\b",
    r"\bwait[,.]?\s+(no|that'?s?|it'?s?)\b",
    r"\bactually[,.]?\s+(it'?s?|the|no)\b",
    r"\bshould be\b",
    r"\binstead of\b",
    r"\bnot\s+\w+,?\s+\w+\b",  # "not X, Y" correction pattern
]

DECISION_PATTERNS = [
    r"\b(?:we|i'?ll?|let'?s?)\s+(decided?|going with|choosing|chose)\b",
    r"\bdecided to\s+\w+\b",
    r"\blet'?s?\s+(use|go with|implement|switch to|add)\b",
    r"\bswitch(?:ed)?\s+to\b",
    r"\bmoving to\b",
    r"\bthe decision is\b",
    r"\bwe'?ll?\s+(use|go with|keep|stick with)\b",
    r"\bsettled on\b",
]

PREFERENCE_PATTERNS = [
    r"\bi\s+(prefer|like|want|always use|usually)\b",
    r"\balways\s+(use|do|set|configure)\b",
    r"\bnever\s+(use|do|set)\b",
    r"\bmy\s+(preference|style|convention|习惯)\b",
    r"\bdefault to\b",
    r"\bfeel? free to\b",  # assistant granting permission = user preference
    r"\bkeep it as\b",
]

GOTCHA_PATTERNS = [
    r"\b(?:be|careful|watch out|heads up|note that|important)\b",
    r"\bpitfall\b",
    r"\bgotcha\b",
    r"\bcommon (mistake|error|issue|problem)\b",
    r"\bmake sure to\b",
    r"\bdon'?t forget\b",
    r"\bwarning\b",
    r"\bcaution\b",
    r"\btrap\b",
    r"\bbreaks?\b.*\b(?:if|when|because)\b",  # "breaks if X"
    r"\bwill (fail|break|crash|error)\b",
]

ARCHITECTURE_PATTERNS = [
    r"\bthe (system|service|app|server|database|api|endpoint)\s+(uses?|has|is built)\b",
    r"\barchitecture\b",
    r"\bdesign (decision|choice|pattern)\b",
    r"\bwe (designed|built|architected|structured)\b",
    r"\bthe (flow|pipeline|process|lifecycle)\s+(is|goes|works)\b",
    r"\bdata (model|schema|structure|flow)\b",
    r"\bcomponent\s+(communicates?|interacts?|connects?)\b",
]

PATTERN_PATTERNS = [
    r"\bthe pattern is\b",
    r"\bthis (always|typically|usually) (happens|occurs|means)\b",
    r"\bthe pattern\b",
    r"\bwhenever\s+\w+\s+.*\bthen\b",
    r"\brule of thumb\b",
    r"\bas a general\b",
    r"\btend(?:s|ed)?\s+to\b",
    r"\bin general\b.*\b(we|i|it)\b",
]

WORKFLOW_PATTERNS = [
    r"\bthe (process|workflow|steps?|procedure)\s+(is|goes|looks)\b",
    r"\bstep\s+\d+\b",
    r"\bfirst[,.]?\s+(we|i)\s+\w+.*\bthen\b",
    r"\border of operations\b",
    r"\bthe flow\b",
    r"\bthe routine\b",
    r"\bstandard (procedure|approach|method)\b",
]

CONSTRAINT_PATTERNS = [
    r"\bmust not\b",
    r"\b(required to|have to|need to)\s+\w+\b",
    r"\bcannot\b",
    r"\bdo not\b",
    r"\bshould not\b",
    r"\bprohibited\b",
    r"\bforbidden\b",
    r"\blimit(?:s|ation)?\b",
    r"\brestriction\b",
    r"\bconstraint\b",
    r"\bonly\s+\w+\s+(can|may|should)\b",
]

NOISE_PATTERNS = [
    r"^(?:thanks|thank you|ok|sure|got it|alright|yes|no|okay|great|cool|perfect|nice|awesome)\s*[!.]*$",
    r"^(?:hi|hello|hey|good morning|good evening)\b",
    r"^(?:how are you|what'?s? up|what can you do)\b",
    r"^(?:please|could you|can you|would you)\s+\w+\b",
    r"^(?:done|finished|completed|ready)\s*[!.]*$",
    r"^(?:here is|here'?s?|this is)\s+(the|a)\s+\w+\b",  # simple sharing
]


# ── Helper Utilities ─────────────────────────────────────────────────────────

def _text_length(text: str) -> int:
    """Word count."""
    return len(text.split())


def _has_any_pattern(text: str, patterns: list[str]) -> list[str]:
    """Return list of pattern strings that matched."""
    return [p for p in patterns if re.search(p, text, re.IGNORECASE)]


def _count_pattern_matches(text: str, patterns: list[str]) -> int:
    """Total number of regex matches across all patterns."""
    return sum(
        len(re.findall(p, text, re.IGNORECASE))
        for p in patterns
    )


def _extract_sentence_containing(text: str, match_span: tuple[int, int]) -> str:
    """Extract the sentence that contains the regex match."""
    start, end = match_span
    # Walk backward to sentence boundary
    sent_start = text.rfind(".", 0, start)
    sent_start = max(sent_start + 1 if sent_start != -1 else 0, 0)
    # Also check newlines and semicolons
    for delim in ["\n", ";"]:
        pos = text.rfind(delim, 0, start)
        if pos > sent_start:
            sent_start = pos + 1

    # Walk forward to sentence boundary
    sent_end = text.find(".", end)
    if sent_end == -1:
        sent_end = len(text)
    else:
        sent_end += 1  # include the period

    # Also check newlines
    nl_pos = text.find("\n", end)
    if nl_pos != -1 and nl_pos < sent_end:
        sent_end = nl_pos

    sentence = text[sent_start:sent_end].strip()
    # Clean up
    sentence = re.sub(r"\s+", " ", sentence)
    if len(sentence) > 300:
        sentence = sentence[:297] + "..."
    return sentence


def _score_importance(
    num_signals: int,
    text_length: int,
    has_correction: bool,
    is_high_value_category: bool,
) -> int:
    """Score importance 1-5 based on signal strength."""
    score = 1

    # More signals = more important
    if num_signals >= 3:
        score += 2
    elif num_signals >= 2:
        score += 1

    # Longer, more detailed text = more substance
    if text_length > 100:
        score += 1
    if text_length > 200:
        score += 1

    # Corrections are always important (someone learned something)
    if has_correction:
        score = max(score, 3)

    # High-value categories get a floor
    if is_high_value_category:
        score = max(score, 3)

    return min(score, 5)


def _is_noise(text: str) -> bool:
    """Check if text is too trivial to extract from."""
    if _text_length(text) < 5:
        return True
    if _has_any_pattern(text, NOISE_PATTERNS):
        return True
    # Pure code blocks are usually not memory-worthy
    if text.count("```") >= 2 and _text_length(text) < 30:
        return True
    return False


# ── sync_turn: Per-Turn Extraction ───────────────────────────────────────────

def sync_turn(
    user_content: str,
    assistant_content: str,
    turn_index: int = 0,
) -> list[ExtractedFact]:
    """
    Extract 0-2 key facts from a single conversation turn.
    
    Called after every turn. Runs in background (non-blocking).
    Conservative: returns empty list for most turns.
    
    Args:
        user_content: What the user said.
        assistant_content: What the assistant replied.
        turn_index: Position in the conversation (0-based).
    
    Returns:
        List of ExtractedFact (0-2 items).
    """
    facts: list[ExtractedFact] = []

    # ── Gate 1: Skip noise ──
    if _is_noise(user_content) and _is_noise(assistant_content):
        return []

    # ── Gate 2: Minimum substance ──
    total_words = _text_length(user_content) + _text_length(assistant_content)
    if total_words < 15:
        return []

    # ── Detect correction (user corrects assistant) ──
    correction_matches = _has_any_pattern(user_content, CORRECTION_PATTERNS)
    has_correction = len(correction_matches) > 0

    # ── Scan user message for signals ──
    user_signals = _scan_for_signals(user_content, "user")
    
    # ── Scan assistant message for signals ──
    assistant_signals = _scan_for_signals(assistant_content, "assistant")

    all_signals = user_signals + assistant_signals

    # ── Gate 3: Need at least one signal ──
    if not all_signals and not has_correction:
        return []

    # ── Rank and select top signals ──
    # Corrections from user are highest priority
    if has_correction:
        # Extract the correction as a fact
        sentence = _extract_sentence_containing(user_content, 
            re.search(CORRECTION_PATTERNS[0], user_content, re.IGNORECASE).span()
        ) if correction_matches else user_content[:200]
        
        # Find what the correction is about
        category = _infer_correction_category(user_content, assistant_content)
        importance = _score_importance(
            num_signals=len(correction_matches),
            text_length=total_words,
            has_correction=True,
            is_high_value_category=category in (Category.GOTCHA, Category.ARCHITECTURE),
        )
        facts.append(ExtractedFact(
            content=sentence,
            category=category,
            importance=importance,
            confidence=0.8,
            source_turn=turn_index,
            keywords_matched=correction_matches,
        ))

    # ── Add other significant signals (max 2 total) ──
    remaining_slots = 2 - len(facts)
    if remaining_slots > 0:
        # Sort signals by priority: gotcha > architecture > decision > pattern
        priority_order = [
            Category.GOTCHA, Category.ARCHITECTURE, Category.CONSTRAINT,
            Category.WORKFLOW, Category.PATTERN, Category.PREFERENCE,
        ]
        all_signals.sort(
            key=lambda s: priority_order.index(s.category) 
            if s.category in priority_order else 99
        )

        for signal in all_signals[:remaining_slots]:
            if signal.confidence >= 0.5:
                facts.append(signal)

    # ── Final deduplication ──
    facts = _deduplicate_facts(facts)

    return facts[:2]  # Hard cap: max 2 per turn


def _scan_for_signals(text: str, speaker: str) -> list[ExtractedFact]:
    """Scan text for all category signals."""
    signals = []

    category_patterns = {
        Category.PREFERENCE: PREFERENCE_PATTERNS,
        Category.ARCHITECTURE: ARCHITECTURE_PATTERNS,
        Category.GOTCHA: GOTCHA_PATTERNS,
        Category.PATTERN: PATTERN_PATTERNS,
        Category.WORKFLOW: WORKFLOW_PATTERNS,
        Category.CONSTRAINT: CONSTRAINT_PATTERNS,
    }

    for category, patterns in category_patterns.items():
        matches = _has_any_pattern(text, patterns)
        if matches:
            # Find the best sentence for this category
            best_sentence = _extract_best_sentence(text, patterns)
            if not best_sentence or _is_noise(best_sentence):
                continue

            confidence = min(0.3 + 0.2 * len(matches), 0.9)
            importance = _score_importance(
                num_signals=len(matches),
                text_length=_text_length(text),
                has_correction=False,
                is_high_value_category=category in (Category.GOTCHA, Category.ARCHITECTURE),
            )
            signals.append(ExtractedFact(
                content=best_sentence,
                category=category,
                importance=importance,
                confidence=confidence,
                source_turn=-1,  # filled in by caller
                keywords_matched=matches,
            ))

    return signals


def _extract_best_sentence(text: str, patterns: list[str]) -> str:
    """Extract the most informative sentence that matches a pattern."""
    best = ""
    best_score = 0

    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            sentence = _extract_sentence_containing(text, match.span())
            # Score: prefer longer, more specific sentences
            score = _text_length(sentence)
            if score > best_score and not _is_noise(sentence):
                best = sentence
                best_score = score

    return best


def _infer_correction_category(user_msg: str, assistant_msg: str) -> Category:
    """Infer what category a correction falls into."""
    combined = user_msg + " " + assistant_msg

    # Check each category in priority order
    gotcha_hits = _has_any_pattern(combined, GOTCHA_PATTERNS)
    arch_hits = _has_any_pattern(combined, ARCHITECTURE_PATTERNS)
    pref_hits = _has_any_pattern(combined, PREFERENCE_PATTERNS)
    constraint_hits = _has_any_pattern(combined, CONSTRAINT_PATTERNS)

    if gotcha_hits:
        return Category.GOTCHA
    if arch_hits:
        return Category.ARCHITECTURE
    if pref_hits:
        return Category.PREFERENCE
    if constraint_hits:
        return Category.CONSTRAINT
    return Category.GOTCHA  # Default: correction = learned something = gotcha


def _deduplicate_facts(facts: list[ExtractedFact]) -> list[ExtractedFact]:
    """Remove duplicate facts based on content similarity."""
    seen: list[str] = []
    unique = []

    for fact in facts:
        # Simple dedup: skip if any existing fact shares >60% of words
        fact_words = set(fact.content.lower().split())
        is_dup = False
        for existing in seen:
            existing_words = set(existing.lower().split())
            if fact_words and existing_words:
                overlap = len(fact_words & existing_words) / min(
                    len(fact_words), len(existing_words)
                )
                if overlap > 0.6:
                    is_dup = True
                    break

        if not is_dup:
            seen.append(fact.content)
            unique.append(fact)

    return unique


# ── on_session_end: Session-Level Extraction ─────────────────────────────────

@dataclass
class Message:
    role: str          # "user" or "assistant"
    content: str


def on_session_end(
    messages: list[Message],
    session_id: str = "",
) -> list[ExtractedFact]:
    """
    Extract 1-5 key insights from the entire session.
    
    Called when a session ends. Runs in background.
    Higher importance than sync_turn (distilled session-level insights).
    
    Args:
        messages: Full conversation history.
        session_id: Session identifier (for dedup against prior memories).
    
    Returns:
        List of ExtractedFact (1-5 items).
    """
    if len(messages) < 4:
        return []  # Too short to have meaningful insights

    insights: list[ExtractedFact] = []

    # ── Strategy 1: Recurring themes ──
    # If the same category appears 3+ times across the session, it's a theme
    theme_facts = _extract_recurring_themes(messages)
    insights.extend(theme_facts)

    # ── Strategy 2: Decisions that stuck ──
    # A decision in turn N that the assistant honors in turn N+2 or later
    decision_facts = _extract_sticky_decisions(messages)
    insights.extend(decision_facts)

    # ── Strategy 3: Corrections and their resolutions ──
    # User corrects → assistant adjusts = gotcha/pattern
    correction_facts = _extract_correction_patterns(messages)
    insights.extend(correction_facts)

    # ── Strategy 4: Session arc — what changed? ──
    # Compare first few messages vs last few for state changes
    arc_facts = _extract_session_arc(messages)
    insights.extend(arc_facts)

    # ── Strategy 5: High-signal individual turns ──
    # Re-scan each turn with looser thresholds (session allows more)
    turn_facts = _extract_high_signal_turns(messages)
    insights.extend(turn_facts)

    # ── Rank all insights ──
    insights = _rank_session_insights(insights)

    # ── Cap at 5 ──
    return insights[:5]


def _extract_recurring_themes(messages: list[Message]) -> list[ExtractedFact]:
    """Find categories that appear 3+ times across the session."""
    category_counts: dict[Category, list[str]] = {c: [] for c in Category}

    all_text_by_category = {c: [] for c in Category}

    for i, msg in enumerate(messages):
        if msg.role not in ("user", "assistant"):
            continue
        signals = _scan_for_signals(msg.content, msg.role)
        for signal in signals:
            all_text_by_category[signal.category].append(signal.content)

    facts = []
    for category, sentences in all_text_by_category.items():
        if len(sentences) >= 3:
            # This is a recurring theme — synthesize
            best = max(sentences, key=_text_length)
            facts.append(ExtractedFact(
                content=f"Recurring theme: {best}",
                category=category,
                importance=4,  # Themes are always important
                confidence=0.7,
                source_turn=-1,
                keywords_matched=[f"appeared_{len(sentences)}_times"],
            ))

    return facts


def _extract_sticky_decisions(messages: list[Message]) -> list[ExtractedFact]:
    """Find decisions that the assistant actually honored in later turns."""
    facts = []
    decision_turns = []

    # Find decision turns
    for i, msg in enumerate(messages):
        if msg.role == "user":
            matches = _has_any_pattern(msg.content, DECISION_PATTERNS)
            if matches:
                decision_turns.append((i, msg.content, matches))

    # Check if decisions were honored
    for turn_idx, content, matches in decision_turns:
        # Look at assistant messages after the decision
        following_assistant = [
            m.content for m in messages[turn_idx+1:turn_idx+5]
            if m.role == "assistant"
        ]
        
        if not following_assistant:
            continue

        # Check if the decision topic appears in subsequent assistant messages
        decision_words = set(content.lower().split())
        decision_words -= {"we", "i", "let's", "decided", "going", "with", "use", "the", "a", "to"}
        
        honored = False
        for response in following_assistant:
            response_words = set(response.lower().split())
            overlap = decision_words & response_words
            if len(overlap) >= 2:
                honored = True
                break

        if honored:
            sentence = _extract_best_sentence(content, DECISION_PATTERNS)
            facts.append(ExtractedFact(
                content=f"Decision (honored): {sentence}",
                category=Category.ARCHITECTURE,
                importance=4,
                confidence=0.75,
                source_turn=turn_idx,
                keywords_matched=matches,
            ))

    return facts


def _extract_correction_patterns(messages: list[Message]) -> list[ExtractedFact]:
    """Find correction → adjustment sequences."""
    facts = []

    for i, msg in enumerate(messages):
        if msg.role != "user":
            continue

        correction_matches = _has_any_pattern(msg.content, CORRECTION_PATTERNS)
        if not correction_matches:
            continue

        # Check if assistant adjusted in the next response
        if i + 1 < len(messages) and messages[i + 1].role == "assistant":
            response = messages[i + 1].content
            # Did the assistant acknowledge and fix?
            ack_patterns = [
                r"\bgood (point|catch)\b",
                r"\byou'?re? right\b",
                r"\bcorrected?\b",
                r"\bupdated?\b",
                r"\bfixed?\b",
                r"\bchanged?\b",
            ]
            ack_matches = _has_any_pattern(response, ack_patterns)

            category = _infer_correction_category(msg.content, response)
            sentence = _extract_sentence_containing(msg.content,
                re.search(CORRECTION_PATTERNS[0], msg.content, re.IGNORECASE).span()
            ) if correction_matches else msg.content[:200]

            facts.append(ExtractedFact(
                content=f"Gotcha (corrected): {sentence}",
                category=category,
                importance=4 if ack_matches else 3,
                confidence=0.8 if ack_matches else 0.5,
                source_turn=i,
                keywords_matched=correction_matches + ack_matches,
            ))

    return facts


def _extract_session_arc(messages: list[Message]) -> list[ExtractedFact]:
    """Detect what changed from session start to end."""
    if len(messages) < 6:
        return []

    facts = []
    first_third = messages[:len(messages)//3]
    last_third = messages[2*len(messages)//3:]

    # Check for architecture evolution
    early_arch = sum(
        len(_has_any_pattern(m.content, ARCHITECTURE_PATTERNS))
        for m in first_third if m.role in ("user", "assistant")
    )
    late_arch = sum(
        len(_has_any_pattern(m.content, ARCHITECTURE_PATTERNS))
        for m in last_third if m.role in ("user", "assistant")
    )

    if late_arch > early_arch + 2:
        # Architecture discussions intensified = something evolved
        best_late = ""
        for m in last_third:
            if m.role == "assistant":
                matches = _has_any_pattern(m.content, ARCHITECTURE_PATTERNS)
                if matches:
                    s = _extract_best_sentence(m.content, ARCHITECTURE_PATTERNS)
                    if _text_length(s) > _text_length(best_late):
                        best_late = s
        if best_late:
            facts.append(ExtractedFact(
                content=f"Architecture evolved: {best_late}",
                category=Category.ARCHITECTURE,
                importance=5,
                confidence=0.6,
                source_turn=-1,
                keywords_matched=["session_arc_architecture"],
            ))

    # Check for workflow that stabilized
    early_workflow = sum(
        len(_has_any_pattern(m.content, WORKFLOW_PATTERNS))
        for m in first_third if m.role in ("user", "assistant")
    )
    late_workflow = sum(
        len(_has_any_pattern(m.content, WORKFLOW_PATTERNS))
        for m in last_third if m.role in ("user", "assistant")
    )

    if early_workflow >= 2 and late_workflow >= 2:
        # Workflow discussed early and confirmed late = settled workflow
        for m in last_third:
            if m.role == "assistant":
                s = _extract_best_sentence(m.content, WORKFLOW_PATTERNS)
                if s and _text_length(s) > 10:
                    facts.append(ExtractedFact(
                        content=f"Settled workflow: {s}",
                        category=Category.WORKFLOW,
                        importance=4,
                        confidence=0.65,
                        source_turn=-1,
                        keywords_matched=["session_arc_workflow"],
                    ))
                    break

    return facts


def _extract_high_signal_turns(messages: list[Message]) -> list[ExtractedFact]:
    """Re-scan all turns with session-level thresholds (slightly looser)."""
    all_facts = []

    for i, msg in enumerate(messages):
        if msg.role != "user":
            continue
        if i + 1 >= len(messages):
            continue

        # Use sync_turn logic but with lower thresholds
        turn_facts = sync_turn(
            user_content=msg.content,
            assistant_content=messages[i + 1].content,
            turn_index=i,
        )

        # Boost importance for session-level extraction
        for fact in turn_facts:
            fact.importance = min(fact.importance + 1, 5)
            fact.source_turn = i

        all_facts.extend(turn_facts)

    return all_facts


def _rank_session_insights(insights: list[ExtractedFact]) -> list[ExtractedFact]:
    """Rank session insights by importance, then confidence."""
    # Deduplicate
    insights = _deduplicate_facts(insights)

    # Sort: importance desc, then confidence desc
    insights.sort(key=lambda f: (-f.importance, -f.confidence))

    return insights


# ── Integration API ──────────────────────────────────────────────────────────

class MemoryExtractor:
    """
    Public API for OpenLTM's memory extraction.
    
    Usage:
        extractor = MemoryExtractor()
        
        # After every turn:
        facts = extractor.process_turn(user_msg, assistant_msg, turn_index)
        for fact in facts:
            memory_store.save(fact)
        
        # When session ends:
        facts = extractor.process_session_end(messages, session_id)
        for fact in facts:
            memory_store.save(fact)
    """

    def __init__(
        self,
        *,
        min_importance: int = 2,
        min_confidence: float = 0.5,
        max_per_turn: int = 2,
        max_per_session: int = 5,
    ):
        self.min_importance = min_importance
        self.min_confidence = min_confidence
        self.max_per_turn = max_per_turn
        self.max_per_session = max_per_session

    def process_turn(
        self,
        user_content: str,
        assistant_content: str,
        turn_index: int = 0,
    ) -> list[ExtractedFact]:
        """Process a single turn. Returns filtered facts."""
        raw = sync_turn(user_content, assistant_content, turn_index)
        return self._filter(raw)[:self.max_per_turn]

    def process_session_end(
        self,
        messages: list[Message],
        session_id: str = "",
    ) -> list[ExtractedFact]:
        """Process session end. Returns filtered facts."""
        raw = on_session_end(messages, session_id)
        return self._filter(raw)[:self.max_per_session]

    def _filter(self, facts: list[ExtractedFact]) -> list[ExtractedFact]:
        """Apply importance and confidence thresholds."""
        return [
            f for f in facts
            if f.importance >= self.min_importance
            and f.confidence >= self.min_confidence
        ]


# ── Example Usage ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    extractor = MemoryExtractor()

    # Example 1: Correction turn
    print("=== Correction Turn ===")
    facts = extractor.process_turn(
        user_content="No actually, we should use PostgreSQL not MySQL for this",
        assistant_content="Got it, switching to PostgreSQL for the database layer.",
        turn_index=3,
    )
    for f in facts:
        print(f"  [{f.category.value}] (imp={f.importance}, conf={f.confidence:.1f}) {f.content}")

    # Example 2: Preference turn
    print("\n=== Preference Turn ===")
    facts = extractor.process_turn(
        user_content="I prefer dark mode for all my dev tools, always use vim keybindings",
        assistant_content="Understood, I'll keep that in mind for future tool configurations.",
        turn_index=7,
    )
    for f in facts:
        print(f"  [{f.category.value}] (imp={f.importance}, conf={f.confidence:.1f}) {f.content}")

    # Example 3: Trivial turn (should return empty)
    print("\n=== Trivial Turn ===")
    facts = extractor.process_turn(
        user_content="ok",
        assistant_content="Sure thing!",
        turn_index=10,
    )
    print(f"  Extracted: {len(facts)} facts (expected 0)")

    # Example 4: Session end
    print("\n=== Session End ===")
    session = [
        Message("user", "Let's build the auth service"),
        Message("assistant", "I'll set up the auth service architecture using JWT tokens"),
        Message("user", "We decided to use Redis for session storage"),
        Message("assistant", "Good choice, Redis is fast for session lookups"),
        Message("user", "No, be careful — Redis doesn't persist by default, configure AOF"),
        Message("assistant", "You're right, I'll configure Redis AOF persistence"),
        Message("user", "The pattern is: always configure persistence before deploying"),
        Message("assistant", "Understood, that's an important gotcha to remember"),
    ]
    facts = extractor.process_session_end(session, "sess_001")
    for f in facts:
        print(f"  [{f.category.value}] (imp={f.importance}, conf={f.confidence:.1f}) {f.content}")
