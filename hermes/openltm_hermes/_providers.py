"""_providers.py — Embedding providers for OpenLTM vector search.

Supports:
- Gemini (models/gemini-embedding-2, 768 dims) — Rohi's configured provider
- OpenAI (text-embedding-3-small, 1536 dims)
- Ollama (nomic-embed-text, 768 dims)

Graceful fallback: if no provider is available, vector search is disabled
and FTS5 handles all recall.
"""

from __future__ import annotations

import json
import logging
import struct
from typing import Optional

logger = logging.getLogger(__name__)

# Provider configs — each knows its env var, model, and dimensions
PROVIDERS = {
    "gemini": {
        "env_var": "GEMINI_API_KEY",
        "model": "models/gemini-embedding-2",
        "dims": 768,
        "config_file": "mem0.json",
        "config_key": "llm_api_key",
    },
    "openai": {
        "env_var": "OPENAI_API_KEY",
        "model": "text-embedding-3-small",
        "dims": 1536,
    },
    "ollama": {
        "env_var": None,
        "model": "nomic-embed-text",
        "dims": 768,
        "base_url": "http://localhost:11434",
    },
}


class EmbeddingProvider:
    """Base embedding provider.

    ``embed()`` wraps the provider-specific ``_embed_impl()`` with a small
    in-memory LRU cache. Query embeddings dominate the per-turn prefetch hot
    path (a synchronous Gemini/OpenAI round-trip is ~1s), and the same or
    similar query text recurs constantly across turns and in the learn-dedup
    path — so caching identical text turns repeat embeds into a dict lookup.
    Failures (None) are never cached, so a transient network error still retries.
    """

    _CACHE_MAX = 512

    def __init__(self, name: str, model: str, dims: int):
        self.name = name
        self.model = model
        self.dims = dims
        from collections import OrderedDict
        self._cache: "OrderedDict[str, list[float]]" = OrderedDict()

    def embed(self, text: str) -> Optional[list[float]]:
        """Compute embedding for a single text (cached). Returns None on failure."""
        if not text:
            return None
        cached = self._cache.get(text)
        if cached is not None:
            self._cache.move_to_end(text)
            return cached
        vec = self._embed_impl(text)
        if vec is not None:
            self._cache[text] = vec
            if len(self._cache) > self._CACHE_MAX:
                self._cache.popitem(last=False)
        return vec

    def _embed_impl(self, text: str) -> Optional[list[float]]:
        """Provider-specific network call. Returns None on failure."""
        raise NotImplementedError

    def embed_batch(self, texts: list[str]) -> Optional[list[list[float]]]:
        """Compute embeddings for multiple texts. Returns None on failure."""
        results = []
        for t in texts:
            e = self.embed(t)
            if e is None:
                return None
            results.append(e)
        return results


class GeminiProvider(EmbeddingProvider):
    """Gemini embedding provider via REST API.

    Uses Authorization header (Bearer) for API key instead of query string
    to prevent key leakage via URL logs/proxies.
    """

    def __init__(self, api_key: str):
        super().__init__("gemini", "models/gemini-embedding-2", 768)
        self._api_key = api_key

    def _embed_impl(self, text: str) -> Optional[list[float]]:
        try:
            import urllib.request
            url = f"https://generativelanguage.googleapis.com/v1beta/{self.model}:embedContent"
            payload = json.dumps({
                "model": self.model,
                "content": {"parts": [{"text": text}]},
            }).encode()
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._api_key}",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data["embedding"]["values"]
        except Exception as e:
            logger.debug("Gemini embedding failed: %s", e)
            return None


class OpenAIProvider(EmbeddingProvider):
    """OpenAI embedding provider."""

    def __init__(self, api_key: str):
        super().__init__("openai", "text-embedding-3-small", 1536)
        self._api_key = api_key

    def _embed_impl(self, text: str) -> Optional[list[float]]:
        try:
            import urllib.request
            url = "https://api.openai.com/v1/embeddings"
            payload = json.dumps({"model": self.model, "input": text}).encode()
            req = urllib.request.Request(url, data=payload, headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data["data"][0]["embedding"]
        except Exception as e:
            logger.debug("OpenAI embedding failed: %s", e)
            return None


class OllamaProvider(EmbeddingProvider):
    """Ollama embedding provider (local)."""

    def __init__(self, base_url: str = "http://localhost:11434"):
        super().__init__("ollama", "nomic-embed-text", 768)
        self._base_url = base_url

    def _embed_impl(self, text: str) -> Optional[list[float]]:
        try:
            import urllib.request
            url = f"{self._base_url}/api/embeddings"
            payload = json.dumps({"model": self.model, "prompt": text}).encode()
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data["embedding"]
        except Exception as e:
            logger.debug("Ollama embedding failed: %s", e)
            return None


# ─── Discovery ───────────────────────────────────────────────────────────────

def detect_provider(embedder: str = "ollama") -> Optional[EmbeddingProvider]:
    """Build the embedding backend chosen in openltm.json (``embedder``).

    Cloud backends are never picked up from ambient API keys: ``gemini`` /
    ``openai`` must be selected explicitly (and their key must be set),
    ``ollama`` (default) probes the local server, ``none`` disables vectors.
    """
    import os

    if embedder == "gemini":
        key = os.environ.get("GEMINI_API_KEY")
        if key:
            return GeminiProvider(key)
        logger.warning("embedder=gemini but GEMINI_API_KEY is not set — vector search disabled")
        return None

    if embedder == "openai":
        key = os.environ.get("OPENAI_API_KEY")
        if key:
            return OpenAIProvider(key)
        logger.warning("embedder=openai but OPENAI_API_KEY is not set — vector search disabled")
        return None

    if embedder == "ollama":
        try:
            import urllib.request
            req = urllib.request.Request("http://localhost:11434/api/tags")
            with urllib.request.urlopen(req, timeout=2) as resp:
                logger.info("Detected Ollama embedding provider")
                return OllamaProvider()
        except Exception:
            logger.info("Ollama not reachable — vector search disabled")
            return None

    if embedder != "none":
        logger.warning("Unknown embedder %r — vector search disabled", embedder)
    return None


# ─── Vector Utilities ────────────────────────────────────────────────────────

def embedding_to_blob(vector: list[float]) -> bytes:
    """Convert float vector to binary BLOB (float32 little-endian)."""
    return struct.pack(f"<{len(vector)}f", *vector)


def blob_to_embedding(blob: bytes, dims: int) -> Optional[list[float]]:
    """Convert binary BLOB back to float vector."""
    if not blob or len(blob) < dims * 4:
        return None
    return list(struct.unpack(f"<{dims}f", blob[:dims * 4]))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
