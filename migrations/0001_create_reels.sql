-- One row per reel downloaded from the studio, so "random" can skip
-- questions that already became a reel.
CREATE TABLE IF NOT EXISTS reels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  rendered_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS reels_question_id ON reels (question_id);
