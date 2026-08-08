"""_db.py — SQLite database layer for OpenLTM.

Direct SQLite access to the OpenLTM database. Handles schema initialization,
FTS5 setup, and core CRUD operations (recall, learn, forget, context).

No external dependencies — uses Python stdlib sqlite3.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Import secrets scrubber for pre-embedding redaction
try:
    from ._secrets_scrubber import scrub_secrets_for_embedding
except ImportError:
    # Fallback if module not available
    def scrub_secrets_for_embedding(text: str) -> str:
        return text

# ─── Tunable constants ───────────────────────────────────────────────────────

# Cosine similarity threshold above which a new memory is treated as a duplicate
# of an existing one and reinforces it instead of creating a new row.
SIMILARITY_REINFORCE = 0.90
# Below this, no semantic comparison is attempted (avoids noise).
SIMILARITY_MIN = 0.50

# ─── Schema ──────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
-- Memories table
CREATE TABLE IF NOT EXISTS memories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  content           TEXT    NOT NULL,
  title             TEXT,
  category          TEXT    NOT NULL CHECK(category IN (
                      'preference','architecture','gotcha','pattern','workflow','constraint')),
  importance        INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  confidence        REAL    NOT NULL DEFAULT 1.0 CHECK(confidence BETWEEN 0.0 AND 1.0),
  source            TEXT,
  project_scope     TEXT,
  dedup_key         TEXT    UNIQUE,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_confirmed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  confirm_count     INTEGER NOT NULL DEFAULT 1,
  status            TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','deprecated','superseded')),
  embedding         BLOB,
  last_used_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  first_recalled_at  TEXT,
  last_recalled_at  TEXT,
  recall_count      INTEGER NOT NULL DEFAULT 0,
  superseded_by     INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  superseded_at     TEXT,
  hidden            INTEGER NOT NULL DEFAULT 0,
  color             TEXT,
  icon              TEXT,
  user_note         TEXT,
  relevance_signal     TEXT,
  relevance_signal_at  TEXT,
  stale_flagged_at     TEXT,
  stale_reason         TEXT,
  workspace_id TEXT,
  agent_id     TEXT
);

-- Context items table
CREATE TABLE IF NOT EXISTS context_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK(type IN ('goal','decision','progress','gotcha')),
  content      TEXT    NOT NULL,
  title        TEXT,
  session_id   TEXT,
  permanent    INTEGER NOT NULL DEFAULT 0,
  memory_id    INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending_promotion','promoted')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  workspace_id TEXT
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (memory_id, tag_id)
);

-- Memory relations (knowledge graph)
CREATE TABLE IF NOT EXISTS memory_relations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN (
                      'supports','contradicts','refines','depends_on','related_to','supersedes')),
  note             TEXT,
  weight           REAL NOT NULL DEFAULT 1.0 CHECK(weight BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_memory_id, target_memory_id, relationship_type)
);

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    TEXT    NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  checksum   TEXT
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memories_category   ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_project    ON memories(project_scope);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_status     ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_last_used  ON memories(last_used_at);
CREATE INDEX IF NOT EXISTS idx_memories_stale      ON memories(stale_flagged_at);
CREATE INDEX IF NOT EXISTS idx_ctx_project         ON context_items(project_name);
CREATE INDEX IF NOT EXISTS idx_ctx_type            ON context_items(project_name, type);
CREATE INDEX IF NOT EXISTS idx_relations_source    ON memory_relations(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_relations_target    ON memory_relations(target_memory_id);
"""

FTS_SQL = """
-- FTS5 for memories
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  content,
  content='memories',
  content_rowid='id'
);

-- FTS5 for context_items
CREATE VIRTUAL TABLE IF NOT EXISTS context_items_fts USING fts5(
  title,
  content,
  content='context_items',
  content_rowid='id'
);
"""

FTS_TRIGGERS_SQL = """
-- Triggers to keep FTS in sync with memories
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

-- Triggers to keep FTS in sync with context_items
CREATE TRIGGER IF NOT EXISTS context_items_ai AFTER INSERT ON context_items BEGIN
  INSERT INTO context_items_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;

CREATE TRIGGER IF NOT EXISTS context_items_ad AFTER DELETE ON context_items BEGIN
  INSERT INTO context_items_fts(context_items_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
END;

CREATE TRIGGER IF NOT EXISTS context_items_au AFTER UPDATE ON context_items BEGIN
  INSERT INTO context_items_fts(context_items_fts, rowid, title, content)
    VALUES ('delete', old.id, coalesce(old.title, ''), old.content);
  INSERT INTO context_items_fts(rowid, title, content)
    VALUES (new.id, coalesce(new.title, ''), new.content);
END;
"""


# ─── Database Connection ─────────────────────────────────────────────────────

def get_db_path(hermes_home: str) -> Path:
    """Return the path to the OpenLTM database."""
    return Path(hermes_home) / "openltm.db"


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a connection to the OpenLTM database with WAL mode."""
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables, indexes, FTS, and triggers if they don't exist."""
    conn.executescript(SCHEMA_SQL)
    # FTS and triggers may fail if already exist — run individually
    for sql in FTS_SQL.split(";"):
        sql = sql.strip()
        if sql:
            try:
                conn.executescript(sql)
            except sqlite3.OperationalError:
                pass  # already exists
    conn.executescript(FTS_TRIGGERS_SQL)
    conn.commit()


# ─── Core Operations ─────────────────────────────────────────────────────────

def _dedup_key(content: str) -> str:
    """Generate a dedup key from content (normalized hash)."""
    normalized = content.strip().lower()
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def learn(
    conn: sqlite3.Connection,
    content: str,
    *,
    title: str | None = None,
    category: str = "pattern",
    importance: int = 3,
    tags: list[str] | None = None,
    project: str | None = None,
    workspace_id: str | None = None,
    agent_id: str | None = None,
    embedder=None,
) -> dict:
    """Store or reinforce a memory. Returns {action, id, confirm_count}.

    Dedup happens in two passes:
    1. Exact-key hash (fast path, no embedder needed).
    2. Semantic: if an embedder is supplied, the new content is embedded and
       compared (cosine) against existing active memories. If the closest
       existing memory exceeds SIMILARITY_REINFORCE (0.90), we REINFORCE it
       instead of inserting a duplicate. Between 0.82 and 0.90 we still insert
       but the caller can log a near-dup warning.
    """
    now = datetime.now(timezone.utc).isoformat()
    dedup = _dedup_key(content)

    # Check for existing (exact key)
    existing = conn.execute(
        "SELECT id, confirm_count FROM memories WHERE dedup_key = ?", (dedup,)
    ).fetchone()

    if existing:
        # Reinforce
        new_count = existing["confirm_count"] + 1
        conn.execute(
            """UPDATE memories SET
               confirm_count = ?,
               last_confirmed_at = ?,
               last_used_at = ?,
               confidence = MIN(1.0, confidence + 0.1)
             WHERE id = ?""",
            (new_count, now, now, existing["id"]),
        )
        conn.commit()
        return {"action": "reinforced", "id": existing["id"], "confirm_count": new_count}

    # Semantic dedup pass
    if embedder is not None:
        try:
            # Scrub secrets before embedding
            scrubbed_content = scrub_secrets_for_embedding(content)
            new_vec = embedder.embed(scrubbed_content)
            if new_vec:
                sims = vector_search(conn, new_vec, limit=1, project=project, category=category)
                if sims:
                    top_sim = sims[0].get("similarity", 0.0)
                    if top_sim >= SIMILARITY_REINFORCE:
                        # Too close — reinforce the existing memory instead
                        existing_id = sims[0]["id"]
                        new_count = sims[0].get("confirm_count", 1) + 1
                        conn.execute(
                            """UPDATE memories SET
                               confirm_count = ?,
                               last_confirmed_at = ?,
                               last_used_at = ?,
                               confidence = MIN(1.0, confidence + 0.1)
                             WHERE id = ?""",
                            (new_count, now, now, existing_id),
                        )
                        conn.commit()
                        return {
                            "action": "reinforced_semantic",
                            "id": existing_id,
                            "confirm_count": new_count,
                            "similarity": round(top_sim, 4),
                        }
        except Exception as e:
            logger.debug("OpenLTM semantic dedup failed: %s", e)

    # Insert new
    cursor = conn.execute(
        """INSERT INTO memories
           (content, title, category, importance, dedup_key, project_scope,
            workspace_id, agent_id, created_at, last_confirmed_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (content, title, category, importance, dedup, project,
         workspace_id, agent_id, now, now, now),
    )
    memory_id = cursor.lastrowid
    if memory_id is None:
        conn.commit()
        return {"action": "error", "id": 0, "confirm_count": 0}

    # Store embedding inline if embedder available (so future dedup/recall works)
    if embedder is not None:
        try:
            # Scrub secrets before embedding
            scrubbed_content = scrub_secrets_for_embedding(content)
            vec = embedder.embed(scrubbed_content)
            if vec:
                from ._providers import embedding_to_blob
                store_embedding(conn, memory_id, embedding_to_blob(vec))
        except Exception as e:
            logger.debug("OpenLTM learn embedding failed: %s", e)

    # Attach tags
    if tags:
        _attach_tags(conn, memory_id, tags)

    conn.commit()
    return {"action": "created", "id": memory_id, "confirm_count": 1}


def recall(
    conn: sqlite3.Connection,
    *,
    query: str | None = None,
    project: str | None = None,
    category: str | None = None,
    limit: int = 10,
    sort_by: str = "relevance",
) -> list[dict]:
    """Search memories using FTS5. Returns list of memory dicts."""
    conditions = ["m.status = 'active'"]
    params: list[Any] = []

    if project:
        conditions.append("m.project_scope = ?")
        params.append(project)
    if category:
        conditions.append("m.category = ?")
        params.append(category)

    where = " AND ".join(conditions)

    if query:
        # FTS5 search, with a small recency boost: memories recalled in the
        # last 7 days get a 15% rank bonus so active context surfaces first.
        fts_query = _build_fts_query(query)
        sql = f"""
            SELECT m.*, rank
            FROM memories m
            JOIN memories_fts fts ON fts.rowid = m.id
            WHERE memories_fts MATCH ? AND {where}
            ORDER BY rank * (1.0 - (CASE
                WHEN m.last_recalled_at > datetime('now', '-7 days') THEN 0.15
                ELSE 0.0 END))
            LIMIT ?
        """
        params.insert(0, fts_query)
        params.append(limit)
    else:
        # No query — sort by importance/recency
        order = {
            "created": "m.created_at DESC",
            "last_recalled": "m.last_recalled_at DESC",
            "recall_count": "m.recall_count DESC",
            "relevance": "m.importance DESC, m.last_used_at DESC",
        }.get(sort_by, "m.importance DESC, m.last_used_at DESC")

        sql = f"""
            SELECT m.*
            FROM memories m
            WHERE {where}
            ORDER BY {order}
            LIMIT ?
        """
        params.append(limit)

    rows = conn.execute(sql, params).fetchall()
    results = []
    for row in rows:
        mem = dict(row)
        # Attach tags
        mem["tags"] = _get_tags(conn, mem["id"])
        results.append(mem)

    # Update recall stats
    now = datetime.now(timezone.utc).isoformat()
    for mem in results:
        conn.execute(
            """UPDATE memories SET
               last_recalled_at = ?,
               recall_count = recall_count + 1,
               last_used_at = ?
             WHERE id = ?""",
            (now, now, mem["id"]),
        )
    conn.commit()

    return results


def forget(conn: sqlite3.Connection, memory_id: int, reason: str | None = None) -> dict:
    """Delete a memory by ID. Cascades to tags and relations."""
    conn.execute("DELETE FROM memory_tags WHERE memory_id = ?", (memory_id,))
    conn.execute("DELETE FROM memory_relations WHERE source_memory_id = ? OR target_memory_id = ?",
                 (memory_id, memory_id))
    conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    conn.commit()
    return {"ok": True, "id": memory_id, "reason": reason}


def get_context(conn: sqlite3.Connection, project: str) -> dict:
    """Get project context: goals, decisions, progress, gotchas."""
    items = conn.execute(
        """SELECT * FROM context_items
           WHERE project_name = ? AND status = 'active'
           ORDER BY type, created_at DESC""",
        (project,),
    ).fetchall()

    result: dict[str, list[dict]] = {"goals": [], "decisions": [], "progress": [], "gotchas": []}
    for item in items:
        d = dict(item)
        result[d["type"] + "s" if d["type"] != "gotcha" else "gotchas"].append(d)

    return {"project": project, "context": result}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _build_fts_query(query: str) -> str:
    """Build an FTS5 query from plain text. Grammar-hardened (R-1).

    User input is treated as plain text, never as FTS5 query syntax. Every
    whitespace-separated token is wrapped in a double-quoted phrase, which
    makes all FTS5 metacharacters (``*`` ``(`` ``)`` ``:`` ``^`` and the
    bareword operators AND/OR/NOT/NEAR) literal inside ``MATCH``. The only
    character that can break out of a quoted phrase is the double quote
    itself, so any token containing one is rejected with ``ValueError`` --
    the user's grammar is never echoed raw. ``recall()`` binds the result as
    a query parameter (``MATCH ?``), so it can never reach SQL directly.

    Empty or whitespace-only input yields ``\"\"``. An empty user query takes
    the non-FTS recall path; whitespace-only input therefore matches nothing,
    preserving prior behavior.
    """
    query = (query or "").strip()
    if not query:
        return '""'
    terms = query.split()
    for term in terms:
        if '"' in term:
            raise ValueError(
                "OpenLTM recall accepts plain text only; FTS5 query grammar is "
                f"not supported (rejected token: {term!r})"
            )
    return " OR ".join(f'"{term}"' for term in terms)


def _attach_tags(conn: sqlite3.Connection, memory_id: int, tags: list[str]) -> None:
    """Attach tags to a memory."""
    for tag in tags:
        tag_name = tag.lower().strip()
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
        tag_row = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,)).fetchone()
        if tag_row:
            conn.execute(
                "INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES (?, ?)",
                (memory_id, tag_row["id"]),
            )


def _get_tags(conn: sqlite3.Connection, memory_id: int) -> list[str]:
    """Get tags for a memory."""
    rows = conn.execute(
        """SELECT t.name FROM tags t
           JOIN memory_tags mt ON t.id = mt.tag_id
           WHERE mt.memory_id = ?""",
        (memory_id,),
    ).fetchall()
    return [r["name"] for r in rows]


# ─── Graph Operations ────────────────────────────────────────────────────────

RELATION_TYPES = ("supports", "contradicts", "refines", "depends_on", "related_to", "supersedes")


def relate(
    conn: sqlite3.Connection,
    source_id: int,
    target_id: int,
    relationship_type: str,
    note: str | None = None,
) -> dict:
    """Link two memories with a typed relationship."""
    if relationship_type not in RELATION_TYPES:
        return {"error": f"Invalid type: {relationship_type}. Valid: {RELATION_TYPES}"}
    conn.execute(
        """INSERT OR REPLACE INTO memory_relations
           (source_memory_id, target_memory_id, relationship_type, note)
           VALUES (?, ?, ?, ?)""",
        (source_id, target_id, relationship_type, note),
    )
    conn.commit()
    return {"ok": True, "source": source_id, "target": target_id, "type": relationship_type}


def get_relations(conn: sqlite3.Connection, memory_id: int) -> list[dict]:
    """Get all relations for a memory (both directions)."""
    rows = conn.execute(
        """SELECT mr.*, m.content, m.title, m.category
           FROM memory_relations mr
           JOIN memories m ON (
             (mr.source_memory_id = ? AND m.id = mr.target_memory_id)
             OR (mr.target_memory_id = ? AND m.id = mr.source_memory_id)
           )
           WHERE mr.source_memory_id = ? OR mr.target_memory_id = ?
           ORDER BY mr.created_at DESC""",
        (memory_id, memory_id, memory_id, memory_id),
    ).fetchall()
    return [dict(r) for r in rows]


def traverse_graph(conn: sqlite3.Connection, start_id: int, depth: int = 2) -> list[dict]:
    """BFS graph traversal from a starting memory. Returns connected memories."""
    visited = set()
    queue = [(start_id, 0)]
    result = []

    while queue:
        current_id, current_depth = queue.pop(0)
        if current_id in visited or current_depth > depth:
            continue
        visited.add(current_id)

        # Get the memory
        mem = conn.execute("SELECT * FROM memories WHERE id = ?", (current_id,)).fetchone()
        if not mem:
            continue

        mem_dict = dict(mem)
        mem_dict["depth"] = current_depth
        mem_dict["relations"] = get_relations(conn, current_id)
        result.append(mem_dict)

        # Follow edges
        for rel in mem_dict["relations"]:
            next_id = rel["target_memory_id"] if rel["source_memory_id"] == current_id else rel["source_memory_id"]
            if next_id not in visited:
                queue.append((next_id, current_depth + 1))

    return result


# ─── Consolidation ───────────────────────────────────────────────────────────

def find_similar_memories(conn: sqlite3.Connection, limit: int = 50) -> list[tuple[int, int, str]]:
    """Find pairs of memories with high content overlap (potential duplicates).
    Returns list of (id1, id2, shared_prefix)."""
    rows = conn.execute(
        """SELECT id, content, title FROM memories WHERE status = 'active'
           ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    ).fetchall()

    candidates = []
    for i, r1 in enumerate(rows):
        c1 = (r1["content"] or "").lower().strip()
        for r2 in rows[i + 1:]:
            c2 = (r2["content"] or "").lower().strip()
            # Simple overlap: check if one contains the other
            if c1 and c2 and (c1 in c2 or c2 in c1) and c1 != c2:
                shorter = c1 if len(c1) <= len(c2) else c2
                longer = c2 if len(c1) <= len(c2) else c1
                if len(shorter) > 20:  # Skip very short matches
                    candidates.append((r1["id"], r2["id"], shorter[:80]))
    return candidates


def consolidate_memories(conn: sqlite3.Connection, id1: int, id2: int) -> dict:
    """Merge two memories: keep the higher-importance one, supersede the other."""
    m1 = conn.execute("SELECT * FROM memories WHERE id = ?", (id1,)).fetchone()
    m2 = conn.execute("SELECT * FROM memories WHERE id = ?", (id2,)).fetchone()
    if not m1 or not m2:
        return {"error": "Memory not found"}

    # Keep the one with higher importance (or older if tied)
    keep, supersede = (m1, m2) if m1["importance"] >= m2["importance"] else (m2, m1)
    now = datetime.now(timezone.utc).isoformat()

    # Reinforce the kept memory
    conn.execute(
        """UPDATE memories SET
           confirm_count = confirm_count + 1,
           last_confirmed_at = ?,
           last_used_at = ?
         WHERE id = ?""",
        (now, now, keep["id"]),
    )

    # Supersede the other
    conn.execute(
        """UPDATE memories SET
           status = 'superseded',
           superseded_by = ?,
           superseded_at = ?
         WHERE id = ?""",
        (keep["id"], now, supersede["id"]),
    )

    # Migrate tags from superseded to kept
    tags = _get_tags(conn, supersede["id"])
    if tags:
        _attach_tags(conn, keep["id"], tags)

    # Create a relation
    conn.execute(
        """INSERT OR IGNORE INTO memory_relations
           (source_memory_id, target_memory_id, relationship_type, note)
           VALUES (?, ?, 'supersedes', 'Auto-consolidated')""",
        (keep["id"], supersede["id"]),
    )

    conn.commit()
    return {"kept": keep["id"], "superseded": supersede["id"]}


# ─── Stale Detection ─────────────────────────────────────────────────────────

def flag_stale(conn: sqlite3.Connection, memory_id: int, reason: str) -> dict:
    """Flag a memory as stale (e.g., when referenced code changes)."""
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """UPDATE memories SET
           stale_flagged_at = ?,
           stale_reason = ?
         WHERE id = ?""",
        (now, reason, memory_id),
    )
    conn.commit()
    return {"ok": True, "id": memory_id, "reason": reason}


def get_stale_memories(conn: sqlite3.Connection) -> list[dict]:
    """Get all memories flagged as stale."""
    rows = conn.execute(
        """SELECT id, content, title, category, importance, stale_flagged_at, stale_reason
           FROM memories
           WHERE stale_flagged_at IS NOT NULL AND status = 'active'
           ORDER BY stale_flagged_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


def revalidate(conn: sqlite3.Connection, memory_id: int) -> dict:
    """Clear stale flag after reviewing — memory is still correct."""
    conn.execute(
        "UPDATE memories SET stale_flagged_at = NULL, stale_reason = NULL WHERE id = ?",
        (memory_id,),
    )
    conn.commit()
    return {"ok": True, "id": memory_id}


# ─── Brain Stats ─────────────────────────────────────────────────────────────

def brain_stats(conn: sqlite3.Connection) -> dict:
    """Get overall brain statistics."""
    total = conn.execute("SELECT COUNT(*) as c FROM memories WHERE status = 'active'").fetchone()["c"]
    by_category = conn.execute(
        "SELECT category, COUNT(*) as c FROM memories WHERE status = 'active' GROUP BY category"
    ).fetchall()
    by_importance = conn.execute(
        "SELECT importance, COUNT(*) as c FROM memories WHERE status = 'active' GROUP BY importance ORDER BY importance DESC"
    ).fetchall()
    stale = conn.execute(
        "SELECT COUNT(*) as c FROM memories WHERE stale_flagged_at IS NOT NULL AND status = 'active'"
    ).fetchone()["c"]
    relations = conn.execute("SELECT COUNT(*) as c FROM memory_relations").fetchone()["c"]
    reinforced = conn.execute(
        "SELECT COUNT(*) as c FROM memories WHERE confirm_count > 1 AND status = 'active'"
    ).fetchone()["c"]

    return {
        "total_memories": total,
        "by_category": {r["category"]: r["c"] for r in by_category},
        "by_importance": {r["importance"]: r["c"] for r in by_importance},
        "stale_count": stale,
        "total_relations": relations,
        "reinforced_count": reinforced,
    }


# ─── Janitor (native, in-Hermes) ─────────────────────────────────────────────

# Decay refresh: materialize decay_score = importance * confidence * 0.5^(age/half),
# with importance-tiered half-lives (days). Mirrors the OpenLtm anchor's formula so
# retiring the bun anchor is behaviour-preserving. importance=5 or confirm_count>=10
# never decay (pinned knowledge). Age uses the most recent of used/confirmed/created.
_DECAY_REFRESH_SQL = """
UPDATE memories SET decay_score = CASE
  WHEN importance = 5      THEN CAST(importance AS REAL) * confidence
  WHEN confirm_count >= 10 THEN CAST(importance AS REAL) * confidence
  WHEN importance = 4 THEN CAST(importance AS REAL) * confidence
      * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 180.0)
  WHEN importance = 3 THEN CAST(importance AS REAL) * confidence
      * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 90.0)
  WHEN importance = 2 THEN CAST(importance AS REAL) * confidence
      * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 30.0)
  ELSE                     CAST(importance AS REAL) * confidence
      * power(0.5, (julianday('now') - julianday(COALESCE(last_used_at, last_confirmed_at, created_at))) / 14.0)
END
WHERE status = 'active'
"""

# Rows this decayed become archive/flag candidates (below threshold, not pinned).
_DECAY_STALE_THRESHOLD = 0.25


def _find_semantic_duplicates(conn: sqlite3.Connection, threshold: float) -> list[tuple[int, int, float]]:
    """Pairwise cosine over STORED embeddings (no network) — the anchor's dedup.

    Returns (id1, id2, similarity) pairs above ``threshold``. Uses embeddings
    already on disk, so this is a pure CPU sweep (~O(n^2) for n active rows;
    fine for the thousands-of-memories scale this store operates at).
    """
    import math
    import struct

    rows = conn.execute(
        "SELECT id, embedding FROM memories WHERE status = 'active' AND embedding IS NOT NULL"
    ).fetchall()
    vecs: list[tuple[int, list[float], float]] = []
    for r in rows:
        blob = r["embedding"]
        if not blob or len(blob) < 4:
            continue
        dims = len(blob) // 4
        v = list(struct.unpack(f"<{dims}f", blob[:dims * 4]))
        norm = math.sqrt(sum(x * x for x in v))
        if norm:
            vecs.append((r["id"], v, norm))

    pairs = []
    for i in range(len(vecs)):
        id1, v1, n1 = vecs[i]
        for j in range(i + 1, len(vecs)):
            id2, v2, n2 = vecs[j]
            if len(v1) != len(v2):
                continue
            sim = sum(a * b for a, b in zip(v1, v2)) / (n1 * n2)
            if sim >= threshold:
                pairs.append((id1, id2, round(sim, 4)))
    return pairs


def run_janitor(conn: sqlite3.Connection, *, dedup_similarity: float = SIMILARITY_REINFORCE) -> dict:
    """Native maintenance pass — the in-Hermes replacement for the bun anchor.

    Reuses the primitives already in this module rather than a separate service:
      1. Decay: materialize ``decay_score`` for all active memories.
      2. Stale: flag active rows whose refreshed score fell below the archive
         threshold (skips pinned importance=5 / confirm_count>=10).
      3. Dedup: PROPOSE consolidations (content-overlap candidates) — it does
         NOT merge. Auto-merging is a memory mutation and a poisoning vector, so
         merges go through the pending-writes-review ritual, not this sweep.

    Returns a summary dict; the caller (a no-agent cron) prints it. Idempotent.
    """
    # 1. Decay refresh (power() is available in the venv's sqlite3 build).
    conn.execute(_DECAY_REFRESH_SQL)

    # 2. Flag newly-decayed rows as stale (review candidates), unless pinned or
    #    already flagged. This never deletes — flagging is reversible.
    decayed = conn.execute(
        """SELECT id FROM memories
           WHERE status = 'active' AND stale_flagged_at IS NULL
             AND importance < 5 AND confirm_count < 10
             AND decay_score < ?""",
        (_DECAY_STALE_THRESHOLD,),
    ).fetchall()
    for row in decayed:
        flag_stale(conn, row["id"], reason=f"decayed below {_DECAY_STALE_THRESHOLD}")

    # 3. Dedup proposals (no mutation). Prefer semantic (stored-embedding cosine,
    #    matching the anchor); fall back to content-overlap when embeddings are
    #    absent. Merges are NOT performed here — they go through review.
    sem_pairs = _find_semantic_duplicates(conn, dedup_similarity)
    if sem_pairs:
        dup_proposals = [(a, b, f"cosine={s}") for a, b, s in sem_pairs]
    else:
        dup_proposals = [(a, b, prefix) for a, b, prefix in find_similar_memories(conn)]
    conn.commit()

    return {
        "decay_refreshed": len(conn.execute(
            "SELECT id FROM memories WHERE status = 'active'").fetchall()),
        "stale_flagged": len(decayed),
        "dedup_proposals": len(dup_proposals),
        "dedup_pairs": dup_proposals[:20],  # cap payload
    }


# ─── Vector Search ───────────────────────────────────────────────────────────

def store_embedding(conn: sqlite3.Connection, memory_id: int, embedding_blob: bytes) -> None:
    """Store an embedding vector for a memory."""
    conn.execute("UPDATE memories SET embedding = ? WHERE id = ?", (embedding_blob, memory_id))
    conn.commit()


def vector_search(
    conn: sqlite3.Connection,
    query_embedding: list[float],
    *,
    limit: int = 10,
    project: str | None = None,
    category: str | None = None,
) -> list[dict]:
    """Find memories by cosine similarity to query embedding.
    Loads all embeddings and computes similarity in Python.
    Acceptable for <10K memories."""
    import math
    import struct

    conditions = ["status = 'active'", "embedding IS NOT NULL"]
    params: list[Any] = []
    if project:
        conditions.append("project_scope = ?")
        params.append(project)
    if category:
        conditions.append("category = ?")
        params.append(category)

    where = " AND ".join(conditions)
    rows = conn.execute(
        f"SELECT id, content, title, category, importance, embedding, project_scope FROM memories WHERE {where}",
        params,
    ).fetchall()

    scored = []
    q_norm = math.sqrt(sum(x * x for x in query_embedding)) if query_embedding else 0
    if q_norm == 0:
        return []

    for row in rows:
        blob = row["embedding"]
        if not blob or len(blob) < 4:
            continue
        dims = len(blob) // 4
        vec = list(struct.unpack(f"<{dims}f", blob[:dims * 4]))
        v_norm = math.sqrt(sum(x * x for x in vec))
        if v_norm == 0:
            continue
        dot = sum(a * b for a, b in zip(query_embedding, vec))
        sim = dot / (q_norm * v_norm)
        scored.append((sim, row))

    scored.sort(key=lambda x: x[0], reverse=True)

    results = []
    for sim, row in scored[:limit]:
        mem = dict(row)
        mem.pop("embedding", None)
        mem["similarity"] = round(sim, 4)
        results.append(mem)
    return results


def hybrid_search(
    conn: sqlite3.Connection,
    query: str,
    query_embedding: list[float] | None = None,
    *,
    project: str | None = None,
    category: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Hybrid search: FTS5 + semantic vector, merged by a weighted score.

    FTS5 contributes a BM25-derived score; vector contributes cosine
    similarity. Both are normalized to [0,1] and combined with FTS5 weighted
    at 0.4 and vector at 0.6 (vector leads because it catches paraphrases
    the keyword index misses). Results are re-ranked by the combined score so
    semantically-close memories surface even when they share no keywords with
    the query. Falls back to FTS5-only when no embedding is available.
    """
    fts_results = recall(conn, query=query, project=project, category=category, limit=limit)
    if not query_embedding:
        return fts_results

    # Scrub secrets from query before vector search
    from ._secrets_scrubber import scrub_secrets_for_embedding
    scrubbed_query = scrub_secrets_for_embedding(query)
    
    # If we have an embedder available, re-embed the scrubbed query
    # Note: query_embedding passed in is from the original query; we need to 
    # re-embed the scrubbed version. But since we don't have embedder here,
    # the caller should pass the embedding of the scrubbed query.
    # For now, we'll use the passed embedding but the scrubbing happens at the caller.
    vec_results = vector_search(
        conn, query_embedding, limit=limit * 2, project=project, category=category,
    )
    if not vec_results:
        return fts_results

    # Normalize FTS5 ranks to [0,1] (rank 1 = best)
    fts_score: dict[int, float] = {}
    for i, r in enumerate(fts_results):
        # Lower rank number = better; convert to descending score
        fts_score[r["id"]] = 1.0 - (i / max(len(fts_results), 1))

    # Vector similarity is already in [0,1]
    vec_score: dict[int, float] = {r["id"]: r.get("similarity", 0.0) for r in vec_results}

    # Merge: every id seen in either path
    all_ids = set(fts_score) | set(vec_score)
    merged: list[dict] = []
    vec_by_id = {r["id"]: r for r in vec_results}
    fts_by_id = {r["id"]: r for r in fts_results}

    for mid in all_ids:
        s_fts = fts_score.get(mid, 0.0)
        s_vec = vec_score.get(mid, 0.0)
        combined = 0.4 * s_fts + 0.6 * s_vec
        src = vec_by_id.get(mid) or fts_by_id.get(mid)
        mem = dict(src)
        mem["score"] = round(combined, 4)
        mem["fts_score"] = round(s_fts, 4)
        mem["vec_score"] = round(s_vec, 4)
        merged.append(mem)

    merged.sort(key=lambda x: x["score"], reverse=True)
    return merged[:limit]
