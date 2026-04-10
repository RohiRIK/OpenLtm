-- Migration 007: workspace_id + agent_id for multi-agent memory isolation
-- UP
ALTER TABLE memories ADD COLUMN workspace_id TEXT;
ALTER TABLE memories ADD COLUMN agent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);

ALTER TABLE context_items ADD COLUMN workspace_id TEXT;
ALTER TABLE context_items ADD COLUMN agent_id TEXT;

-- DOWN
-- ALTER TABLE context_items DROP COLUMN agent_id;
-- ALTER TABLE context_items DROP COLUMN workspace_id;
-- DROP INDEX IF EXISTS idx_memories_agent;
-- DROP INDEX IF EXISTS idx_memories_workspace;
-- ALTER TABLE memories DROP COLUMN agent_id;
-- ALTER TABLE memories DROP COLUMN workspace_id;
