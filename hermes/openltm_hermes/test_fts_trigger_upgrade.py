"""Upgrading a populated 2.18.1 DB to the title/content-only FTS triggers (core
migration 028), both when only Hermes opens it and when core migrates it."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from openltm_hermes import _db

MIGRATION_028 = Path(__file__).resolve().parents[2] / "migrations" / "028_fts_text_only_triggers.sql"
OLD = {
    "memories_au": "AFTER UPDATE ON memories",
    "context_items_au": "AFTER UPDATE ON context_items",
}


def trigger_sql(conn, name: str) -> str:
    return conn.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()[0]


def mem_hits(conn, q: str) -> list[int]:
    return [r[0] for r in conn.execute("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rowid", (q,))]


def ctx_hits(conn, q: str) -> list[int]:
    return [r[0] for r in conn.execute("SELECT rowid FROM context_items_fts WHERE context_items_fts MATCH ? ORDER BY rowid", (q,))]


def fts_data_rows(conn) -> int:
    return conn.execute("SELECT count(*) FROM memories_fts_data").fetchone()[0]


def v2181_db(path: Path):
    """A populated DB as Hermes 2.18.1 left it: unscoped AFTER UPDATE triggers."""
    conn = _db.connect(path)
    _db.init_schema(conn)
    for name, clause in OLD.items():
        table = name.removesuffix("_au")
        body = re.search(r"BEGIN.*END", trigger_sql(conn, name), re.S).group(0)
        conn.executescript(f"DROP TRIGGER {name}; CREATE TRIGGER {name} {clause} {body};")
        assert "UPDATE OF" not in trigger_sql(conn, name), table
    ids = []
    for i in range(30):
        ids.append(_db.learn(conn, f"Gannet pipeline step {i} {'nightly' if i % 2 else 'hourly'}", category="workflow")["id"])
    conn.execute("UPDATE memories SET recall_count = recall_count + 1")  # old trigger re-indexes
    conn.execute("UPDATE memories SET content = 'Gannet pipeline step 0 rewritten' WHERE id = ?", (ids[0],))
    ctx = conn.execute("INSERT INTO context_items (project_name, type, content) VALUES ('p', 'goal', 'Skua migration goal')").lastrowid
    conn.execute("UPDATE context_items SET status = 'promoted' WHERE id = ?", (ctx,))
    conn.commit()
    return conn, ids, ctx


def assert_upgraded_and_searchable(conn, ids: list[int], ctx: int) -> None:
    for name in OLD:
        assert "AFTER UPDATE OF title, content ON" in trigger_sql(conn, name)
    assert mem_hits(conn, '"gannet"') == ids
    assert mem_hits(conn, '"nightly"') == [m for i, m in enumerate(ids) if i % 2]
    assert mem_hits(conn, '"rewritten"') == [ids[0]]
    assert ids[0] not in mem_hits(conn, '"hourly"')
    assert ctx_hits(conn, '"skua"') == [ctx]
    assert {r["id"] for r in _db.recall(conn, query="gannet nightly", limit=50)} >= set(ids[1::2])

    before = fts_data_rows(conn)
    conn.execute("UPDATE memories SET recall_count = recall_count + 1, importance = 4")
    assert fts_data_rows(conn) == before
    conn.execute("UPDATE memories SET content = 'Tern pipeline' WHERE id = ?", (ids[1],))
    assert mem_hits(conn, '"tern"') == [ids[1]]
    assert ids[1] not in mem_hits(conn, '"gannet"')
    conn.execute("UPDATE context_items SET content = 'Shearwater goal' WHERE id = ?", (ctx,))
    assert ctx_hits(conn, '"skua"') == []
    assert ctx_hits(conn, '"shearwater"') == [ctx]
    conn.execute("INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)")
    conn.execute("INSERT INTO context_items_fts(context_items_fts, rank) VALUES ('integrity-check', 1)")


def test_hermes_only_db_gets_text_only_triggers(tmp_path: Path):
    conn, ids, ctx = v2181_db(tmp_path / "openltm.db")
    conn.close()
    conn = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(conn)
    _db.init_schema(conn)  # idempotent
    try:
        assert_upgraded_and_searchable(conn, ids, ctx)
    finally:
        conn.close()


@pytest.mark.skipif(not MIGRATION_028.exists(), reason="core migrations not in tree")
def test_core_migration_028_on_hermes_db_then_hermes_reopens(tmp_path: Path):
    conn, ids, ctx = v2181_db(tmp_path / "openltm.db")
    conn.executescript(MIGRATION_028.read_text())
    conn.close()
    conn = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(conn)
    try:
        assert_upgraded_and_searchable(conn, ids, ctx)
    finally:
        conn.close()


def test_hermes_triggers_match_core_028():
    """The plugin's trigger SQL is core's 028 SQL, byte for byte."""
    if not MIGRATION_028.exists():
        pytest.skip("core migrations not in tree")
    core = MIGRATION_028.read_text()
    for name in OLD:
        pat = rf"CREATE TRIGGER {name} AFTER UPDATE OF title, content ON \w+ BEGIN.*?END;"
        assert re.search(pat, core, re.S).group(0) in _db.FTS_TRIGGERS_SQL
