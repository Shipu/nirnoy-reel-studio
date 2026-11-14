-- Analytics: one row per fetch of a published post's numbers (history kept, so growth can be shown).
CREATE TABLE IF NOT EXISTS post_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publish_id INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  views INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  avg_watch_ms INTEGER,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS post_stats_publish ON post_stats (publish_id, fetched_at);

-- When the numbers were last fetched for a post, and why the last fetch failed (if it did).
ALTER TABLE publishes ADD COLUMN stats_at TEXT;
ALTER TABLE publishes ADD COLUMN stats_error TEXT;
