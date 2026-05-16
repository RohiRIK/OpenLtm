-- Migration 018: edge semantics — rationale note + base weight
-- Effective weight = base × decay, computed at read time (never stored).
-- Manual edges default to 1.0; LLM-inferred edges use confidence-derived weight.

ALTER TABLE memory_relations ADD COLUMN note   TEXT;
ALTER TABLE memory_relations ADD COLUMN weight REAL NOT NULL DEFAULT 1.0
  CHECK(weight BETWEEN 0.0 AND 1.0);
