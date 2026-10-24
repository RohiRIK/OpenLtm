"""Agent-defined collections, Hermes side.

The contract tests run core's shared fixture, so this module and core's
src/collections/ accept and refuse the same names, fields and records. The
rest exercises the store, query compiler and provider tools on a real DB.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

import openltm_hermes
from openltm_hermes import _collections as col
from openltm_hermes import _db

FIXTURE = Path(__file__).resolve().parents[2] / "packages/openltm-core/src/__tests__/fixtures/collections-contract.json"
contract = json.loads(FIXTURE.read_text()) if FIXTURE.exists() else None
needs_contract = pytest.mark.skipif(contract is None, reason="core checkout not present (installed plugin copy)")


def cases(key):
    return contract[key] if contract else []


# ─── Shared contract ─────────────────────────────────────────────────────────

@needs_contract
def test_contract_constants_and_descriptions():
    assert list(col.FIELD_TYPES) == contract["field_types"]
    assert list(col.FILTER_OPS) == contract["filter_ops"]
    assert list(col.COLLECTION_ORIGINS) == contract["collection_origins"]
    assert list(col.COLLECTION_ACTIONS) == contract["collection_actions"]
    assert list(col.RECORD_ACTIONS) == contract["record_actions"]
    assert col.LIMITS == contract["limits"]
    assert sorted(col.RESERVED_FIELD_NAMES) == contract["reserved_field_names"]
    assert col.COLLECTION_TOOL_DESCRIPTION == contract["collection_tool_description"]
    assert col.RECORD_TOOL_DESCRIPTION == contract["record_tool_description"]


@needs_contract
@pytest.mark.parametrize("case", cases("names"), ids=lambda c: repr(c["name"])[:30])
def test_contract_names(case):
    assert bool(col.NAME_RE.match(case["name"])) is case["valid"]


@needs_contract
@pytest.mark.parametrize("case", cases("field_definitions"))
def test_contract_field_definitions(case):
    parsed, issues = col.parse_fields(case["fields"])
    assert (parsed is not None) is case["valid"], issues


@needs_contract
@pytest.mark.parametrize("case", cases("key_fields"))
def test_contract_key_fields(case):
    assert (col.check_key_field(case["fields"], case["key"]) is None) is case["valid"]


@needs_contract
@pytest.mark.parametrize("case", cases("records"))
def test_contract_records(case):
    clean, issues = col.validate_record(contract["record_fields"], case["data"])
    assert (clean is not None) is case["valid"], issues


@needs_contract
@pytest.mark.parametrize("case", cases("similar"), ids=lambda c: f"{c['a']}-{c['b']}")
def test_contract_similar(case):
    assert col.looks_similar(case["a"], case["a_fields"], case["b"], case["b_fields"]) is case["similar"]


@needs_contract
@pytest.mark.parametrize("case", cases("authority"), ids=lambda c: c["name"])
def test_contract_authority(case):
    assert col.is_authority_like(case["name"]) is case["authority"]


@needs_contract
@pytest.mark.parametrize("case", cases("diffs"))
def test_contract_diffs(case):
    breaking, search_changed = col.diff_fields(case["old"], case["new"])
    assert [len(breaking), search_changed] == [case["breaking"], case["search_changed"]]


@needs_contract
@pytest.mark.parametrize("case", cases("search_text"), ids=lambda c: c["collection"])
def test_contract_search_text(case):
    assert col.build_search_text(case["collection"], case["fields"], case["data"], case["key"]) == case["text"]


# ─── Store and query ─────────────────────────────────────────────────────────

HOSTS = [
    {"name": "host", "type": "string", "required": True},
    {"name": "port", "type": "integer"},
    {"name": "role", "type": "enum", "values": ["db", "web", "proxmox"]},
    {"name": "tags", "type": "string[]"},
    {"name": "notes", "type": "text"},
]


@pytest.fixture
def conn(tmp_path: Path):
    db = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(db)
    try:
        yield db
    finally:
        db.close()


def define_hosts(conn, **kw):
    return col.define_collection(conn, name="hosts", description="Machines the agent manages", fields=HOSTS, key_field="host", **kw)


def test_init_schema_creates_collections_and_is_idempotent(conn):
    _db.init_schema(conn)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master").fetchall()}
    assert {"collections", "records", "records_fts", "records_ai", "records_ad", "records_au"} <= names


def test_define_put_upsert_and_query(conn):
    define_hosts(conn)
    a = col.put_record(conn, collection="hosts", data={"host": "pve1", "port": 8006, "role": "proxmox", "tags": ["lab"]})
    assert a["created"] and a["record"]["key"] == "pve1" and a["record"]["origin"] == "agent-observation"
    b = col.put_record(conn, collection="hosts", data={"host": "pve1", "port": 8007})
    assert not b["created"] and b["record"]["id"] == a["record"]["id"]
    assert b["record"]["data"] == {"host": "pve1", "port": 8007}  # replace, not merge
    col.put_record(conn, collection="hosts", data={"host": "pve1", "role": "proxmox", "port": None}, merge=True)
    assert col.get_record(conn, "hosts", key="pve1")["data"] == {"host": "pve1", "role": "proxmox"}
    col.put_record(conn, collection="hosts", data={"host": "db1", "port": 5432, "role": "db", "tags": ["prod", "pg"]})
    q = col.query_records(conn, collection="hosts", where=[{"field": "role", "op": "eq", "value": "db"}])
    assert [r["key"] for r in q["records"]] == ["db1"]
    q = col.query_records(conn, collection="hosts", where=[{"field": "tags", "op": "contains", "value": "pg"}])
    assert [r["key"] for r in q["records"]] == ["db1"]
    q = col.query_records(conn, collection="hosts", where=[{"field": "port", "op": "gt", "value": 1000}])
    assert [r["key"] for r in q["records"]] == ["db1"]
    q = col.query_records(conn, collection="hosts", text="proxmox")
    assert [r["key"] for r in q["records"]] == ["pve1"]


def test_json_matches_core_layout(conn):
    """Stored JSON is compact and in field order, like core's JSON.stringify of the zod output."""
    define_hosts(conn)
    col.put_record(conn, collection="hosts", data={"role": "web", "host": "w1", "port": 80.0})
    raw = conn.execute("SELECT data FROM records").fetchone()[0]
    assert raw == '{"host":"w1","port":80,"role":"web"}'
    fields = conn.execute("SELECT fields FROM collections").fetchone()[0]
    assert fields.startswith('[{"name":"host","type":"string","required":true}')


def test_refusals(conn):
    define_hosts(conn)
    with pytest.raises(col.CollectionError) as e:
        col.define_collection(conn, name="host", description="dup", fields=[{"name": "host", "type": "string"}])
    assert e.value.code == "similar_exists"
    with pytest.raises(col.CollectionError) as e:
        col.put_record(conn, collection="hosts", data={"host": "x", "port": "80"})
    assert e.value.code == "invalid_record"
    with pytest.raises(col.CollectionError) as e:
        col.put_record(conn, collection="hosts", data={"host": "x", "notes": "aws key AKIAIOSFODNN7EXAMPLE"})
    assert e.value.code == "secret_refused"
    assert conn.execute("SELECT count(*) FROM records").fetchone()[0] == 0
    with pytest.raises(col.CollectionError) as e:
        col.evolve_collection(conn, name="hosts", fields=HOSTS[:-1])
    assert e.value.code == "breaking_change"
    with pytest.raises(col.CollectionError) as e:
        col.query_records(conn, collection="hosts", where=[{"field": "x') OR 1=1 --", "op": "eq", "value": 1}])
    assert e.value.code == "invalid_query"


def test_evolve_additive_and_owner_breaking(conn):
    define_hosts(conn)
    col.put_record(conn, collection="hosts", data={"host": "a1", "notes": "old"})
    res = col.evolve_collection(conn, name="hosts", fields=[*HOSTS, {"name": "os", "type": "string"}])
    assert res["collection"]["version"] == 2 and res["reindexed"] == 1
    res = col.evolve_collection(conn, name="hosts", fields=[f for f in res["collection"]["fields"] if f["name"] != "notes"],
                                allow_breaking=True)
    assert res["rewritten"] == 1
    assert col.get_record(conn, "hosts", key="a1")["data"] == {"host": "a1"}


def test_project_scope_wins_and_archive(conn):
    col.define_collection(conn, name="endpoints", description="global", fields=[{"name": "url", "type": "url", "required": True}], key_field="url")
    col.define_collection(conn, name="endpoints", description="scoped", fields=[{"name": "url", "type": "url", "required": True}],
                          key_field="url", project="alpha", force=True)
    assert col.resolve_collection(conn, "endpoints", "alpha")["description"] == "scoped"
    assert col.resolve_collection(conn, "endpoints", "beta")["description"] == "global"
    col.set_collection_status(conn, "endpoints", None, "archived")
    with pytest.raises(col.CollectionError) as e:
        col.put_record(conn, collection="endpoints", data={"url": "https://x.dev"})
    assert e.value.code == "archived"


def test_authority_note_and_search_records(conn):
    col.define_collection(conn, name="deploy_approvals", description="Past approvals", fields=[{"name": "what", "type": "string", "required": True}])
    col.put_record(conn, collection="deploy_approvals", data={"what": "staging rollout"}, origin="historical-approval")
    hits = col.search_records(conn, "staging rollout")
    assert len(hits) == 1 and hits[0]["authority_note"] == col.AUTHORITY_NOTE


def test_shared_db_with_core_layout(conn):
    """A row core wrote (same columns, its JSON) reads back here unchanged."""
    conn.execute(
        "INSERT INTO collections (name, description, fields, key_field, origin, created_by) VALUES (?,?,?,?,?,?)",
        ("releases", "Shipped versions", '[{"name":"version","type":"string","required":true}]', "version", "owner-statement", "mcp"),
    )
    cid = conn.execute("SELECT id FROM collections").fetchone()[0]
    conn.execute(
        "INSERT INTO records (collection_id, record_key, data, schema_version, search_text, origin) VALUES (?,?,?,?,?,?)",
        (cid, "2.21.0", '{"version":"2.21.0"}', 1, "releases\n2.21.0\n2.21.0", "owner-statement"),
    )
    conn.commit()
    assert col.get_record(conn, "releases", key="2.21.0")["data"] == {"version": "2.21.0"}
    assert [r["key"] for r in col.search_records(conn, "releases")] == ["2.21.0"]


# ─── Provider tools ──────────────────────────────────────────────────────────

@pytest.fixture
def provider(tmp_path):
    instance = openltm_hermes.OpenLtmpMemoryProvider()
    with patch("openltm_hermes._providers.detect_provider", return_value=None):
        instance.initialize("collections-test", hermes_home=str(tmp_path))
    try:
        yield instance
    finally:
        instance._conn.close()


def call(provider, tool, args):
    return json.loads(provider.handle_tool_call(tool, args))


def test_provider_tools_round_trip(provider):
    names = {s["name"] for s in provider.get_tool_schemas()}
    assert {"openltm_collection", "openltm_record"} <= names
    out = call(provider, "openltm_collection", {"action": "define", "name": "hosts", "description": "Machines",
                                                "fields": HOSTS, "key_field": "host"})
    assert out["ok"] and out["collection"]["name"] == "hosts"
    out = call(provider, "openltm_record", {"action": "put", "collection": "hosts", "data": {"host": "pve1", "role": "proxmox"}})
    assert out["ok"] and out["created"]
    bad = call(provider, "openltm_record", {"action": "put", "collection": "hosts", "data": {"host": 1}})
    assert bad["ok"] is False and bad["error"] == "invalid_record" and bad["details"]
    listed = call(provider, "openltm_collection", {"action": "list"})
    assert listed["collections"][0]["fields"][0] == "host:string!"
    assert "hosts[host] (1 record)" in provider.system_prompt_block()


def test_recall_appends_records_after_memories(provider):
    call(provider, "openltm_learn", {"content": "pve1 runs the proxmox lab cluster", "category": "architecture"})
    call(provider, "openltm_collection", {"action": "define", "name": "hosts", "description": "Machines", "fields": HOSTS, "key_field": "host"})
    call(provider, "openltm_record", {"action": "put", "collection": "hosts", "data": {"host": "pve1", "role": "proxmox"}})
    out = call(provider, "openltm_recall", {"query": "proxmox"})
    assert out[0].get("type") is None and "content" in out[0]
    assert out[-1]["type"] == "record" and out[-1]["key"] == "pve1"
    assert all(r.get("type") != "record" for r in call(provider, "openltm_recall", {"query": "proxmox", "include_records": False}))
    ctx = call(provider, "openltm_context", {"project": "anything"})
    assert ctx["collections"][0]["name"] == "hosts"


def test_tool_output_is_scrubbed_even_from_rows_written_elsewhere(provider):
    call(provider, "openltm_collection", {"action": "define", "name": "notes_box", "description": "x", "fields": [{"name": "body", "type": "text"}]})
    cid = provider._conn.execute("SELECT id FROM collections").fetchone()[0]
    # A row written around the validator (e.g. by hand): output must still be scrubbed.
    provider._conn.execute("INSERT INTO records (collection_id, data, schema_version) VALUES (?, ?, 1)",
                           (cid, json.dumps({"body": "AKIAIOSFODNN7EXAMPLE"})))
    provider._conn.commit()
    out = provider.handle_tool_call("openltm_record", {"action": "query", "collection": "notes_box"})
    assert "AKIAIOSFODNN7EXAMPLE" not in out
