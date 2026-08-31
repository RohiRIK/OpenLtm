-- Migration 012: seed janitor run-tracking settings
-- INSERT OR IGNORE — safe on existing DBs.
-- Runner wraps this in a transaction — no BEGIN/COMMIT here.

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('ltm.janitor.lastRunAt',          '',  datetime('now')),
  ('ltm.janitor.lastDecayRefreshed', '0', datetime('now')),
  ('ltm.janitor.lastDeprecated',     '0', datetime('now')),
  ('ltm.janitor.lastArchived',       '0', datetime('now'));

-- DOWN (no-op: removing settings rows is safe, they'll just re-seed on next migration run)
