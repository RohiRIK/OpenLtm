"""
_providers.py — Embedding provider interface and Gemini implementation.

Mirrors the TypeScript providers/embeddingProvider.ts + providers/gemini.ts
pattern: a common EmbeddingProvider ABC with concrete GeminiProvider that
calls the Gemini embedding API (models/gemini-embedding-2, 768 dims).

Design decisions (ported from the TypeScript codebase):
  - Provider is a lightweight object — no global state, no singletons.
  - `available()` is a fast API-key check, not a network call.
  - `generate()` returns Float32Array | None — None means "API unavailable,
    caller should fall back to FTS5 only".
  - `generate_batch()` is optional — providers that don't support batch
    endpoint fall back to sequential generate() calls.
  - No retry logic here — retry/backoff belongs in the caller (queue worker).
"""

from __future__ import annotations

import struct
import logging
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Types ──────────────────────────────────────────────────────────────────

# Float32 vector as a plain Python list of floats (numpy-free).
# Stored in SQLite as a BLOB via vec_to_blob / blob_to_vec.
Vector = list[float]

EMBED_DIMS: dict[str, int] = {
    "models/gemini-embedding-2": 768,
    "text-embedding-004": 768,
    "text-embedding-3-small": 1536,
}


# ─── Blob ↔ Vector conversion ───────────────────────────────────────────────

def vec_to_blob(v: Vector) -> bytes:
    """Pack a float32 vector into a compact bytes blob for SQLite storage."""
    return struct.pack(f"{len(v)}f", *v)


def blob_to_vec(b: bytes) -> Vector:
    """Unpack a float32 blob back into a Python list of floats."""
    n = len(b) // 4
    return list(struct.unpack(f"{n}f", b))


# ─── Cosine similarity ──────────────────────────────────────────────────────

def cosine_similarity(a: Vector, b: Vector) -> float:
    """
    Pure-Python cosine similarity — no numpy dependency.
    Returns 0.0 for zero vectors or dimension mismatch.
    """
    if len(a) != len(b):
        return 0.0
    dot = norm_a = norm_b = 0.0
    for ai, bi in zip(a, b):
        dot += ai * bi
        norm_a += ai * ai
        norm_b += bi * bi
    denom = (norm_a ** 0.5) * (norm_b ** 0.5)
    return dot / denom if denom > 0 else 0.0


# ─── Abstract provider ──────────────────────────────────────────────────────

class EmbeddingProvider(ABC):
    """Base class for all embedding providers."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def model(self) -> str: ...

    @property
    @abstractmethod
    def dim(self) -> int:
        """Output dimensionality of the embeddings."""
        ...

    @abstractmethod
    async def available(self) -> bool:
        """Fast check — is the API key present and valid? No network calls."""
        ...

    @abstractmethod
    async def generate(self, text: str) -> Optional[Vector]:
        """Embed a single text. Returns None on API failure."""
        ...

    async def generate_batch(self, texts: list[str]) -> list[Optional[Vector]]:
        """
        Embed multiple texts. Default: sequential generate().
        Override in providers that support native batch endpoints.
        """
        results: list[Optional[Vector]] = []
        for text in texts:
            results.append(await self.generate(text))
        return results


# ─── Disabled provider (default) ───────────────────────────────────────────

class DisabledProvider(EmbeddingProvider):
    """No-op provider — zero I/O, zero API key required. FTS5-only mode."""

    @property
    def name(self) -> str:
        return "disabled"

    @property
    def model(self) -> str:
        return "none"

    @property
    def dim(self) -> int:
        return 0

    async def available(self) -> bool:
        return False

    async def generate(self, text: str) -> Optional[Vector]:
        return None


# ─── Gemini provider ────────────────────────────────────────────────────────

class GeminiProvider(EmbeddingProvider):
    """
    Gemini embedding provider using the Google AI REST API.

    Model: models/gemini-embedding-2 (768 dims, task_type unspecified
    defaults to RETRIEVAL_DOCUMENT).

    API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent
    Docs: https://ai.google.dev/api/rest/v1beta/models/embedContent

    Design notes from the TypeScript version (providers/gemini.ts):
      - Uses embedContent for single texts, batchEmbedContents for batches.
      - The TypeScript version hardcodes dim=768; we derive from model name.
      - No SDK dependency — pure HTTP, same pattern as embeddings.ts.
    """

    DEFAULT_MODEL = "models/gemini-embedding-2"
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
    DEFAULT_DIM = 768
    BATCH_SIZE = 100  # Gemini batchEmbedContents limit

    def __init__(self, api_key: str, model: str | None = None):
        self._api_key = api_key
        self._model = model or self.DEFAULT_MODEL
        self._dim = EMBED_DIMS.get(self._model, self.DEFAULT_DIM)

    @property
    def name(self) -> str:
        return "gemini"

    @property
    def model(self) -> str:
        return self._model

    @property
    def dim(self) -> int:
        return self._dim

    async def available(self) -> bool:
        return bool(self._api_key)

    async def generate(self, text: str) -> Optional[Vector]:
        """
        Embed a single text via the Gemini embedContent endpoint.

        Returns None on:
          - Empty API key
          - HTTP error (429 rate limit, 500 server error, etc.)
          - Missing embedding in response
        """
        if not self._api_key:
            return None

        import httpx

        url = f"{self.BASE_URL}/{self._model}:embedContent?key={self._api_key}"
        payload = {
            "model": self._model,
            "content": {"parts": [{"text": text}]},
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                values = data.get("embedding", {}).get("values")
                if not values:
                    logger.warning("[gemini] No embedding values in response")
                    return None
                return [float(v) for v in values]
        except Exception as e:
            logger.error(f"[gemini] generate failed: {e}")
            return None

    async def generate_batch(self, texts: list[str]) -> list[Optional[Vector]]:
        """
        Batch embed via Gemini's batchEmbedContents endpoint.
        Falls back to sequential single embeddings if batch fails.
        Gemini supports up to 100 texts per batch call.
        """
        if not self._api_key:
            return [None] * len(texts)

        import httpx

        results: list[Optional[Vector]] = []

        # Process in chunks of BATCH_SIZE
        for i in range(0, len(texts), self.BATCH_SIZE):
            chunk = texts[i : i + self.BATCH_SIZE]
            url = f"{self.BASE_URL}/{self._model}:batchEmbedContents?key={self._api_key}"
            payload = {
                "requests": [
                    {
                        "model": self._model,
                        "content": {"parts": [{"text": t}]},
                    }
                    for t in chunk
                ],
            }

            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(url, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    embeddings = data.get("embeddings", [])
                    for emb in embeddings:
                        values = emb.get("values")
                        if values:
                            results.append([float(v) for v in values])
                        else:
                            results.append(None)
            except Exception as e:
                logger.warning(f"[gemini] batch embed failed ({len(chunk)} texts): {e}")
                # Fallback: sequential single embeddings for this chunk
                for t in chunk:
                    results.append(await self.generate(t))

        return results


# ─── Factory ────────────────────────────────────────────────────────────────

async def load_provider(
    provider_name: str = "disabled",
    api_key: str | None = None,
    model: str | None = None,
) -> EmbeddingProvider:
    """
    Factory — mirrors the TypeScript loadProvider() pattern.
    Returns the configured provider. Falls back to DisabledProvider
    if the provider name is unrecognised or the API key is missing.
    """
    if provider_name == "gemini":
        if not api_key:
            logger.warning("[providers] Gemini provider requested but no API key provided")
            return DisabledProvider()
        return GeminiProvider(api_key=api_key, model=model)

    return DisabledProvider()
