"""Regression tests for R-1 FTS5 grammar hardening of OpenLTM recall."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from openltm_hermes import _db

ADVERSARIAL = ['"x" OR "evil', 'a*', '"api key" NEAR token', 'col:term']
_PHRASE_OR = re.compile(r'^"(?:[^"]*)"(?: OR "(?:[^"]*)")*$')


@pytest.fixture
def conn(tmp_path: Path):
    db = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(db)
    ids = [
        _db.learn(
            db,
            "api markers control the NEAR token and frozen lock",
            title="manifest",
            category="architecture",
            importance=4,
        )["id"],
        _db.learn(
            db,
            "a* is a literal star inside a code comment",
            category="gotcha",
            importance=2,
        )["id"],
    ]
    try:
        yield db, ids
    finally:
        db.close()


def _build(query: str) -> str:
    return _db._build_fts_query(query)


def test_unbalanced_quote_is_rejected_not_echoed(conn):
    db, _ = conn
    with pytest.raises(ValueError):
        _build('"x" OR "evil')
    with pytest.raises(ValueError):
        _db.recall(db, query='"x" OR "evil')


def test_prefix_star_is_sanitized_to_literal_phrase(conn):
    db, (api_memory, literal_memory) = conn
    assert _build("a*") == '"a*"'
    ids = [row["id"] for row in _db.recall(db, query="a*")]
    assert literal_memory in ids
    assert api_memory not in ids


def test_phrase_operator_is_rejected_not_echoed(conn):
    db, _ = conn
    with pytest.raises(ValueError):
        _build('"api key" NEAR token')
    with pytest.raises(ValueError):
        _db.recall(db, query='"api key" NEAR token')


def test_column_prefix_is_literal_not_column_filter(conn):
    db, _ = conn
    assert _build("col:term") == '"col:term"'
    assert _db.recall(db, query="col:term") == []


def test_no_adversarial_input_is_echoed_raw():
    for raw in ADVERSARIAL:
        try:
            result = _build(raw)
        except ValueError:
            continue
        assert _PHRASE_OR.fullmatch(result), f"raw grammar echoed: {raw!r} -> {result!r}"


def test_plain_text_queries_remain_supported(conn):
    db, _ = conn
    assert _build("foo bar") == '"foo" OR "bar"'
    assert _build("foo NEAR bar") == '"foo" OR "NEAR" OR "bar"'
    assert _build("") == '""'
    assert _build("   ") == '""'
    assert _build("frozen-lockfile") == '"frozen-lockfile"'
    assert _build("don't") == '"don\'t"'
    ids = [row["id"] for row in _db.recall(db, query="NEAR token")]
    assert ids
    assert _db.recall(db, query="")
