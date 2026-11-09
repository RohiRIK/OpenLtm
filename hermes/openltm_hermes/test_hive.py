"""Hive mode, Hermes side: opt-in shared memory, default deny.

Mirrors packages/openltm-core/src/__tests__/hive.test.ts. The interop test runs
the core CLI (when bun and the core checkout are present) so both sides are
proven to read and write the same hive file.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

import openltm_hermes
from openltm_hermes import _hive

CORE_BIN = Path(__file__).resolve().parents[2] / "packages/openltm-core/src/cli/bin.ts"
CORE_SCHEMA = Path(__file__).resolve().parents[2] / "packages/openltm-core/src/hive/schema.sql"


@pytest.fixture
def hive(tmp_path):
    path = str(tmp_path / "hive" / "hive.db")
    owner_key = _hive.init_hive(path)
    return path, owner_key


def _member(path, name, caps):
    conn = _hive.open_hive(path)
    try:
        token = _hive.add_agent(conn, name)
        if caps:
            _hive.grant(conn, name, caps)
        return token
    finally:
        conn.close()


def _enable(path, on=True):
    conn = _hive.open_hive(path)
    try:
        _hive.set_enabled(conn, on)
    finally:
        conn.close()


def _cfg(path, token, enabled=True):
    return {"enabled": enabled, "path": path, "token": token, "host": "hermes"}


@pytest.mark.skipif(not CORE_SCHEMA.exists(), reason="core checkout not present (installed plugin copy)")
def test_schema_matches_core():
    assert _hive.HIVE_SCHEMA_SQL == CORE_SCHEMA.read_text()


def test_host_config_is_off_by_default():
    assert _hive.host_config({}, env={})["enabled"] is False
    assert _hive.host_config({"hive": {"enabled": "yes"}}, env={})["enabled"] is False
    assert _hive.host_config({"hive": {"enabled": True}}, env={})["enabled"] is True
    assert _hive.host_config({"hive": {"enabled": True}}, env={"LTM_HIVE": "0"})["enabled"] is False
    assert _hive.host_config({}, env={"LTM_HIVE": "1", "LTM_HIVE_TOKEN": "t"})["token"] == "t"


def test_agent_tools_never_create_the_file(tmp_path):
    missing = str(tmp_path / "nope" / "hive.db")
    r = _hive.run_hive_tool("hive_status", {}, _cfg(missing, "t"))
    assert r == {"ok": False, "code": "hive_missing", "error": r["error"]}
    assert not os.path.exists(missing)


def test_each_layer_fails_closed(hive):
    path, _ = hive
    token = _member(path, "bob", [])
    assert _hive.run_hive_tool("hive_recall", {}, _cfg(path, token, enabled=False))["code"] == "hive_disabled"
    assert _hive.run_hive_tool("hive_recall", {}, _cfg(path, token))["code"] == "hive_disabled"
    _enable(path)
    assert _hive.run_hive_tool("hive_recall", {}, _cfg(path, "hive_wrong"))["code"] == "hive_unknown_agent"
    assert _hive.run_hive_tool("hive_recall", {}, _cfg(path, None))["code"] == "hive_unknown_agent"
    assert _hive.run_hive_tool("hive_recall", {}, _cfg(path, token))["code"] == "hive_no_grant"
    assert _hive.run_hive_tool("hive_learn", {"content": "x y"}, _cfg(path, token))["code"] == "hive_no_grant"


def test_share_between_agents_with_author_and_origin(hive):
    path, _ = hive
    _enable(path)
    writer = _member(path, "hermes-bob", ["write"])
    reader = _member(path, "claude-code", ["read"])
    w = _hive.run_hive_tool("hive_learn", {"content": "Staging DB rotates credentials every Monday", "category": "gotcha", "project": "Infra"}, _cfg(path, writer))
    assert w["ok"] and w["value"]["author"] == "hermes-bob" and w["value"]["duplicate"] is False
    r = _hive.run_hive_tool("hive_recall", {"query": "staging credentials", "project": "infra"}, _cfg(path, reader))
    assert r["ok"]
    assert "not instructions" in r["value"]["notice"]
    m = r["value"]["memories"][0]
    assert (m["author"], m["origin"], m["project_scope"]) == ("hermes-bob", "agent-observation", "infra")
    assert _hive.run_hive_tool("hive_learn", {"content": "nope"}, _cfg(path, reader))["code"] == "hive_no_grant"


def test_agents_cannot_claim_owner_origins(hive):
    path, _ = hive
    _enable(path)
    t = _member(path, "bob", ["write"])
    for origin in ("owner-statement", "historical-approval", "made-up"):
        assert _hive.run_hive_tool("hive_learn", {"content": f"claim {origin}", "origin": origin}, _cfg(path, t))["code"] == "hive_invalid"
    assert _hive.run_hive_tool("hive_learn", {"content": "doc says so", "origin": "external-source"}, _cfg(path, t))["ok"]


def test_dedup_scrub_and_author_only_archive(hive):
    path, _ = hive
    _enable(path)
    a = _member(path, "a", ["write"])
    b = _member(path, "b", ["read", "write"])
    first = _hive.run_hive_tool("hive_learn", {"content": "Use   port 8080 for the API"}, _cfg(path, a))
    second = _hive.run_hive_tool("hive_learn", {"content": "use port 8080 for the api"}, _cfg(path, b))
    assert second["value"]["id"] == first["value"]["id"] and second["value"]["duplicate"] is True
    secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
    _hive.run_hive_tool("hive_learn", {"content": f"deploy key is {secret} keep it"}, _cfg(path, a))
    assert secret.encode() not in Path(path).read_bytes()
    mid = first["value"]["id"]
    assert _hive.run_hive_tool("hive_forget", {"id": mid}, _cfg(path, b))["code"] == "hive_not_author"
    assert _hive.run_hive_tool("hive_forget", {"id": mid}, _cfg(path, a))["ok"]


def test_request_access_does_not_grant(hive):
    path, _ = hive
    _enable(path)
    t = _member(path, "sub", [])
    r = _hive.run_hive_tool("hive_request_access", {"capabilities": ["read", "admin"], "reason": "team gotchas"}, _cfg(path, t))
    assert r["ok"] and r["value"]["status"] == "pending" and r["value"]["capabilities"] == "read"
    assert _hive.run_hive_tool("hive_recall", {}, _cfg(path, t))["code"] == "hive_no_grant"


def test_provider_registers_hive_tools_only_when_enabled(hive):
    path, _ = hive
    p = openltm_hermes.OpenLtmpMemoryProvider()
    names = lambda: {s["name"] for s in p._hive_tool_schemas()}  # noqa: E731
    assert names() == set()
    p._hive_cfg = _cfg(path, None)
    assert names() == {"openltm_" + n for n in _hive.HIVE_TOOL_NAMES}


def test_provider_routes_hive_calls_without_the_private_db(hive):
    path, _ = hive
    _enable(path)
    t = _member(path, "bob", ["read"])
    p = openltm_hermes.OpenLtmpMemoryProvider()
    p._conn = object()  # any truthy handle: the hive path must not touch it
    p._hive_cfg = _cfg(path, t)
    out = json.loads(p.handle_tool_call("openltm_hive_status", {}))
    assert out == {"ok": True, "value": {"enabled": True, "member": True, "agent": "bob", "capabilities": ["read"]}}


@pytest.mark.skipif(shutil.which("bun") is None or not CORE_BIN.exists(), reason="needs bun and the core checkout")
def test_interop_with_core_cli(tmp_path):
    path = str(tmp_path / "hive.db")
    env = {**os.environ, "HOME": str(tmp_path)}
    run = lambda *a, **kw: subprocess.run(["bun", str(CORE_BIN), "hive", *a, "--path", path, "--json"], capture_output=True, text=True, env={**env, **kw}, cwd=tmp_path)  # noqa: E731
    owner = json.loads(run("init").stdout)["owner_key"]
    token = json.loads(run("agent", "add", "bob", LTM_HIVE_OWNER_KEY=owner).stdout)["token"]
    assert run("grant", "bob", "read,write", LTM_HIVE_OWNER_KEY=owner).returncode == 0
    assert run("enable", LTM_HIVE_OWNER_KEY=owner).returncode == 0
    w = _hive.run_hive_tool("hive_learn", {"content": "Written by Hermes, read by core"}, _cfg(path, token))
    assert w["ok"]
    rows = json.loads(run("recall", "hermes").stdout)
    assert rows[0]["author_agent"] == "bob" and rows[0]["source_host"] == "hermes"


def test_tools_are_routable_before_initialize(hive, tmp_path, monkeypatch):
    """Hermes snapshots get_tool_schemas() before initialize(); the hive tools must
    already be there and must answer (2.24.0 test report item 5a)."""
    path, _ = hive
    _enable(path)
    token = _member(path, "bob", ["read"])
    home = tmp_path / "hermes-home"
    home.mkdir()
    (home / "openltm.json").write_text(json.dumps({"hive": {"enabled": True, "path": path, "token": token}}))
    monkeypatch.setenv("HERMES_HOME", str(home))
    for var in ("LTM_HIVE", "LTM_HIVE_PATH", "LTM_HIVE_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    p = openltm_hermes.OpenLtmpMemoryProvider()
    names = {s["name"] for s in p.get_tool_schemas()}
    assert {"openltm_" + n for n in _hive.HIVE_TOOL_NAMES} <= names
    p._conn = object()
    out = json.loads(p.handle_tool_call("openltm_hive_status", {}))
    assert out["ok"] and out["value"]["agent"] == "bob"


def test_no_hive_block_means_no_tools_before_initialize(tmp_path, monkeypatch):
    home = tmp_path / "hermes-home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("LTM_HIVE", raising=False)
    p = openltm_hermes.OpenLtmpMemoryProvider()
    assert not any(s["name"].startswith("openltm_hive_") for s in p.get_tool_schemas())
