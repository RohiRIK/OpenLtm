"""Real HTTP-contract coverage for the opt-in local llama.cpp provider."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from openltm_hermes._providers import detect_provider


@pytest.fixture
def backend():
    state = {"requests": [], "vector": [0.25, 0.5, 0.75], "health": 200, "status": 200}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            state["requests"].append((self.path, None))
            self.send_response(state["health"])
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append((self.path, body))
            self.send_response(state["status"])
            self.end_headers()
            response = state.get("response", {"data": [{"embedding": state["vector"]}]})
            self.wfile.write(json.dumps(response).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["url"] = f"http://127.0.0.1:{server.server_port}"
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_explicit_llamacpp_uses_health_and_openai_embedding_contract(
    backend, monkeypatch
):
    monkeypatch.setenv("LTM_LLAMA_CPP_URL", backend["url"])
    monkeypatch.setenv("LTM_EMBED_MODEL", "fixture-model")
    provider = detect_provider("llamacpp")
    assert provider is not None
    assert provider.name == "llamacpp"
    assert provider.model == "fixture-model"
    assert provider.embed("hello Hermes") == [0.25, 0.5, 0.75]
    assert provider.dims == 3
    assert backend["requests"] == [
        ("/health", None),
        ("/v1/embeddings", {"model": "fixture-model", "input": "hello Hermes"}),
    ]


@pytest.mark.parametrize(
    "vector",
    [
        [],
        None,
        "oops",
        [True],
        [float("nan")],
        [float("inf")],
        [[0.5]],
        ["0.5"],
        [1e100],
    ],
)
def test_invalid_vectors_fail_without_caching(backend, monkeypatch, vector):
    monkeypatch.setenv("LTM_LLAMA_CPP_URL", backend["url"])
    backend["vector"] = vector
    provider = detect_provider("llamacpp")
    assert provider is not None
    assert provider.embed("retry") is None
    assert provider.dims == 1024
    backend["vector"] = [0.5, 0.75]
    assert provider.embed("retry") == [0.5, 0.75]


def test_config_overrides_environment(backend, monkeypatch):
    monkeypatch.setenv("LTM_LLAMA_CPP_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("LTM_EMBED_MODEL", "wrong-model")
    provider = detect_provider(
        "llamacpp",
        {"llamacpp_url": backend["url"] + "/", "embedding_model": "configured-model"},
    )
    assert provider is not None
    assert provider.model == "configured-model"
    assert provider.embed("configured") == backend["vector"]
    assert backend["requests"][-1][1]["model"] == "configured-model"


def test_initialize_passes_json_settings_to_provider(backend, tmp_path, monkeypatch):
    import sys
    import types
    from openltm_hermes import OpenLtmpMemoryProvider

    constants = types.ModuleType("hermes_constants")
    setattr(constants, "get_hermes_home", lambda: tmp_path)
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    monkeypatch.setenv("LTM_LLAMA_CPP_URL", "http://127.0.0.1:1")
    (tmp_path / "openltm.json").write_text(
        json.dumps(
            {
                "embedder": "llamacpp",
                "llamacpp_url": backend["url"],
                "embedding_model": "configured-model",
            }
        )
    )
    provider = OpenLtmpMemoryProvider()
    try:
        provider.initialize("test-config", hermes_home=str(tmp_path))
        assert provider._embedder is not None
        assert provider._embedder.model == "configured-model"
    finally:
        provider._conn.close()


@pytest.mark.parametrize("status", [404, 500, 503])
def test_unavailable_health_never_falls_back_to_cloud(backend, monkeypatch, status):
    backend["health"] = status
    monkeypatch.setenv("LTM_LLAMA_CPP_URL", backend["url"])
    monkeypatch.setenv("GEMINI_API_KEY", "ambient-key")
    monkeypatch.setenv("OPENAI_API_KEY", "ambient-key")
    assert detect_provider("llamacpp") is None
    assert backend["requests"] == [("/health", None)]


def test_http_failure_retries_and_success_is_cached(backend, monkeypatch):
    monkeypatch.setenv("LTM_LLAMA_CPP_URL", backend["url"])
    provider = detect_provider("llamacpp")
    assert provider is not None
    backend["status"] = 500
    assert provider.embed("retry") is None
    backend["status"] = 200
    assert provider.embed("retry") == backend["vector"]
    count = len(backend["requests"])
    assert provider.embed("retry") == backend["vector"]
    assert len(backend["requests"]) == count
    assert provider.embed("") is None


def test_model_identity_survives_core_embedding_layout(backend, monkeypatch, tmp_path):
    from openltm_hermes import _db
    from openltm_hermes.test_shared_db import core_migration_010

    monkeypatch.setenv("LTM_LLAMA_CPP_URL", backend["url"])
    monkeypatch.setenv("LTM_EMBED_MODEL", "fixture-model")
    provider = detect_provider("llamacpp")
    assert provider is not None
    conn = _db.connect(tmp_path / "fixture.db")
    try:
        _db.init_schema(conn)
        core_migration_010(conn)
        mid = _db.learn(
            conn, "llamacpp fixture memory", category="pattern", embedder=provider
        )["id"]
        row = conn.execute(
            "SELECT model,dim FROM memory_embeddings WHERE memory_id=?", (mid,)
        ).fetchone()
        assert (row["model"], row["dim"]) == ("fixture-model", 3)
        assert _db.recall(conn, query="fixture")[0]["id"] == mid
        vector = provider.embed("llamacpp fixture memory")
        assert vector is not None
        hit = _db.vector_search(conn, vector, model=provider.model)[0]
        assert hit["id"] == mid
        assert hit["similarity"] == pytest.approx(1.0)
        assert not _db.vector_search(conn, backend["vector"], model="other-model")
    finally:
        conn.close()


@pytest.mark.parametrize("response", [{}, {"data": []}, {"data": [{}]}, None])
def test_malformed_response_preserves_fts(backend, monkeypatch, tmp_path, response):
    from openltm_hermes import _db

    monkeypatch.setenv("LTM_LLAMA_CPP_URL", backend["url"])
    backend["response"] = response
    provider = detect_provider("llamacpp")
    assert provider is not None
    conn = _db.connect(tmp_path / "fallback.db")
    try:
        _db.init_schema(conn)
        mid = _db.learn(
            conn, "fallback keyword survives", category="pattern", embedder=provider
        )["id"]
        assert _db.recall(conn, query="fallback")[0]["id"] == mid
        assert provider.embed("fallback") is None
    finally:
        conn.close()


def test_llamacpp_defaults_and_ollama_default_are_unchanged(monkeypatch):
    from unittest.mock import patch
    from openltm_hermes._providers import OllamaProvider

    monkeypatch.delenv("LTM_LLAMA_CPP_URL", raising=False)
    monkeypatch.delenv("LTM_EMBED_MODEL", raising=False)
    with patch("urllib.request.urlopen") as request:
        provider = detect_provider("llamacpp")
        assert provider is not None
        assert provider.model == "bge-m3" and provider.dims == 1024
        assert request.call_args.args[0].full_url == "http://127.0.0.1:8080/health"
        assert isinstance(detect_provider(), OllamaProvider)
        assert request.call_args.args[0].full_url == "http://localhost:11434/api/tags"
