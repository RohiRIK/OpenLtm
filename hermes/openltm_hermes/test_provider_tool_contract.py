"""Direct provider-tool contract used by unattended Hermes memory jobs."""
import json
import sqlite3
from unittest.mock import patch

import pytest
import openltm_hermes


@pytest.fixture
def provider(tmp_path):
    instance = openltm_hermes.OpenLtmpMemoryProvider()
    with patch("openltm_hermes._providers.detect_provider", return_value=None):
        instance.initialize("isolated-tool-contract", hermes_home=str(tmp_path))
    try:
        yield instance
    finally:
        instance._conn.close()


def test_prompt_explains_direct_tools_and_receipt_boundary(provider):
    prompt = provider.system_prompt_block()
    assert "directly exposed" in prompt
    assert "not through tool_call" in prompt
    assert "hermes_tools" in prompt
    assert "successful tool receipt" in prompt


def test_schemas_are_bare_direct_functions(provider):
    schemas = provider.get_tool_schemas()
    names = {schema["name"] for schema in schemas}
    assert {"openltm_learn", "openltm_recall", "openltm_brain_stats"} <= names
    assert all("parameters" in schema and "function" not in schema for schema in schemas)


def test_direct_learn_then_recall_requires_real_receipt(provider):
    receipt = json.loads(provider.handle_tool_call("openltm_learn", {
        "content": "The isolated test fixture uses a coral heron marker.",
        "title": "Isolated test marker", "category": "pattern", "importance": 1,
    }))
    assert receipt["action"] == "created"
    assert isinstance(receipt["id"], int)
    result = json.loads(provider.handle_tool_call("openltm_recall", {
        "query": "coral heron marker", "limit": 3,
    }))
    assert any(memory["id"] == receipt["id"] for memory in result)


def test_failed_write_has_no_saved_id_or_success_action(provider):
    before = provider._conn.execute("SELECT count(*) FROM memories").fetchone()[0]
    with patch.object(openltm_hermes._get_db(), "learn",
                      side_effect=sqlite3.OperationalError("fixture write denied")):
        result = json.loads(provider.handle_tool_call("openltm_learn", {
            "content": "Must not be reported saved.", "category": "pattern",
        }))
    assert "fixture write denied" in result["error"]
    assert "id" not in result and "action" not in result
    assert provider._conn.execute("SELECT count(*) FROM memories").fetchone()[0] == before
