-- Migration 004: Graph reasoning convenience view
-- Creates a view of conflicting memory pairs for quick inspection.
-- No new tables needed — all data already lives in memory_relations.

CREATE VIEW IF NOT EXISTS memory_conflict_pairs AS
  SELECT
    r.source_memory_id,
    r.target_memory_id,
    r.relationship_type,
    r.created_at,
    a.content AS source_content,
    b.content AS target_content,
    a.category AS source_category,
    b.category AS target_category
  FROM memory_relations r
  JOIN memories a ON a.id = r.source_memory_id
  JOIN memories b ON b.id = r.target_memory_id
  WHERE r.relationship_type IN ('contradicts', 'supersedes');
