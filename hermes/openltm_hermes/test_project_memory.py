"""Regression tests for reviewed, strict OpenLTM project memory."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

import pytest

import openltm_hermes
from openltm_hermes import _db
from openltm_hermes import _project_memory as project_memory


@pytest.fixture
def conn(tmp_path: Path):
    connection = _db.connect(tmp_path / "openltm.db")
    _db.init_schema(connection)
    project_memory.init_project_memory_schema(connection)
    try:
        yield connection
    finally:
        connection.close()


def _proposal(conn: sqlite3.Connection, content: str = "The service uses isolated worker queues.") -> int:
    result = project_memory.propose(
        conn,
        project_scope="git/github.com/acme/platform",
        content=content,
        category="architecture",
        importance=4,
        source_refs=["docs/architecture.md:42"],
    )
    return result["review"]["id"]


def test_project_id_normalizes_remote_and_removes_credentials():
    assert project_memory.project_id_from_remote("https://token@example.com/Acme/Platform.git") == "git/example.com/Acme/Platform"
    assert project_memory.project_id_from_remote("git@github.com:Acme/Platform.git") == "git/github.com/Acme/Platform"


def test_proposal_is_not_recalled_until_explicit_approval(conn):
    review_id = _proposal(conn)
    assert project_memory.strict_project_context(conn, project_scope="git/github.com/acme/platform") == []

    approved = project_memory.approve(conn, review_id=review_id, reviewer="rohi")
    assert approved["review"]["state"] == "approved"
    assert approved["review"]["memory_id"] > 0

    context = project_memory.strict_project_context(conn, project_scope="git/github.com/acme/platform")
    assert [item["review_id"] for item in context] == [review_id]
    assert context[0]["content"] == "The service uses isolated worker queues."


def test_strict_context_excludes_global_proposed_rejected_expired_and_other_projects(conn):
    approved_id = _proposal(conn, "The deployment runs from reviewed manifests.")
    project_memory.approve(conn, review_id=approved_id, reviewer="rohi")
    proposed_id = _proposal(conn, "The backlog is merely proposed.")
    rejected_id = _proposal(conn, "The rejected path should remain hidden.")
    project_memory.reject(conn, review_id=rejected_id, reviewer="rohi", reason="not evidence-backed")
    expiring_id = _proposal(conn, "This fact expires after review.")
    project_memory.approve(conn, review_id=expiring_id, reviewer="rohi")
    project_memory.expire(conn, review_id=expiring_id, reviewer="rohi")
    other = project_memory.propose(
        conn,
        project_scope="other-project",
        content="Other project fact.",
        category="pattern",
    )["review"]["id"]
    project_memory.approve(conn, review_id=other, reviewer="rohi")
    _db.learn(conn, "Global memory must never bleed into strict project context.", category="pattern")

    context = project_memory.strict_project_context(conn, project_scope="git/github.com/acme/platform")
    assert [item["review_id"] for item in context] == [approved_id]
    assert proposed_id not in [item["review_id"] for item in context]


def test_supersession_removes_old_fact_and_links_memories(conn):
    old_id = _proposal(conn, "Use queue version one.")
    new_id = _proposal(conn, "Use queue version two.")
    old = project_memory.approve(conn, review_id=old_id, reviewer="rohi")["review"]
    new = project_memory.approve(conn, review_id=new_id, reviewer="rohi")["review"]

    result = project_memory.supersede(conn, old_review_id=old_id, new_review_id=new_id, reviewer="rohi")
    assert result["old_review"]["state"] == "superseded"
    assert project_memory.strict_project_context(conn, project_scope="git/github.com/acme/platform")[0]["review_id"] == new_id
    memory = conn.execute("SELECT status, superseded_by FROM memories WHERE id = ?", (old["memory_id"],)).fetchone()
    assert memory["status"] == "superseded"
    assert memory["superseded_by"] == new["memory_id"]


def test_rejects_secret_like_content_and_unsafe_source_refs(conn):
    with pytest.raises(project_memory.ProjectMemoryError):
        project_memory.propose(
            conn,
            project_scope="demo-project",
            content="password = hunter2",
            category="gotcha",
        )
    for unsafe_ref in ("../secrets.env", "C:\\Users\\rohi\\secret.txt", "\\\\server\\share\\secret.txt"):
        with pytest.raises(project_memory.ProjectMemoryError):
            project_memory.propose(
                conn,
                project_scope="demo-project",
                content="Safe architecture statement.",
                category="architecture",
                source_refs=[unsafe_ref],
            )
    with pytest.raises(project_memory.ProjectMemoryError):
        project_memory.resolve_project_scope("/home/rohi/project")


def test_tampered_or_invalid_project_ids_are_not_derived():
    with pytest.raises(project_memory.ProjectMemoryError):
        project_memory.project_id_from_remote("file:///home/rohi/private-repo")
    assert project_memory.discover_project_scope(Path("/tmp")) is None


def test_provider_uses_a_fresh_sqlite_connection_per_thread(tmp_path: Path):
    provider = openltm_hermes.OpenLtmpMemoryProvider()
    provider.initialize("test-session", hermes_home=str(tmp_path))
    results: list[str] = []

    def recall_from_worker() -> None:
        results.append(provider.handle_tool_call("openltm_recall", {"query": "no matching fact"}))

    worker = threading.Thread(target=recall_from_worker)
    worker.start()
    worker.join(timeout=5)
    try:
        assert not worker.is_alive()
        assert results == ["[]"]
    finally:
        provider.shutdown()


def test_provider_exposes_only_strict_reviewed_context(tmp_path: Path):
    provider = openltm_hermes.OpenLtmpMemoryProvider()
    provider.initialize("test-session", hermes_home=str(tmp_path))
    provider._project_scope = "demo-project"
    try:
        review_id = project_memory.propose(
            provider._conn,
            project_scope="demo-project",
            content="Only the reviewed deployment fact belongs in this project.",
            category="architecture",
        )["review"]["id"]
        project_memory.approve(provider._conn, review_id=review_id, reviewer="rohi")
        _db.learn(provider._conn, "Global facts must remain outside strict project context.", category="pattern")

        context = json.loads(provider.handle_tool_call("openltm_context", {"project": "demo-project"}))
        assert [item["review_id"] for item in context["reviewed_project_memory"]] == [review_id]
        assert "Only the reviewed deployment fact" in provider.system_prompt_block()
        assert "Global facts must remain outside" not in provider.system_prompt_block()
    finally:
        provider.shutdown()
