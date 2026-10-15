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


# --- Sam's review of #48: scrub inside _db.learn, fail-closed embeds, tags, tool outputs ---

class _Boom:
    def sub(self, *a, **k):
        raise RuntimeError("forced scrubber failure")


@pytest.fixture
def scrubber_throws(monkeypatch):
    saved = [(pat, pat.regex) for pat in _secrets_scrubber.PATTERNS]
    for pat in _secrets_scrubber.PATTERNS:
        object.__setattr__(pat, "regex", _Boom())  # Pattern may be a frozen dataclass
    yield
    for pat, rx in saved:
        object.__setattr__(pat, "regex", rx)


def _dump(conn):
    rows = conn.execute("SELECT content, COALESCE(title,''), COALESCE(stale_reason,'') FROM memories").fetchall()
    tags = conn.execute("SELECT name FROM tags").fetchall()
    return json.dumps([list(r) for r in rows] + [list(t) for t in tags])


def test_db_learn_scrubs_for_every_caller(provider):
    emb = RecordingEmbedder()
    provider._embedder = emb
    provider.sync_turn(f"Always use the key {KEY} for deploy, never npm.", "ok")
    provider.on_session_end([
        {"role": "assistant", "content": "What should I use?"},
        {"role": "user", "content": f"No, use the key {KEY} instead of the old one."},
    ])
    provider.on_memory_write("add", "user", f"user prefers key {KEY}")
    _db.learn(provider._conn, f"direct {KEY}", title=f"t {KEY}", tags=[f"k-{KEY}"])
    dump = _dump(provider._conn)
    assert provider._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] >= 2
    assert KEY not in dump and KEY.lower() not in dump
    assert all(KEY not in c for c in emb.calls)


def test_db_learn_refuses_when_scrubber_throws(provider, scrubber_throws):
    emb = RecordingEmbedder()
    with pytest.raises(_secrets_scrubber.ScrubRefusedError):
        _db.learn(provider._conn, f"direct {KEY}", embedder=emb)
    provider.on_memory_write("add", "user", f"user prefers key {KEY}")
    provider.sync_turn(f"Always use the key {KEY} for deploy, never npm.", "ok")
    assert provider._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
    assert emb.calls == []


def test_learn_tags_scrubbed_before_lowercasing(provider):
    out = json.loads(provider.handle_tool_call(
        "openltm_learn", {"content": "tag test", "tags": [f"k-{KEY}"], "category": "gotcha"}))
    assert out.get("action") == "created", out
    names = [r[0] for r in provider._conn.execute("SELECT name FROM tags").fetchall()]
    assert names and all(KEY.lower() not in n and KEY not in n for n in names)


def test_learn_tags_refused_when_scrubber_throws(provider, scrubber_throws):
    out = json.loads(provider.handle_tool_call(
        "openltm_learn", {"content": "tag test", "tags": [f"k-{KEY}"]}))
    assert "error" in out
    assert provider._conn.execute("SELECT COUNT(*) FROM tags").fetchone()[0] == 0


def test_embed_skipped_not_raw_when_scrub_refuses(provider, monkeypatch):
    emb = RecordingEmbedder()
    real = _db.scrub_or_refuse
    calls = {"n": 0}

    def flaky(text):
        # Let the write-time scrub pass, then refuse on the embed path.
        calls["n"] += 1
        if calls["n"] > 2:
            raise _secrets_scrubber.ScrubRefusedError("forced")
        return real(text)

    monkeypatch.setattr(_db, "scrub_or_refuse", flaky)
    res = _db.learn(provider._conn, f"embed path {KEY}", embedder=emb)
    assert res["action"] == "created"
    assert emb.calls == []  # skipped, never embedded raw


def _plant_legacy(conn, text="legacy deploy note"):
    res = _db.learn(conn, text, category="gotcha", project="demo-project")
    conn.execute("UPDATE memories SET content = ?, title = ? WHERE id = ?",
                 (f"{text} {KEY}", f"title {KEY}", res["id"]))
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='memories_fts'").fetchone():
        conn.execute("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
    conn.commit()
    return res["id"]


def test_tool_outputs_scrub_legacy_rows(provider):
    mid = _plant_legacy(provider._conn)
    other = _db.learn(provider._conn, "clean neighbour", category="pattern")["id"]
    _db.relate(provider._conn, other, mid, "related_to")
    recall = provider.handle_tool_call("openltm_recall", {"query": "legacy"})
    graph = provider.handle_tool_call("openltm_graph", {"memory_id": other, "depth": 2})
    ctx = provider.handle_tool_call("openltm_context", {"project": "demo-project"})
    _db.flag_stale(provider._conn, mid, "old")
    provider._conn.execute("UPDATE memories SET stale_reason = ? WHERE id = ?", (f"r {KEY}", mid))
    stale = provider.handle_tool_call("openltm_stale", {"action": "list"})
    assert "legacy deploy note" in recall
    for out in (recall, graph, ctx, stale):
        assert KEY not in out, out


def test_tool_output_stubs_when_scrubber_throws(provider):
    _plant_legacy(provider._conn)
    saved = [(pat, pat.regex) for pat in _secrets_scrubber.PATTERNS]
    for pat in _secrets_scrubber.PATTERNS:
        object.__setattr__(pat, "regex", _Boom())
    try:
        out = provider.handle_tool_call("openltm_recall", {"query": "legacy"})
        assert KEY not in out
        assert "scrub-failed" in out
    finally:
        for pat, rx in saved:
            object.__setattr__(pat, "regex", rx)
