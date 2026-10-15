"""Plant-secret regressions: Hermes never stores, embeds or injects a raw key."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import openltm_hermes
from openltm_hermes import _db
from openltm_hermes import _project_memory as project_memory
from openltm_hermes import _secrets_scrubber

KEY = "AKIAIOSFODNN7EXAMPLE"


class RecordingEmbedder:
    model = "fake"

    def __init__(self):
        self.calls: list[str] = []

    def embed(self, text):
        self.calls.append(text)
        return [0.1, 0.2, 0.3]


@pytest.fixture
def provider(tmp_path: Path):
    p = openltm_hermes.OpenLtmpMemoryProvider()
    p.initialize("test-session", hermes_home=str(tmp_path))
    try:
        yield p
    finally:
        p.shutdown()


def test_learn_scrubs_content_and_title_before_store_and_embed(provider):
    emb = RecordingEmbedder()
    provider._embedder = emb
    out = json.loads(provider.handle_tool_call(
        "openltm_learn",
        {"content": f"deploy uses aws key {KEY} in prod", "title": f"aws {KEY}", "category": "gotcha"},
    ))
    assert out.get("action") == "created", out
    row = provider._conn.execute("SELECT content, title FROM memories WHERE id = ?", (out["id"],)).fetchone()
    assert KEY not in row[0] and KEY not in (row[1] or "")
    assert "[REDACTED" in row[0]
    assert emb.calls and all(KEY not in c for c in emb.calls)


def test_learn_fails_closed_when_scrubber_errors(provider, monkeypatch):
    def boom(text):
        raise _secrets_scrubber.ScrubRefusedError("scrubber failed")

    monkeypatch.setattr(_secrets_scrubber, "scrub_or_refuse", boom)
    out = json.loads(provider.handle_tool_call("openltm_learn", {"content": f"key {KEY}"}))
    assert "error" in out
    assert provider._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0


def test_prefetch_scrubs_legacy_raw_rows(provider):
    res = _db.learn(provider._conn, "legacy placeholder about deploy keys", category="pattern")
    # Simulate a row written before write-time scrubbing existed.
    provider._conn.execute(
        "UPDATE memories SET content = ?, title = ? WHERE id = ?",
        (f"deploy keys legacy {KEY}", f"deploy {KEY}", res["id"]),
    )
    provider._conn.execute(
        "INSERT INTO memories_fts(memories_fts) VALUES('rebuild')"
    ) if provider._conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name='memories_fts'"
    ).fetchone() else None
    provider._conn.commit()
    out = provider.prefetch("deploy")
    assert "deploy" in out
    assert KEY not in out


def test_strict_project_context_scrubs_each_line(provider):
    provider._project_scope = "demo-project"
    review_id = project_memory.propose(
        provider._conn, project_scope="demo-project",
        content="The deploy role is documented here.", category="architecture",
    )["review"]["id"]
    project_memory.approve(provider._conn, review_id=review_id, reviewer="rohi")
    for table in ("project_memory_reviews",):
        cols = [r[1] for r in provider._conn.execute(f"PRAGMA table_info({table})")]
        if "content" in cols:
            provider._conn.execute(f"UPDATE {table} SET content = content || ' {KEY}'")
    for (mid,) in provider._conn.execute("SELECT id FROM memories").fetchall():
        provider._conn.execute("UPDATE memories SET content = content || ? WHERE id = ?", (f" {KEY}", mid))
    provider._conn.commit()
    text = project_memory.format_strict_project_context(provider._conn, project_scope="demo-project")
    assert "deploy role" in text
    assert KEY not in text
    assert KEY not in provider.system_prompt_block()


def test_scrub_or_refuse_redacts_and_passes_none():
    assert KEY not in _secrets_scrubber.scrub_or_refuse(f"x {KEY}")
    assert _secrets_scrubber.scrub_or_refuse(None) is None
    with pytest.raises(_secrets_scrubber.ScrubRefusedError):
        _secrets_scrubber.scrub_or_refuse(123)  # type: ignore[arg-type]
