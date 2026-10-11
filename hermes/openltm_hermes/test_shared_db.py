"""Shared DB with OpenLtm core (LTM_DB_PATH pointing Claude Code at this DB).

Core's migration 010 moves vectors from ``memories.embedding`` to the
``memory_embeddings`` side table and drops the column. The plugin must keep
reading and writing vectors in whichever layout the DB has.
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from openltm_hermes import _db


def blob(*xs: float) -> bytes:
    return struct.pack(f"<{len(xs)}f", *xs)


class FakeEmbedder:
    model = "nomic-embed-text"

    def embed(self, text: str) -> list[float]:
        return [0.0, 0.0, 1.0, 0.0] if "paraphrase" in text else [0.0, 0.0, 0.0, 1.0]


def core_migration_010(conn) -> None:
    """What OpenLtm core's 010_memory_embeddings_split does to this DB."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id  INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
          embedding  BLOB    NOT NULL,
          model      TEXT    NOT NULL DEFAULT 'unknown',
          dim        INTEGER NOT NULL DEFAULT 0,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO memory_embeddings (memory_id, embedding, model, dim)
          SELECT id, embedding, 'unknown', 0 FROM memories WHERE embedding IS NOT NULL;
        ALTER TABLE memories DROP COLUMN embedding;
        """
    )


@pytest.fixture
def conn(tmp_path: Path):
    db = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(db)
    try:
        yield db
    finally:
        db.close()


def test_fresh_schema_has_decay_score_so_the_janitor_runs(conn):
    _db.learn(conn, "janitor needs decay_score on a fresh DB", category="gotcha")
    assert _db.run_janitor(conn)["decay_refreshed"] == 1


def test_inline_layout_unchanged(conn):
    mid = _db.learn(conn, "inline vector memory", category="pattern")["id"]
    _db.store_embedding(conn, mid, blob(1, 0, 0, 0), "nomic-embed-text")
    assert _db._embeddings_inline(conn)
    assert [r["id"] for r in _db.vector_search(conn, [1, 0, 0, 0])] == [mid]


def test_after_core_migrates_vectors_survive_and_new_ones_land_in_the_side_table(conn):
    old = _db.learn(conn, "vector written before core opened the DB", category="pattern")["id"]
    _db.store_embedding(conn, old, blob(1, 0, 0, 0))
    core_migration_010(conn)
    assert not _db._embeddings_inline(conn)

    # The moved vector ('unknown' model) still matches.
    assert _db.vector_search(conn, [1, 0, 0, 0], model="nomic-embed-text")[0]["id"] == old

    new = _db.learn(conn, "Written after core migrated, a paraphrase target", category="pattern", embedder=FakeEmbedder())["id"]
    row = conn.execute("SELECT model, dim FROM memory_embeddings WHERE memory_id = ?", (new,)).fetchone()
    assert (row["model"], row["dim"]) == ("nomic-embed-text", 4)

    # Semantic dedup still reinforces through the side table.
    again = _db.learn(conn, "Totally different words, same paraphrase", category="pattern", embedder=FakeEmbedder())
    assert again["action"] == "reinforced_semantic" and again["id"] == new

    _db.run_janitor(conn)  # semantic dedup sweep reads the side table


def test_vectors_from_another_model_or_dimension_are_not_compared(conn):
    core_migration_010(conn)
    a = _db.learn(conn, "embedded by core with another model", category="pattern")["id"]
    b = _db.learn(conn, "embedded with a different dimension", category="pattern")["id"]
    _db.store_embedding(conn, a, blob(0, 0, 1, 0), "text-embedding-004")
    _db.store_embedding(conn, b, blob(0, 0, 1), "nomic-embed-text")

    assert _db.vector_search(conn, [0, 0, 1, 0], model="nomic-embed-text") == []
    assert [r["id"] for r in _db.vector_search(conn, [0, 0, 1, 0], model="text-embedding-004")] == [a]
    assert _db._find_semantic_duplicates(conn, 0.5) == []
