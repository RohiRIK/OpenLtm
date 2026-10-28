"""_recall_shape.py — Query intent and adaptive cutoff (twin of core recall/intent.ts, recall/adaptive.ts).

English-only heuristics, same words and thresholds as core:
- "recency" queries ("current", "latest", "now") boost newer memories;
- "aggregate" queries ("list all", "how many") skip the adaptive cutoff;
- the adaptive cutoff keeps hits at least ADAPTIVE_MIN_RATIO as strong as the
  best one, never fewer than ADAPTIVE_MIN_RESULTS.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

RECENCY_RE = re.compile(
    r"\b(?:current(?:ly)?|latest|newest|now|nowadays|most recent(?:ly)?|these days|as of today|still|anymore|any more)\b",
    re.IGNORECASE,
)
AGGREGATE_RE = re.compile(r"\b(?:all|every|each|list|how many|which ones|everything|enumerate)\b", re.IGNORECASE)

ADAPTIVE_MIN_RATIO = 0.3
ADAPTIVE_MIN_RESULTS = 3
# Boost for the newest hit of a recency query, on a [0,1] relevance scale.
RECENCY_BOOST = 0.3


def detect_query_intent(query: Optional[str]) -> Optional[str]:
    if not query:
        return None
    if AGGREGATE_RE.search(query):
        return "aggregate"
    if RECENCY_RE.search(query):
        return "recency"
    return None


def _ts(value: Optional[str]) -> float:
    if not value:
        return 0.0
    v = value.strip().replace("Z", "+00:00")
    if len(v) >= 19 and v[10] == " ":
        v = v[:10] + "T" + v[11:]
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return 0.0
    if dt.tzinfo is None:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def recency_ranks(rows: list[dict]) -> dict[int, float]:
    """1 = newest, 0 = oldest; event time (occurred_at) before created_at."""
    times = {r["id"]: _ts(r.get("occurred_at") or r.get("created_at")) for r in rows}
    distinct = sorted(set(times.values()))
    if len(distinct) <= 1:
        return {i: 1.0 for i in times}
    return {i: distinct.index(t) / (len(distinct) - 1) for i, t in times.items()}


def adaptive_cutoff(ranked: list[dict], strength: dict[int, float]) -> list[dict]:
    best = max((strength.get(r["id"], 0.0) for r in ranked), default=0.0)
    if best <= 0:
        return list(ranked)
    return [r for i, r in enumerate(ranked)
            if i < ADAPTIVE_MIN_RESULTS or strength.get(r["id"], 0.0) >= best * ADAPTIVE_MIN_RATIO]
