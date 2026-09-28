"""OpenLTM Memory Provider for Hermes Agent.

Integrates OpenLTM (Long-Term Memory for AI coding agents) as a Hermes
memory provider. Uses direct SQLite access — no Bun, no MCP, no Docker.

Features:
- FTS5 full-text search for fast text recall
- Vector embeddings for semantic search (optional, provider-dependent)
- Memory categories: preference, architecture, gotcha, pattern, workflow, constraint
- Importance-weighted decay (1-4 fades, 5 = permanent)
- Project scoping and context items
- Graph relationships between memories
- Deduplication by content hash
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider

from .auto_capture import (
    evaluate_session as _evaluate_session,
)
from .auto_capture import (
    evaluate_turn as _evaluate_turn,
)

logger = logging.getLogger(__name__)

# Extraction policy (rules, guards, distillation) lives in .auto_capture so
# sync_turn() and on_session_end() cannot drift apart. This module only decides
# what to do with a returned decision.

# Lazy-import _db to avoid circular imports at module load time
_db_module = None


def _get_db():
    global _db_module
    if _db_module is None:
        try:
            from . import _db as _db_mod
        except ImportError:
            import plugins.memory.openltm._db as _db_mod
        _db_module = _db_mod
    return _db_module


class _ThreadLocalConnection:
    """Open one SQLite connection per calling thread.

    ``MemoryManager`` intentionally runs prefetch and turn sync off-thread,
    while tool calls can run on the foreground executor.  A provider-level
    SQLite connection therefore crosses thread boundaries.  This proxy keeps
    SQLite's thread guard enabled and gives every caller its own WAL connection
    instead of suppressing the guard with ``check_same_thread=False``.
    """

    def __init__(self, db_path: Path, connect):
        self._db_path = db_path
        self._connect = connect
        self._local = threading.local()

    def _connection(self):
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._connect(self._db_path)
            self._local.connection = connection
        return connection

    def __getattr__(self, name: str):
        return getattr(self._connection(), name)

    def close(self) -> None:
        connection = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None


# ─── Tool Schemas ────────────────────────────────────────────────────────────

RECALL_SCHEMA = {
    "name": "openltm_recall",
    "description": (
        "Search long-term memory by meaning (FTS5 text search). Returns memories "
        "ranked by relevance. Use before answering anything that may depend on "
        "prior context — preferences, decisions, gotchas, patterns. For multi-part "
        "questions, vary the wording and search multiple times."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Full-text search query."},
            "project": {"type": "string", "description": "Filter by project scope."},
            "category": {
                "type": "string",
                "enum": ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"],
                "description": "Filter by category.",
            },
            "limit": {"type": "integer", "description": "Max results (default 10)."},
        },
        "required": [],
    },
}

LEARN_SCHEMA = {
    "name": "openltm_learn",
    "description": (
        "Store a durable insight in long-term memory. Use after discovering "
        "non-obvious patterns, architectural decisions, or gotchas worth keeping "
        "across sessions. Skip facts derivable from code or git history."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "The insight to store."},
            "title": {"type": "string", "description": "Short label (≤60 chars)."},
            "category": {
                "type": "string",
                "enum": ["preference", "architecture", "gotcha", "pattern", "workflow", "constraint"],
                "description": "Category (auto-detected if omitted).",
            },
            "importance": {
                "type": "integer",
                "enum": [1, 2, 3, 4, 5],
                "description": "Importance 1-5 (default 3, 5=never decays).",
            },
            "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags."},
            "project": {"type": "string", "description": "Project scope."},
        },
        "required": ["content"],
    },
}

FORGET_SCHEMA = {
    "name": "openltm_forget",
    "description": "Delete a memory by ID when it is wrong, outdated, or the user requests removal.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "Memory ID to delete."},
            "reason": {"type": "string", "description": "Why this memory is being removed."},
        },
        "required": ["id"],
    },
}

CONTEXT_SCHEMA = {
    "name": "openltm_context",
    "description": (
        "Get project context: goals, decisions, progress, and gotchas. "
        "Use at session start or when switching projects."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "project": {"type": "string", "description": "Project name."},
        },
        "required": ["project"],
    },
}

RELATE_SCHEMA = {
    "name": "openltm_relate",
    "description": (
        "Link two memories with a typed relationship when they connect — "
        "e.g. a decision caused a gotcha, or a pattern applies to an architecture."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "source_id": {"type": "integer", "description": "Source memory ID."},
            "target_id": {"type": "integer", "description": "Target memory ID."},
            "relationship_type": {
                "type": "string",
                "enum": ["supports", "contradicts", "refines", "depends_on", "related_to", "supersedes"],
                "description": "Type of relationship.",
            },
        },
        "required": ["source_id", "target_id", "relationship_type"],
    },
}

GRAPH_SCHEMA = {
    "name": "openltm_graph",
    "description": (
        "Traverse the memory graph from a starting memory. "
        "Returns connected memories and their relationships."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "memory_id": {"type": "integer", "description": "Starting memory ID."},
            "depth": {"type": "integer", "description": "Traversal depth (default 2, max 4)."},
        },
        "required": ["memory_id"],
    },
}

BRAIN_STATS_SCHEMA = {
    "name": "openltm_brain_stats",
    "description": "Get brain statistics: total memories, categories, importance distribution, relations, stale count.",
    "parameters": {"type": "object", "properties": {}},
}

STALE_SCHEMA = {
    "name": "openltm_stale",
    "description": "List memories flagged as stale, or flag/revalidate a memory.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "flag", "revalidate"],
                "description": "Action: list stale, flag as stale, or clear stale flag.",
            },
            "memory_id": {"type": "integer", "description": "Memory ID (for flag/revalidate)."},
            "reason": {"type": "string", "description": "Why it's stale (for flag)."},
        },
        "required": ["action"],
    },
}


# ─── Provider ────────────────────────────────────────────────────────────────

def _load_config(hermes_home: str) -> Dict[str, Any]:
    """Read openltm.json ({} when missing or unreadable)."""
    try:
        return json.loads((Path(hermes_home) / "openltm.json").read_text())
    except Exception:
        return {}


class OpenLtmpMemoryProvider(MemoryProvider):
    """OpenLTM memory provider — local SQLite with FTS5 + vector search."""

    def __init__(self):
        # The concrete object is a thread-local connection proxy.  It supports
        # sqlite's connection API but is intentionally dynamic at runtime.
        self._conn: Any = None
        self._db_path = None
        self._project_scope: str | None = None
        self._user_id = "hermes-user"
        self._session_id = ""
        self._prefetch_query = ""
        self._prefetch_result = ""
        self._prefetch_done = False
        self._prefetch_thread: threading.Thread | None = None
        self._prefetch_lock = threading.Lock()
        self._atexit_registered = False
        self._embedder = None  # Lazy-loaded embedding provider

    @property
    def name(self) -> str:
        return "openltm"

    def is_available(self) -> bool:
        """Check if OpenLTM database exists and is accessible."""
        from hermes_constants import get_hermes_home
        db_path = get_hermes_home() / "openltm.db"
        # Also check legacy locations
        legacy_paths = [
            Path.home() / ".openltm" / "openltm.db",
            Path.home() / "openltm.db",
        ]
        for p in [db_path] + legacy_paths:
            if p.exists() and os.access(str(p), os.R_OK | os.W_OK):
                return True
        # Database doesn't yet exist — we can create it
        return True

    def initialize(self, session_id: str, **kwargs) -> None:
        """Open database connection and initialize schema."""
        db_mod = _get_db()

        from hermes_constants import get_hermes_home
        hermes_home = kwargs.get("hermes_home", str(get_hermes_home()))
        self._db_path = db_mod.get_db_path(hermes_home)
        self._session_id = session_id
        self._user_id = kwargs.get("user_id", "hermes-user")

        # Create database if it doesn't exist.  Every later caller receives a
        # connection local to its own thread; see _ThreadLocalConnection.
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = _ThreadLocalConnection(self._db_path, db_mod.connect)
        db_mod.init_schema(self._conn)
        try:
            from . import _project_memory
            _project_memory.init_project_memory_schema(self._conn)
            self._project_scope = _project_memory.discover_project_scope(Path.cwd())
        except Exception as e:
            self._project_scope = None
            logger.warning("OpenLTM project-memory initialization failed: %s", e)

        # Load the embedding provider selected in openltm.json (default: local Ollama)
        try:
            from ._providers import detect_provider
            self._embedder = detect_provider(_load_config(hermes_home).get("embedder") or "ollama")
        except Exception as e:
            logger.debug("Embedding provider not available: %s", e)

        logger.info("OpenLTM initialized: %s (user=%s, embedder=%s)",
                     self._db_path, self._user_id,
                     self._embedder.name if self._embedder else "none")

    def system_prompt_block(self) -> str:
        """Static context for the system prompt."""
        if not self._conn:
            return ""
        db_mod = _get_db()
        # Count active memories
        row = self._conn.execute(
            "SELECT COUNT(*) as cnt FROM memories WHERE status = 'active'"
        ).fetchone()
        count = row["cnt"] if row else 0
        static_block = (
            "# OpenLTM Memory\n"
            f"Active. Local SQLite with FTS5 full-text search. User: {self._user_id}.\n"
            f"Memories stored: {count}.\n"
            "You have persistent long-term memory from past conversations.\n"
            "Call openltm_recall before answering anything that may depend on prior context "
            "(preferences, decisions, gotchas, patterns).\n"
            "Call openltm_learn after discovering patterns worth keeping across sessions.\n"
            "Categories: preference | architecture | gotcha | pattern | workflow | constraint.\n"
            "Importance 5 = never decays; 1-4 fade over time.\n"
            "Tools: openltm_recall to search, openltm_learn to store, "
            "openltm_forget to delete, openltm_context for project context."
        )
        if not self._project_scope:
            return static_block
        try:
            from . import _project_memory
            reviewed_context = _project_memory.format_strict_project_context(
                self._conn, project_scope=self._project_scope
            )
        except Exception as e:
            logger.debug("OpenLTM strict project context failed: %s", e)
            reviewed_context = ""
        return "\n\n".join(part for part in (static_block, reviewed_context) if part)

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Recall relevant memories for the current turn.

        Uses hybrid_search (FTS5 + semantic vector) when an embedder is
        available, falling back to FTS5-only recall otherwise. Semantic
        matching catches paraphrases the keyword index would miss.
        """
        if not self._conn or not query:
            return ""
        db_mod = _get_db()
        try:
            query_embedding = None
            if self._embedder:
                try:
                    # Scrub secrets before embedding the query
                    from ._secrets_scrubber import scrub_secrets_for_embedding
                    scrubbed_query = scrub_secrets_for_embedding(query)
                    query_embedding = self._embedder.embed(scrubbed_query)
                except Exception as e:
                    logger.debug("OpenLTM prefetch embed failed: %s", e)
            if query_embedding:
                results = db_mod.hybrid_search(
                    self._conn, query, query_embedding, limit=8
                )
            else:
                results = db_mod.recall(self._conn, query=query, limit=8)
            if not results:
                return ""
            lines = []
            for r in results:
                title = r.get("title") or r.get("content", "")[:60]
                cat = r.get("category", "")
                lines.append(f"- [{cat}] {title}")
            return "## OpenLTM Recall\n" + "\n".join(lines)
        except Exception as e:
            logger.debug("OpenLTM prefetch failed: %s", e)
            return ""

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Extract key facts from a completed turn and store them.

        Detects four fact classes from the USER message (corrections,
        preferences, constraints, decisions) AND agent-discovered facts from
        the ASSISTANT message (findings, config, fixes). Stores a distilled
        declarative fact, not the raw message text, so the memory is
        self-contained and retrievable on its own.

        Distillation rule: strip the matched trigger phrase and keep the rest
        of the sentence. A fact like "Don't use npm, use bun" becomes
        "Use bun, not npm" — readable without surrounding context.
        """
        if not self._conn:
            return

        # Policy lives in .auto_capture: guards, ordered rules, and distillation
        # are shared with on_session_end so the two paths cannot diverge.
        try:
            decision = _evaluate_turn(user_content or "", assistant_content or "")
            if decision is None:
                return

            db_mod = _get_db()
            db_mod.learn(
                self._conn,
                decision.content,
                category=decision.category,
                importance=decision.importance,
                embedder=self._embedder,
            )
        except Exception as e:
            logger.debug("OpenLTM sync_turn extraction failed: %s", e)

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Return all OpenLTM tools."""
        return [
            RECALL_SCHEMA, LEARN_SCHEMA, FORGET_SCHEMA, CONTEXT_SCHEMA,
            RELATE_SCHEMA, GRAPH_SCHEMA, BRAIN_STATS_SCHEMA, STALE_SCHEMA,
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        """Dispatch tool calls to the appropriate database operation."""
        if not self._conn:
            return json.dumps({"error": "OpenLTM not initialized"})

        db_mod = _get_db()

        try:
            if tool_name == "openltm_recall":
                # Use hybrid search if embeddings available, else FTS5 only
                query_embedding = None
                if self._embedder and args.get("query"):
                    try:
                        # Scrub secrets before embedding the query
                        from ._secrets_scrubber import scrub_secrets_for_embedding
                        scrubbed_query = scrub_secrets_for_embedding(args["query"])
                        query_embedding = self._embedder.embed(scrubbed_query)
                    except Exception:
                        pass

                if query_embedding:
                    results = db_mod.hybrid_search(
                        self._conn,
                        args.get("query", ""),
                        query_embedding,
                        project=args.get("project"),
                        category=args.get("category"),
                        limit=args.get("limit", 10),
                    )
                else:
                    results = db_mod.recall(
                        self._conn,
                        query=args.get("query"),
                        project=args.get("project"),
                        category=args.get("category"),
                        limit=args.get("limit", 10),
                    )
                # Compact output
                compact = []
                for r in results:
                    compact.append({
                        "id": r["id"],
                        "content": r["content"][:300],
                        "category": r["category"],
                        "importance": r["importance"],
                        "tags": r.get("tags", []),
                        "project_scope": r.get("project_scope"),
                    })
                return json.dumps(compact)

            elif tool_name == "openltm_learn":
                result = db_mod.learn(
                    self._conn,
                    args["content"],
                    title=args.get("title"),
                    category=args.get("category", "pattern"),
                    importance=args.get("importance", 3),
                    tags=args.get("tags"),
                    project=args.get("project"),
                    embedder=self._embedder,
                )
                # Compute embedding in background if provider available
                if self._embedder and result.get("action") == "created":
                    try:
                        vec = self._embedder.embed(args["content"])
                        if vec:
                            from ._providers import embedding_to_blob
                            db_mod.store_embedding(self._conn, result["id"], embedding_to_blob(vec))
                    except Exception as e:
                        logger.debug("Embedding computation failed: %s", e)
                return json.dumps(result)

            elif tool_name == "openltm_forget":
                result = db_mod.forget(
                    self._conn,
                    args["id"],
                    reason=args.get("reason"),
                )
                return json.dumps(result)

            elif tool_name == "openltm_context":
                result = db_mod.get_context(self._conn, args["project"])
                # Preserve legacy context_items while exposing the strict review
                # ledger separately.  The strict query joins approved records to
                # active, same-project memories, so global memory cannot bleed in.
                from . import _project_memory
                result["reviewed_project_memory"] = _project_memory.strict_project_context(
                    self._conn, project_scope=args["project"]
                )
                return json.dumps(result)

            elif tool_name == "openltm_relate":
                result = db_mod.relate(
                    self._conn,
                    args["source_id"],
                    args["target_id"],
                    args["relationship_type"],
                )
                return json.dumps(result)

            elif tool_name == "openltm_graph":
                depth = min(args.get("depth", 2), 4)
                results = db_mod.traverse_graph(self._conn, args["memory_id"], depth)
                # Compact output
                compact = []
                for r in results:
                    compact.append({
                        "id": r["id"],
                        "content": r["content"][:200],
                        "category": r["category"],
                        "depth": r["depth"],
                        "relations": [{"type": rel["relationship_type"], "target": rel["target_memory_id"] if rel["source_memory_id"] == r["id"] else rel["source_memory_id"]} for rel in r.get("relations", [])],
                    })
                return json.dumps(compact)

            elif tool_name == "openltm_brain_stats":
                result = db_mod.brain_stats(self._conn)
                return json.dumps(result)

            elif tool_name == "openltm_stale":
                action = args["action"]
                if action == "list":
                    results = db_mod.get_stale_memories(self._conn)
                    return json.dumps(results)
                elif action == "flag":
                    result = db_mod.flag_stale(self._conn, args["memory_id"], args.get("reason", ""))
                    return json.dumps(result)
                elif action == "revalidate":
                    result = db_mod.revalidate(self._conn, args["memory_id"])
                    return json.dumps(result)
                else:
                    return json.dumps({"error": f"Unknown stale action: {action}"})

            else:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})

        except Exception as e:
            logger.error("OpenLTM tool call failed (%s): %s", tool_name, e)
            return json.dumps({"error": str(e)})

    def shutdown(self) -> None:
        """Close database connection."""
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Store session-level facts from the whole conversation.

        Uses the same rules, guards, and distillation as `sync_turn` (see
        `.auto_capture`), so a fact captured here is classified and phrased
        identically to one captured per-turn. Conservative: at most
        `SESSION_MAX_EXTRACT` facts, and a correction only counts when the agent
        had just spoken.
        """
        if not self._conn or not messages:
            return

        try:
            decisions = _evaluate_session(messages)
            if not decisions:
                return

            db_mod = _get_db()
            for decision in decisions:
                try:
                    db_mod.learn(
                        self._conn,
                        decision.content,
                        category=decision.category,
                        importance=decision.importance,
                    )
                except Exception as e:
                    logger.debug("OpenLTM session-end learn failed: %s", e)
        except Exception as e:
            logger.debug("OpenLTM session-end extraction failed: %s", e)

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror built-in memory writes to OpenLTM."""
        if not self._conn or action != "add":
            return

        db_mod = _get_db()
        try:
            category = "preference" if target == "user" else "pattern"
            db_mod.learn(
                self._conn,
                content,
                category=category,
                importance=3,
            )
        except Exception as e:
            logger.debug("OpenLTM on_memory_write failed: %s", e)

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        """Per-turn hook — no-op for now."""
        pass

    def on_session_switch(self, new_session_id: str, **kwargs) -> None:
        """Update session ID on switch."""
        self._session_id = new_session_id

    def get_config_schema(self) -> List[Dict[str, Any]]:
        """Config fields for hermes memory setup."""
        return [
            {
                "key": "user_id",
                "description": "User identifier for memory scoping",
                "default": "hermes-user",
            },
            {
                "key": "embedder",
                "description": "Embedding backend for vector search (gemini/openai send memory text to that API)",
                "default": "ollama",
                "choices": ["ollama", "gemini", "openai", "none"],
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        """Save config to openltm.json."""
        config_path = Path(hermes_home) / "openltm.json"
        existing = _load_config(hermes_home)
        existing.update(values)
        config_path.write_text(json.dumps(existing, indent=2))

    def backup_paths(self) -> List[str]:
        """Return paths to include in hermes backup."""
        if self._db_path and self._db_path.exists():
            return [str(self._db_path)]
        return []


def register(ctx) -> None:
    """Register OpenLTM as a Hermes memory provider."""
    ctx.register_memory_provider(OpenLtmpMemoryProvider())
