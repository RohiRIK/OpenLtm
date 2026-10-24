"""Memory origin (memory-versus-authority Phase 2), Hermes side.

The same column and rules as OpenLtm core's migration 030 and learn(): a write
records where the claim came from, the owner restating a memory makes it the
owner's, and nothing else changes an origin. Core's origin.test.ts checks the
constants in _origin.py match src/origin.ts.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

import openltm_hermes
from openltm_hermes import _db
from openltm_hermes._origin import MEMORY_ORIGINS


@pytest.fixture
def conn(tmp_path: Path):
    db = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(db)
    try:
        yield db
    finally:
        db.close()


def origin_of(conn, mid: int):
    return conn.execute("SELECT origin FROM memories WHERE id = ?", (mid,)).fetchone()["origin"]


def test_learn_defaults_to_agent_observation(conn):
    r = _db.learn(conn, "Hermes origin probe: cache lives in .turbo", category="pattern")
    assert r["origin"] == "agent-observation"
    assert origin_of(conn, r["id"]) == "agent-observation"


def test_explicit_origin_is_stored_and_unknown_values_fall_back(conn):
    owner = _db.learn(conn, "Hermes origin probe: squash merges only", category="preference", origin="owner-statement")
    assert origin_of(conn, owner["id"]) == "owner-statement"
    junk = _db.learn(conn, "Hermes origin probe: unknown origin value", category="pattern", origin="the-boss")
    assert origin_of(conn, junk["id"]) == "agent-observation"


def test_owner_restating_upgrades_and_nothing_demotes(conn):
    first = _db.learn(conn, "Hermes origin probe: tests need postgres", category="gotcha")
    again = _db.learn(conn, "Hermes origin probe: tests need postgres", category="gotcha", origin="owner-statement")
    assert again["id"] == first["id"]
    assert origin_of(conn, first["id"]) == "owner-statement"
    _db.learn(conn, "Hermes origin probe: tests need postgres", category="gotcha", origin="external-source")
    assert origin_of(conn, first["id"]) == "owner-statement"


def test_init_schema_adds_origin_to_an_existing_database(tmp_path: Path):
    # A database created before origin tracking: today's schema without the column.
    start = _db.SCHEMA_SQL.index(",\n  origin")
    end = _db.SCHEMA_SQL.index("\n);", start)
    old_schema = _db.SCHEMA_SQL[:start] + _db.SCHEMA_SQL[end:]
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(old_schema)
    assert "origin" not in {r[1] for r in old.execute("PRAGMA table_info(memories)").fetchall()}
    old.close()
    db = _db.connect(path)
    try:
        _db.init_schema(db)
        assert "origin" in {r[1] for r in db.execute("PRAGMA table_info(memories)").fetchall()}
    finally:
        db.close()


def test_column_rejects_a_value_outside_the_enum(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO memories (content, category, origin) VALUES ('x', 'pattern', 'the-boss')")


def test_provenance_row_is_written_when_core_table_exists(conn):
    conn.execute(
        "CREATE TABLE memory_provenance (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL,"
        " source_type TEXT NOT NULL, source_ref TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),"
        " metadata TEXT)"
    )
    r = _db.learn(conn, "Hermes origin probe: provenance row", category="pattern", actor="hermes:openltm_learn")
    row = conn.execute("SELECT source_type, actor FROM memory_provenance WHERE memory_id = ?", (r["id"],)).fetchone()
    assert (row["source_type"], row["actor"]) == ("learn", "hermes:openltm_learn")


def test_learn_without_core_provenance_table_still_stores(conn):
    r = _db.learn(conn, "Hermes origin probe: no provenance table yet", category="pattern")
    assert r["action"] == "created"


def test_learn_tool_takes_origin_and_recall_reports_it(tmp_path: Path):
    provider = openltm_hermes.OpenLtmpMemoryProvider()
    with patch("openltm_hermes._providers.detect_provider", return_value=None):
        provider.initialize("origin-tool", hermes_home=str(tmp_path))
    try:
        schema = next(s for s in provider.get_tool_schemas() if s["name"] == "openltm_learn")
        assert schema["parameters"]["properties"]["origin"]["enum"] == list(MEMORY_ORIGINS)
        receipt = json.loads(provider.handle_tool_call("openltm_learn", {
            "content": "The owner wants a lyrebird marker in every release note.", "origin": "owner-statement",
        }))
        assert receipt["origin"] == "owner-statement"
        hits = json.loads(provider.handle_tool_call("openltm_recall", {"query": "lyrebird marker"}))
        assert next(h for h in hits if h["id"] == receipt["id"])["origin"] == "owner-statement"
    finally:
        provider._conn.close()
