-- Migration 021: manual_label flag on memory_clusters
-- When 1, the user has manually renamed this cluster.
-- The recompute logic preserves manual labels by matching via sorted node_ids hash.

ALTER TABLE memory_clusters ADD COLUMN manual_label INTEGER NOT NULL DEFAULT 0;
