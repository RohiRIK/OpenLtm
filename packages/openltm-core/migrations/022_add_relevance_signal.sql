-- Migration 022: personal relevance signal on memories
-- Lets a user mark a memory as "works for me" / "doesn't work for me".
-- Human-authored, like user_note — never touched by learn() or the janitor.
-- relevance_signal is one of 'works' | 'doesnt' (NULL = unrated).

ALTER TABLE memories ADD COLUMN relevance_signal TEXT;
ALTER TABLE memories ADD COLUMN relevance_signal_at TEXT;

-- DOWN
ALTER TABLE memories DROP COLUMN relevance_signal;
ALTER TABLE memories DROP COLUMN relevance_signal_at;
