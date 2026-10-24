-- Migration 030: memories.origin — where a memory's claim came from
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.
-- memory-versus-authority Phase 2: an owner statement, an agent observation and
-- a past approval must not read as the same thing. NULL = written before origin
-- tracking (unknown). New writes default to 'agent-observation' in learn().

ALTER TABLE memories ADD COLUMN origin TEXT CHECK(origin IS NULL OR origin IN (
  'owner-statement','agent-observation','external-source','proposal','historical-approval'));

-- The one origin the data proves: session-end extraction stores the agent's
-- reading of a session (memories.source = 'evaluate-session'). Everything else
-- stays unknown rather than guessed.
UPDATE memories SET origin = 'agent-observation'
 WHERE origin IS NULL AND source = 'evaluate-session';

-- DOWN
ALTER TABLE memories DROP COLUMN origin;
