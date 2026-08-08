"""
openltm-embed — Gemini embedding integration for OpenLTM vector search.

Public API surface:
  - MemoryDB: SQLite store with hybrid FTS5 + vector search
  - GeminiProvider: Gemini embedding API client
  - load_provider(): provider factory
  - cosine_similarity, vec_to_blob, blob_to_vec: math utilities

Usage example:
    import asyncio
    from _providers import GeminiProvider
    from _db import MemoryDB

    async def main():
        provider = GeminiProvider(api_key="AIzaSy...BRt4")
        db = MemoryDB("openltm.db", provider=provider)

        # Learn (embedding computed lazily in background)
        db.learn("Docker swarm overlay networks require encrypted comms",
                 category="gotcha", importance=4)

        # Recall (FTS5 first, vector fallback)
        results = await db.recall("How do I secure Docker networking?", limit=5)
        for r in results:
            print(f"[{r.id}] {r.content[:80]}...")
            print(f"     fts={r.fts_rank}  semantic={r.semantic_score}  decay={r.decay_score:.3f}")

        db.close()

    asyncio.run(main())

Architecture (mirrors OpenLTM TypeScript codebase):
  ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐
  │  _providers  │────▶│    _db.py    │────▶│  SQLite           │
  │              │     │              │     │  memories         │
  │ GeminiProvider│    │  MemoryDB    │     │  memories_fts     │
  │ Disabled     │     │  recall()    │     │  memory_embeddings│
  └──────────────┘     │  learn()     │     └───────────────────┘
                       └──────────────┘

Search flow (from db.ts recall()):
  1. FTS5 BM25 → set of candidate IDs
  2. If |candidates| < limit → embed query → cosine similarity → augment
  3. Merge, dedupe, sort by (semantic_score, fts_rank, decay_score)
  4. Update recall stats (last_used_at, recall_count)

Embedding lifecycle (from db.ts learn() + embeddings.ts):
  On learn:  embedMemory() → provider.generate() → setEmbedding()
  On recall: embedText(query) → brute-force cosine over stored vectors
  On backfill: listMemoryIdsMissingEmbedding() → batch generate → setEmbedding()

Fallback strategy (mirrors extensions.ts capabilities pattern):
  - No API key → DisabledProvider → FTS5 only
  - API timeout/error → generate() returns None → FTS5 only
  - Provider available → full hybrid search

Error handling:
  - All provider failures log + return None (never crash the caller)
  - DB operations are synchronous (sqlite3 default)
  - Embedding generation is async (httpx)
  - Batch failures fall back to sequential single embeddings
"""

try:
    from ._providers import (
        EmbeddingProvider,
        DisabledProvider,
        GeminiProvider,
        Vector,
        EMBED_DIMS,
        blob_to_vec,
        cosine_similarity,
        load_provider,
        vec_to_blob,
    )
    from ._db import (
        MemoryDB,
        RecallResult,
        SimilarMemory,
    )
except ImportError:
    from _providers import (
        EmbeddingProvider,
        DisabledProvider,
        GeminiProvider,
        Vector,
        EMBED_DIMS,
        blob_to_vec,
        cosine_similarity,
        load_provider,
        vec_to_blob,
    )
    from _db import (
        MemoryDB,
        RecallResult,
        SimilarMemory,
    )

__all__ = [
    # Providers
    "EmbeddingProvider",
    "DisabledProvider",
    "GeminiProvider",
    "load_provider",
    # DB
    "MemoryDB",
    "RecallResult",
    "SimilarMemory",
    # Math
    "Vector",
    "EMBED_DIMS",
    "blob_to_vec",
    "cosine_similarity",
    "vec_to_blob",
]
