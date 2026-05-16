-- Migration 016: per-view layout persistence
-- Positions are saved only when the user explicitly drags or pins a node.
-- 'view' = 'global' for the global graph, or a project name for drill-down.

CREATE TABLE IF NOT EXISTS memory_layout (
  memory_id  INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  view       TEXT    NOT NULL,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memory_id, view)
);

CREATE INDEX IF NOT EXISTS idx_layout_view ON memory_layout(view);
