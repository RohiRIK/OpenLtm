"""
_db.py — SQLite vector storage and hybrid FTS5 + vector similarity search.

Mirrors the TypeScript dao/embeddings.ts + embeddings.ts + vec/index.ts
architecture:

  Storage layout:
    memories              — main table (has embedding BLOB column, legacy)
    memory_embeddings     — side table (memory_id → embedding blob, model, dim)
    memories_fts          — FTS5 virtual table (title, content)

  Search strategy (from db.ts recall()):
    1. FTS5 BM25 search (fast, keyword-based)
    2. If FTS5 returns fewer results than requested:
       a. Compute query embedding via provider
       b. Brute-force cosine similarity over all stored embeddings
       c. Merge results, dedupe by memory ID
    3. If no embedding provider is configured or available:
       FTS5 results only (graceful degradation)

  Embedding lifecycle (from db.ts learn()):
    - On learn: embed new memory (lazy, inline or queued)
    - On backfill: batch-embed all memories missing embeddings
    - On forget: remove embedding from memory_embeddings

  No sqlite-vec dependency — pure-Python cosine similarity fallback.
  (The TypeScript version optionally uses vec0 for ANN; we keep it simple
  with brute-force since Python's SQLite doesn't support virtual tables
  for vec0 without the extension.)
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

try:
    from ._providers import (
        EmbeddingProvider,
        Vector,
        blob_to_vec,
        cosine_similarity,
        vec_to_blob,
    )
except ImportError:
    from _providers import (
        EmbeddingProvider,
        Vector,
        blob_to_vec,
        cosine_similarity,
        vec_to_blob,
    )

logger = logging.getLogger(__name__)

# ─── Types ──────────────────────────────────────────────────────────────────

# FTS5 BM25 rank is a negative number (closer to 0 = better).
# Math.exp maps it to (0, 1] where 1 is a perfect match.
# (From db.ts line 553: ftsRanks.set(r.rowid, Math.exp(r.rank)))


@dataclass
class SimilarMemory:
    id: int
    content: str
    similarity: float


@dataclass
class RecallResult:
    """A single memory with its scoring breakdown."""
    id: int
    content: str
    category: str
    importance: int
    confidence: float
    # Scoring breakdown (mirrors RecallExplainer in explainer.ts)
    fts_rank: Optional[float] = None        # BM25 relevance [0, 1]
    semantic_score: Optional[float] = None  # cosine similarity [0, 1]
    decay_score: float = 0.0               # importance × confidence × decay
    stale: bool = False


# ─── Database class ─────────────────────────────────────────────────────────

class MemoryDB:
    """
    SQLite-backed long-term memory store with FTS5 + vector hybrid search.

    Usage:
        db = MemoryDB("path/to/openltm.db", provider=gemini_provider)
        db.learn("Supabase RLS must be enabled before production",
                 category="gotcha", importance=5)
        results = await db.recall("How do I secure Supabase?", limit=10)
    """

    # Half-life in days by importance level. Infinity = never decays.
    HALF_LIVES: dict[int, float] = {5: float("inf"), 4: 180, 3: 90, 2: 30, 1: 14}
    DEPRECATION_THRESHOLD = 0.25

    def __init__(self, db_path: str, provider: Optional[EmbeddingProvider] = None):
        import sqlite3
        self._db_path = db_path
        self._provider = provider
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        """Create tables if they don't exist (matches schema.sql)."""
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS memories (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                content           TEXT NOT NULL,
                title             TEXT,
                category          TEXT NOT NULL,
                importance        INTEGER NOT NULL DEFAULT 3,
                confidence        REAL NOT NULL DEFAULT 1.0,
                source            TEXT,
                project_scope     TEXT,
                dedup_key         TEXT UNIQUE,
                created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                last_confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
                confirm_count     INTEGER NOT NULL DEFAULT 1,
                status            TEXT NOT NULL DEFAULT 'active',
                embedding         BLOB,
                last_used_at      TEXT NOT NULL DEFAULT (datetime('now')),
                first_recalled_at TEXT,
                last_recalled_at  TEXT,
                recall_count      INTEGER NOT NULL DEFAULT 0,
                superseded_by     INTEGER,
                superseded_at     TEXT,
                stale_flagged_at  TEXT,
                stale_reason      TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
            CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
            CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

            -- FTS5 virtual table for full-text search
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                title, content,
                content='memories',
                content_rowid='id'
            );

            -- Triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, title, content)
                VALUES (new.id, coalesce(new.title, ''), new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, title, content)
                VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, title, content)
                VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
                INSERT INTO memories_fts(rowid, title, content)
                VALUES (new.id, coalesce(new.title, ''), new.content);
            END;

            -- Side table for embeddings (mirrors migration 010)
            CREATE TABLE IF NOT EXISTS memory_embeddings (
                memory_id   INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
                embedding   BLOB NOT NULL,
                model       TEXT NOT NULL,
                dim         INTEGER NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_embeddings_memory ON memory_embeddings(memory_id);
        """)

    # ─── Learn ───────────────────────────────────────────────────────────

    def learn(
        self,
        content: str,
        category: str = "pattern",
        importance: int = 3,
        confidence: float = 1.0,
        source: str | None = None,
        project_scope: str | None = None,
        skip_embed: bool = False,
    ) -> dict:
        """
        Store a new memory. Returns {"action": "created"|"reinforced", "id": int}.
        Embedding is computed lazily (on learn, not on every recall).
        """
        # Dedup check (matches normalizeKey() in TypeScript)
        dedup_key = content.strip().lower()
        existing = self._conn.execute(
            "SELECT id, confirm_count FROM memories WHERE dedup_key=?",
            (dedup_key,),
        ).fetchone()

        if existing:
            # Reinforce existing memory
            new_count = existing["confirm_count"] + 1
            self._conn.execute(
                """UPDATE memories SET
                    confirm_count = confirm_count + 1,
                    last_confirmed_at = datetime('now'),
                    confidence = MIN(1.0, confidence + 0.05)
                   WHERE id = ?""",
                (existing["id"],),
            )
            self._conn.commit()
            return {"action": "reinforced", "id": existing["id"]}

        # Derive title (matches deriveTitle() in TypeScript)
        title = self._derive_title(content)

        cur = self._conn.execute(
            """INSERT INTO memories
               (content, title, category, importance, confidence, source,
                project_scope, dedup_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (content, title, category, importance, confidence,
             source, project_scope, dedup_key),
        )
        memory_id: int = cur.lastrowid  # type: ignore[assignment]
        self._conn.commit()

        # Lazy embedding (fire-and-forget pattern from db.ts line 514)
        if not skip_embed and self._provider and memory_id is not None:
            import asyncio
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._embed_and_store(memory_id, content))
            except RuntimeError:
                # No event loop running — embed synchronously (CLI path)
                import asyncio as _asyncio
                _asyncio.run(self._embed_and_store(memory_id, content))

        return {"action": "created", "id": memory_id}

    async def _embed_and_store(self, memory_id: int, content: str) -> None:
        """Embed a single memory and store the vector."""
        if not self._provider or not await self._provider.available():
            return
        try:
            vec = await self._provider.generate(content)
            if vec:
                self.set_embedding(memory_id, vec, self._provider.model, self._provider.dim)
                logger.debug(f"[embed] memory {memory_id} embedded ({self._provider.dim}d)")
        except Exception as e:
            logger.error(f"[embed] Failed for memory {memory_id}: {e}")

    @staticmethod
    def _derive_title(content: str) -> str:
        """Derive a short title from content when none is supplied."""
        trimmed = content.strip()
        dot = trimmed.find(".")
        nl = trimmed.find("\n")
        boundaries = [b for b in [dot, nl] if 1 < b <= 60]
        if boundaries:
            return trimmed[: min(boundaries)].strip()
        if len(trimmed) <= 60:
            return trimmed
        cut = trimmed[:57]
        last_space = cut.rfind(" ")
        return (cut[:last_space] if last_space > 20 else cut) + "…"

    # ─── Embedding storage ───────────────────────────────────────────────

    def set_embedding(self, memory_id: int, vec: Vector, model: str, dim: int) -> None:
        """Upsert an embedding for a memory (mirrors dao/embeddings.ts setEmbedding)."""
        blob = vec_to_blob(vec)
        self._conn.execute(
            """INSERT INTO memory_embeddings (memory_id, embedding, model, dim, created_at)
               VALUES (?, ?, ?, ?, datetime('now'))
               ON CONFLICT(memory_id) DO UPDATE SET
                 embedding=excluded.embedding,
                 model=excluded.model,
                 dim=excluded.dim,
                 created_at=excluded.created_at""",
            (memory_id, blob, model, dim),
        )
        # Also update the legacy embedding column on memories table
        self._conn.execute(
            "UPDATE memories SET embedding=? WHERE id=?",
            (blob, memory_id),
        )
        self._conn.commit()

    def get_embedding(self, memory_id: int) -> Optional[Vector]:
        """Return the stored embedding for a memory, or None."""
        row = self._conn.execute(
            "SELECT embedding FROM memory_embeddings WHERE memory_id=?",
            (memory_id,),
        ).fetchone()
        if row and row["embedding"]:
            return blob_to_vec(row["embedding"])
        return None

    def delete_embedding(self, memory_id: int) -> None:
        """Remove the embedding for a memory."""
        self._conn.execute(
            "DELETE FROM memory_embeddings WHERE memory_id=?", (memory_id,)
        )
        self._conn.commit()

    def list_ids_missing_embedding(self, limit: int = 100) -> list[int]:
        """Return memory IDs that have no entry in memory_embeddings."""
        rows = self._conn.execute(
            """SELECT m.id FROM memories m
               LEFT JOIN memory_embeddings e ON e.memory_id = m.id
               WHERE m.status = 'active' AND e.memory_id IS NULL
               ORDER BY m.importance DESC, m.created_at DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        return [r["id"] for r in rows]

    # ─── Recall (FTS5 + vector hybrid) ───────────────────────────────────

    async def recall(
        self,
        query: str | None = None,
        limit: int = 10,
        category: str | None = None,
        project: str | None = None,
        sort_by: str = "relevance",
        semantic_fallback: bool = True,
        semantic_threshold: float = 0.5,
    ) -> list[RecallResult]:
        """
        Hybrid search: FTS5 first, vector similarity to augment.

        Strategy (mirrors db.ts recall(), lines 529-703):
          1. FTS5 BM25 search (fast, keyword-based)
          2. If FTS5 returned fewer results than `limit`:
             a. Embed the query text
             b. Brute-force cosine similarity over all stored embeddings
             c. Merge, dedupe by memory ID
          3. If no provider or API unavailable: FTS5 only (graceful fallback)
        """
        fts_ranks: dict[int, float] = {}
        semantic_scores: dict[int, float] = {}
        candidate_ids: set[int] | None = None

        if query:
            # Step 1: FTS5 search (matches db.ts lines 538-554)
            fts_query = " OR ".join(
                f'"{token.strip()}"' for token in query.split() if token.strip()
            )
            if fts_query:
                try:
                    fts_rows = self._conn.execute(
                        "SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? "
                        "ORDER BY rank LIMIT 50",
                        (fts_query,),
                    ).fetchall()
                    candidate_ids = set()
                    for row in fts_rows:
                        rid = row["rowid"]
                        candidate_ids.add(rid)
                        # FTS5 BM25 rank → [0, 1] via exp() (db.ts line 553)
                        fts_ranks[rid] = math.exp(row["rank"])
                except Exception as e:
                    logger.warning(f"[recall] FTS5 search failed: {e}")

            # Step 2: Semantic fallback (db.ts lines 556-573)
            if candidate_ids is not None and len(candidate_ids) < limit and semantic_fallback:
                if self._provider and await self._provider.available():
                    try:
                        semantic = await self._get_similar_memories(
                            query, top_n=limit * 2, threshold=semantic_threshold
                        )
                        if candidate_ids is None:
                            candidate_ids = set()
                        for m in semantic:
                            candidate_ids.add(m.id)
                            semantic_scores[m.id] = m.similarity
                    except Exception as e:
                        logger.warning(f"[recall] Semantic fallback failed: {e}")

        # Build WHERE clause
        conditions = ["status = 'active'"]
        params: list = []

        if candidate_ids is not None:
            if not candidate_ids:
                return []
            placeholders = ",".join("?" * len(candidate_ids))
            conditions.append(f"id IN ({placeholders})")
            params.extend(candidate_ids)

        if category:
            conditions.append("category = ?")
            params.append(category)

        if project:
            conditions.append("(project_scope IS NULL OR project_scope = ?)")
            params.append(project)

        where = " AND ".join(conditions)

        # Sort (mirrors db.ts lines 648-663)
        if sort_by == "created":
            order = "ORDER BY created_at DESC"
        elif sort_by == "last_recalled":
            order = "ORDER BY last_recalled_at DESC"
        elif sort_by == "recall_count":
            order = "ORDER BY recall_count DESC"
        elif candidate_ids is not None:
            # FTS/semantic path: sort by combined score in Python
            order = ""
        else:
            # No query: sort by decay_score (importance × confidence × decay)
            order = "ORDER BY importance DESC, confidence DESC"

        sql = f"SELECT id, content, category, importance, confidence FROM memories WHERE {where} {order} LIMIT ?"
        params.append(limit)

        rows = self._conn.execute(sql, params).fetchall()

        # Compute decay scores and build results
        results: list[RecallResult] = []
        for row in rows:
            mid = row["id"]
            decay = self._compute_decay_score(row)
            results.append(RecallResult(
                id=mid,
                content=row["content"],
                category=row["category"],
                importance=row["importance"],
                confidence=row["confidence"],
                fts_rank=fts_ranks.get(mid),
                semantic_score=semantic_scores.get(mid),
                decay_score=decay,
            ))

        # Sort by combined relevance (FTS rank, semantic score, decay)
        if candidate_ids is not None and not order:
            results.sort(
                key=lambda r: (
                    r.semantic_score or 0,
                    r.fts_rank or 0,
                    r.decay_score,
                ),
                reverse=True,
            )
        elif not order:
            results.sort(key=lambda r: r.decay_score, reverse=True)

        results = results[:limit]

        # Update recall stats (db.ts lines 670-679)
        if results:
            placeholders = ",".join("?" * len(results))
            ids = [r.id for r in results]
            self._conn.execute(
                f"""UPDATE memories SET
                    last_used_at = datetime('now'),
                    last_recalled_at = datetime('now'),
                    recall_count = recall_count + 1,
                    first_recalled_at = COALESCE(first_recalled_at, datetime('now'))
                    WHERE id IN ({placeholders})""",
                ids,
            )
            self._conn.commit()

        return results

    # ─── Semantic similarity (brute-force) ───────────────────────────────

    async def _get_similar_memories(
        self,
        text: str,
        top_n: int = 5,
        threshold: float = 0.5,
    ) -> list[SimilarMemory]:
        """
        Find top-N most similar memories using brute-force cosine similarity.

        Mirrors embeddings.ts getSimilarMemories() (lines 261-301):
          - Embed query text
          - Load all active memories with embeddings
          - Compute cosine similarity for each
          - Filter by threshold, sort by similarity, return top-N

        The TypeScript version tries sqlite-vec KNN first (vec/index.ts knnVec),
        then falls back to brute-force JS cosine. We skip vec0 entirely since
        Python's sqlite3 doesn't support it — brute-force is fine for <10K
        memories (the typical OpenLTM scale).
        """
        if not self._provider or not await self._provider.available():
            return []

        query_vec = await self._provider.generate(text)
        if not query_vec:
            return []

        # Load all active memories with embeddings
        rows = self._conn.execute(
            """SELECT m.id, m.content, e.embedding
               FROM memories m
               JOIN memory_embeddings e ON e.memory_id = m.id
               WHERE m.status = 'active'"""
        ).fetchall()

        scored: list[SimilarMemory] = []
        for row in rows:
            mem_vec = blob_to_vec(row["embedding"])
            sim = cosine_similarity(query_vec, mem_vec)
            if sim >= threshold:
                scored.append(SimilarMemory(
                    id=row["id"],
                    content=row["content"],
                    similarity=sim,
                ))

        scored.sort(key=lambda r: r.similarity, reverse=True)
        return scored[:top_n]

    # ─── Decay scoring ───────────────────────────────────────────────────

    def _compute_decay_score(self, row) -> float:  # row: sqlite3.Row
        """
        Compute effective relevance score.
        score = importance × confidence × decay
        decay = 0.5 ^ (days_since / half_life)
        (Mirrors db.ts computeDecayScore(), lines 234-245)
        """
        importance = row["importance"]
        half_life = self.HALF_LIVES.get(importance, 90)
        if half_life == float("inf"):
            return importance * row["confidence"]

        # Use last_recalled_at or last_used_at or last_confirmed_at or created_at
        # (whichever is latest). Handle missing columns gracefully since the
        # recall SELECT may not include all fields.
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc)
        latest_str = None
        for key in ("last_recalled_at", "last_used_at", "last_confirmed_at", "created_at"):
            try:
                val = row[key]
                if val:
                    latest_str = val
                    break
            except (IndexError, KeyError):
                continue
        if not latest_str:
            return importance * row["confidence"]
        try:
            latest = datetime.datetime.fromisoformat(latest_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            latest = now

        days_since = max((now - latest).total_seconds() / 86400, 0)
        decay = math.pow(0.5, days_since / half_life)
        return importance * row["confidence"] * decay

    # ─── Backfill ────────────────────────────────────────────────────────

    async def backfill_embeddings(self, batch_size: int = 20) -> int:
        """
        Embed all active memories that have no embedding yet.

        Mirrors embeddings.ts backfill() (lines 223-252):
          - List IDs missing embeddings
          - Process in batches of 20 with 200ms sleep between batches
          - Returns count of successfully embedded memories
        """
        if not self._provider or not await self._provider.available():
            logger.warning("[backfill] Provider not available, skipping")
            return 0

        ids = self.list_ids_missing_embedding(limit=1000)
        if not ids:
            return 0

        logger.info(f"[backfill] Embedding {len(ids)} memories...")
        done = 0

        for i in range(0, len(ids), batch_size):
            batch = ids[i : i + batch_size]

            # Collect content for batch
            placeholders = ",".join("?" * len(batch))
            rows = self._conn.execute(
                f"SELECT id, content FROM memories WHERE id IN ({placeholders})",
                batch,
            ).fetchall()

            texts = [r["content"] for r in rows]
            memory_ids = [r["id"] for r in rows]

            # Batch embed (Gemini supports up to 100 per call)
            vectors = await self._provider.generate_batch(texts)

            for mid, vec in zip(memory_ids, vectors):
                if vec:
                    self.set_embedding(mid, vec, self._provider.model, self._provider.dim)
                    done += 1

            progress = min(i + batch_size, len(ids))
            logger.info(f"[backfill] {progress}/{len(ids)} done")

            # Rate-limit pause between batches (matches TS Bun.sleep(200))
            if i + batch_size < len(ids):
                import asyncio
                await asyncio.sleep(0.2)

        logger.info(f"[backfill] Complete: {done}/{len(ids)} embedded")
        return done

    # ─── Forget ──────────────────────────────────────────────────────────

    def forget(self, memory_id: int) -> bool:
        """Delete a memory and its embedding. Returns True if found."""
        cur = self._conn.execute(
            "DELETE FROM memories WHERE id = ?", (memory_id,)
        )
        found = cur.rowcount > 0
        self._conn.commit()
        return found

    # ─── Cleanup ─────────────────────────────────────────────────────────

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
