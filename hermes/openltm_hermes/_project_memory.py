"""Reviewed, project-scoped OpenLTM memory.

This module is deliberately separate from the normal OpenLTM recall path.
A project fact first enters an auditable review ledger; only explicit approval
creates an active memory.  The strict context query joins both tables and
never considers global memories (`project_scope IS NULL`).
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import subprocess
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

CATEGORIES = frozenset({"preference", "architecture", "gotcha", "pattern", "workflow", "constraint"})
STATES = frozenset({"proposed", "approved", "rejected", "superseded", "expired"})
MAX_CONTENT_CHARS = 2_000
MAX_SOURCE_REFS = 20
MAX_PROJECT_CHARS = 200

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS project_memory_reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_scope    TEXT    NOT NULL,
  content          TEXT    NOT NULL,
  category         TEXT    NOT NULL CHECK(category IN (
                     'preference','architecture','gotcha','pattern','workflow','constraint')),
  importance       INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  source_refs_json TEXT    NOT NULL DEFAULT '[]',
  content_sha256   TEXT    NOT NULL,
  state            TEXT    NOT NULL DEFAULT 'proposed' CHECK(state IN (
                     'proposed','approved','rejected','superseded','expired')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at      TEXT,
  reviewer         TEXT,
  expires_at       TEXT,
  memory_id        INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  superseded_by    INTEGER REFERENCES project_memory_reviews(id) ON DELETE SET NULL,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_memory_reviews_project
  ON project_memory_reviews(project_scope);
CREATE INDEX IF NOT EXISTS idx_project_memory_reviews_state
  ON project_memory_reviews(state);
CREATE INDEX IF NOT EXISTS idx_project_memory_reviews_content
  ON project_memory_reviews(project_scope, content_sha256);
"""

_SECRET_MARKERS = re.compile(
    r"(?i)(?:api[_ -]?key|password|secret|access[_ -]?token|private[_ -]?key)\s*[:=]"
)
_TOKEN_PREFIX = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,})\b")
_SAFE_PROJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$")
_SCP_REMOTE = re.compile(r"^(?:[^@/:]+@)?(?P<host>[^:/]+):(?P<path>.+)$")


class ProjectMemoryError(ValueError):
    """Raised when a project-memory operation violates its safety contract."""


def init_project_memory_schema(conn: sqlite3.Connection) -> None:
    """Create the additive review ledger and indexes without touching memories."""
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_expiry(expires_at: str | None) -> str | None:
    if expires_at is None:
        return None
    value = expires_at.strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ProjectMemoryError("expires_at must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise ProjectMemoryError("expires_at must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def _validate_content(content: str) -> str:
    normalized = content.strip()
    if not normalized:
        raise ProjectMemoryError("content is required")
    if len(normalized) > MAX_CONTENT_CHARS:
        raise ProjectMemoryError(f"content exceeds {MAX_CONTENT_CHARS} characters")
    if "\x00" in normalized or _SECRET_MARKERS.search(normalized) or _TOKEN_PREFIX.search(normalized):
        raise ProjectMemoryError("content appears to contain a secret and cannot enter project memory")
    return normalized


def _validate_project_scope(project_scope: str) -> str:
    value = project_scope.strip()
    if not value or len(value) > MAX_PROJECT_CHARS or not _SAFE_PROJECT.fullmatch(value):
        raise ProjectMemoryError("project must be a bounded, relative identifier")
    if value.startswith("/") or ".." in value.split("/"):
        raise ProjectMemoryError("project must not contain an absolute or parent path")
    return value


def _validate_source_refs(source_refs: Iterable[str] | None) -> list[str]:
    refs = list(source_refs or [])
    if len(refs) > MAX_SOURCE_REFS:
        raise ProjectMemoryError(f"at most {MAX_SOURCE_REFS} source references are allowed")
    safe: list[str] = []
    for ref in refs:
        if not isinstance(ref, str):
            raise ProjectMemoryError("source references must be strings")
        value = ref.strip()
        if not value or len(value) > 300 or "\x00" in value:
            raise ProjectMemoryError("source reference is invalid")
        path_part = value.rsplit(":", 1)[0]
        if (
            value.startswith(("~", "/", "\\\\"))
            or re.match(r"^[A-Za-z]:[\\\\/]", value)
            or Path(path_part).is_absolute()
            or ".." in Path(path_part).parts
        ):
            raise ProjectMemoryError("source references must be repository-relative")
        safe.append(value)
    return sorted(set(safe))


def project_id_from_remote(remote: str) -> str:
    """Return a credential-free canonical ID from an HTTPS/SSH Git remote."""
    value = remote.strip()
    if not value:
        raise ProjectMemoryError("Git remote is empty")

    parsed = urlsplit(value)
    if parsed.scheme:
        if parsed.scheme not in {"http", "https", "ssh", "git"} or not parsed.hostname:
            raise ProjectMemoryError("Git remote is not a safe network remote")
        host = parsed.hostname.casefold()
        path = parsed.path.strip("/")
    else:
        match = _SCP_REMOTE.fullmatch(value)
        if not match:
            raise ProjectMemoryError("Git remote is not a safe network remote")
        host = match.group("host").casefold()
        path = match.group("path").strip("/")

    if not host or not path or "://" in path or "@" in host:
        raise ProjectMemoryError("Git remote is not a safe credential-free remote")
    path = path.removesuffix(".git")
    candidate = f"git/{host}/{path}"
    return _validate_project_scope(candidate)


def discover_project_scope(cwd: Path | None = None) -> str | None:
    """Resolve origin's normalized remote without persisting a local path."""
    directory = str(cwd or Path.cwd())
    try:
        completed = subprocess.run(
            ["git", "-C", directory, "config", "--get", "remote.origin.url"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    try:
        return project_id_from_remote(completed.stdout)
    except ProjectMemoryError:
        return None


def resolve_project_scope(explicit_project: str | None, cwd: Path | None = None) -> str:
    if explicit_project:
        return _validate_project_scope(explicit_project)
    discovered = discover_project_scope(cwd)
    if discovered:
        return discovered
    raise ProjectMemoryError("no safe Git remote found; pass --project with an explicit bounded identifier")


def _review_dict(row: sqlite3.Row, *, include_content: bool) -> dict[str, Any]:
    item = dict(row)
    source_json = item.pop("source_refs_json", "[]")
    try:
        item["source_refs"] = json.loads(source_json)
    except (TypeError, json.JSONDecodeError):
        item["source_refs"] = []
    if not include_content:
        item.pop("content", None)
    return item


def propose(
    conn: sqlite3.Connection,
    *,
    project_scope: str,
    content: str,
    category: str,
    importance: int = 3,
    source_refs: Iterable[str] | None = None,
    expires_at: str | None = None,
) -> dict[str, Any]:
    """Store a fact in the review ledger only; it is not searchable memory."""
    project = _validate_project_scope(project_scope)
    fact = _validate_content(content)
    if category not in CATEGORIES:
        raise ProjectMemoryError("category is invalid")
    if not isinstance(importance, int) or not 1 <= importance <= 5:
        raise ProjectMemoryError("importance must be an integer from 1 to 5")
    refs = _validate_source_refs(source_refs)
    expiry = _parse_expiry(expires_at)
    digest = hashlib.sha256(fact.encode("utf-8")).hexdigest()

    existing = conn.execute(
        """SELECT * FROM project_memory_reviews
           WHERE project_scope = ? AND content_sha256 = ?
             AND state IN ('proposed', 'approved')
           ORDER BY id DESC LIMIT 1""",
        (project, digest),
    ).fetchone()
    if existing:
        return {"action": "already_present", "review": _review_dict(existing, include_content=True)}

    cursor = conn.execute(
        """INSERT INTO project_memory_reviews
           (project_scope, content, category, importance, source_refs_json,
            content_sha256, state, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?)""",
        (project, fact, category, importance, json.dumps(refs, separators=(",", ":")), digest, expiry),
    )
    conn.commit()
    review_id = cursor.lastrowid
    if review_id is None:
        raise RuntimeError("SQLite did not return a review id")
    review = get_review(conn, int(review_id))
    return {"action": "proposed", "review": review}


def list_reviews(
    conn: sqlite3.Connection,
    *,
    project_scope: str,
    state: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    project = _validate_project_scope(project_scope)
    if state is not None and state not in STATES:
        raise ProjectMemoryError("state is invalid")
    if not 1 <= limit <= 200:
        raise ProjectMemoryError("limit must be between 1 and 200")
    where = ["project_scope = ?"]
    params: list[Any] = [project]
    if state:
        where.append("state = ?")
        params.append(state)
    params.append(limit)
    rows = conn.execute(
        f"""SELECT * FROM project_memory_reviews
            WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT ?""",
        params,
    ).fetchall()
    return [_review_dict(row, include_content=False) for row in rows]


def get_review(conn: sqlite3.Connection, review_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM project_memory_reviews WHERE id = ?", (review_id,)).fetchone()
    if not row:
        raise ProjectMemoryError(f"review {review_id} does not exist")
    return _review_dict(row, include_content=True)


def approve(conn: sqlite3.Connection, *, review_id: int, reviewer: str) -> dict[str, Any]:
    """Approve one proposal and create exactly one active scoped OpenLTM memory."""
    reviewer_name = reviewer.strip()
    if not reviewer_name or len(reviewer_name) > 100:
        raise ProjectMemoryError("reviewer is required and must be bounded")

    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT * FROM project_memory_reviews WHERE id = ?", (review_id,)).fetchone()
        if not row:
            raise ProjectMemoryError(f"review {review_id} does not exist")
        if row["state"] != "proposed":
            raise ProjectMemoryError("only proposed reviews may be approved")
        project = row["project_scope"]
        content = row["content"]
        dedup_key = hashlib.sha256(
            f"project-review\0{project}\0{row['content_sha256']}".encode()
        ).hexdigest()[:16]
        existing = conn.execute("SELECT id FROM memories WHERE dedup_key = ?", (dedup_key,)).fetchone()
        if existing:
            raise ProjectMemoryError("a reviewed project memory already exists for this proposal")

        now = _utc_now()
        cursor = conn.execute(
            """INSERT INTO memories
               (content, title, category, importance, dedup_key, project_scope,
                created_at, last_confirmed_at, last_used_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (content, f"Project fact: {project}", row["category"], row["importance"],
             dedup_key, project, now, now, now),
        )
        memory_row_id = cursor.lastrowid
        if memory_row_id is None:
            raise RuntimeError("SQLite did not return a memory id")
        memory_id = int(memory_row_id)
        conn.execute(
            """UPDATE project_memory_reviews
               SET state = 'approved', reviewed_at = ?, reviewer = ?, memory_id = ?
               WHERE id = ?""",
            (now, reviewer_name, memory_id, review_id),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"action": "approved", "review": get_review(conn, review_id)}


def reject(conn: sqlite3.Connection, *, review_id: int, reviewer: str, reason: str) -> dict[str, Any]:
    explanation = reason.strip()
    reviewer_name = reviewer.strip()
    if not explanation or len(explanation) > 500 or not reviewer_name or len(reviewer_name) > 100:
        raise ProjectMemoryError("reviewer and a bounded rejection reason are required")
    cursor = conn.execute(
        """UPDATE project_memory_reviews
           SET state = 'rejected', reviewed_at = ?, reviewer = ?, rejection_reason = ?
           WHERE id = ? AND state = 'proposed'""",
        (_utc_now(), reviewer_name, explanation, review_id),
    )
    if cursor.rowcount != 1:
        raise ProjectMemoryError("only proposed reviews may be rejected")
    conn.commit()
    return {"action": "rejected", "review": get_review(conn, review_id)}


def expire(conn: sqlite3.Connection, *, review_id: int, reviewer: str) -> dict[str, Any]:
    reviewer_name = reviewer.strip()
    if not reviewer_name or len(reviewer_name) > 100:
        raise ProjectMemoryError("reviewer is required and must be bounded")
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT * FROM project_memory_reviews WHERE id = ?", (review_id,)).fetchone()
        if not row or row["state"] != "approved" or row["memory_id"] is None:
            raise ProjectMemoryError("only approved reviews with an active memory may expire")
        now = _utc_now()
        conn.execute(
            """UPDATE project_memory_reviews
               SET state = 'expired', reviewed_at = ?, reviewer = ? WHERE id = ?""",
            (now, reviewer_name, review_id),
        )
        conn.execute("UPDATE memories SET status = 'deprecated' WHERE id = ?", (row["memory_id"],))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"action": "expired", "review": get_review(conn, review_id)}


def supersede(
    conn: sqlite3.Connection,
    *,
    old_review_id: int,
    new_review_id: int,
    reviewer: str,
) -> dict[str, Any]:
    reviewer_name = reviewer.strip()
    if old_review_id == new_review_id:
        raise ProjectMemoryError("a review cannot supersede itself")
    conn.execute("BEGIN IMMEDIATE")
    try:
        old = conn.execute("SELECT * FROM project_memory_reviews WHERE id = ?", (old_review_id,)).fetchone()
        new = conn.execute("SELECT * FROM project_memory_reviews WHERE id = ?", (new_review_id,)).fetchone()
        if not old or not new or old["project_scope"] != new["project_scope"]:
            raise ProjectMemoryError("reviews must exist in the same project")
        if old["state"] != "approved" or old["memory_id"] is None:
            raise ProjectMemoryError("the superseded review must be approved")
        if new["state"] != "approved" or new["memory_id"] is None:
            raise ProjectMemoryError("the replacement review must be approved first")
        now = _utc_now()
        conn.execute(
            """UPDATE project_memory_reviews
               SET state = 'superseded', superseded_by = ?, reviewed_at = ?, reviewer = ?
               WHERE id = ?""",
            (new_review_id, now, reviewer_name, old_review_id),
        )
        conn.execute(
            """UPDATE memories SET status = 'superseded', superseded_by = ?, superseded_at = ?
               WHERE id = ?""",
            (new["memory_id"], now, old["memory_id"]),
        )
        conn.execute(
            """INSERT OR IGNORE INTO memory_relations
               (source_memory_id, target_memory_id, relationship_type, created_at)
               VALUES (?, ?, 'supersedes', ?)""",
            (old["memory_id"], new["memory_id"], now),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"action": "superseded", "old_review": get_review(conn, old_review_id), "new_review": get_review(conn, new_review_id)}


def prune_expired(conn: sqlite3.Connection, *, project_scope: str, reviewer: str) -> dict[str, Any]:
    project = _validate_project_scope(project_scope)
    rows = conn.execute(
        """SELECT id FROM project_memory_reviews
           WHERE project_scope = ? AND state = 'approved'
             AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY id""",
        (project, _utc_now()),
    ).fetchall()
    expired = [expire(conn, review_id=int(row["id"]), reviewer=reviewer)["review"]["id"] for row in rows]
    return {"action": "pruned", "project_scope": project, "expired_review_ids": expired}


def strict_project_context(conn: sqlite3.Connection, *, project_scope: str, limit: int = 20) -> list[dict[str, Any]]:
    """Return active, approved facts for exactly one project and nothing global."""
    project = _validate_project_scope(project_scope)
    if not 1 <= limit <= 50:
        raise ProjectMemoryError("limit must be between 1 and 50")
    rows = conn.execute(
        """SELECT r.id AS review_id, r.content, r.category, r.importance, r.source_refs_json,
                  r.created_at, r.memory_id
           FROM project_memory_reviews r
           JOIN memories m ON m.id = r.memory_id
           WHERE r.project_scope = ?
             AND r.state = 'approved'
             AND (r.expires_at IS NULL OR r.expires_at > ?)
             AND m.status = 'active'
             AND m.project_scope = ?
           ORDER BY r.importance DESC, r.created_at DESC, r.id DESC
           LIMIT ?""",
        (project, _utc_now(), project, limit),
    ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["source_refs"] = json.loads(item.pop("source_refs_json"))
        except (TypeError, json.JSONDecodeError):
            item["source_refs"] = []
        items.append(item)
    return items


def format_strict_project_context(conn: sqlite3.Connection, *, project_scope: str, limit: int = 20) -> str:
    items = strict_project_context(conn, project_scope=project_scope, limit=limit)
    if not items:
        return ""
    lines = [f"## Reviewed Project Memory ({project_scope})"]
    for item in items:
        lines.append(f"- [{item['category']}] {item['content']}")
    return "\n".join(lines)
