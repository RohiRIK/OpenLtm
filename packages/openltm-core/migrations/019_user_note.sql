-- Migration 019: human-authored annotation on memories
-- user_note is never overwritten by learn() re-confirmation or the janitor.
-- Kept separate from machine-written content.

ALTER TABLE memories ADD COLUMN user_note TEXT;
