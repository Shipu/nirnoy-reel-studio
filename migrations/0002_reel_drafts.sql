-- Reels become editable records: a draft is saved as you work, then
-- "rendered" (MP4 + thumbnail in R2), then "published" once it is posted.
-- Rows from 0001 were logged downloads, so they start out as "rendered".
ALTER TABLE reels ADD COLUMN status TEXT NOT NULL DEFAULT 'rendered';
-- First line of the question, for the list.
ALTER TABLE reels ADD COLUMN title TEXT;
-- Studio state as JSON: { props, voice: { segment: { file, sec, source } }, scripts }.
ALTER TABLE reels ADD COLUMN data TEXT;
ALTER TABLE reels ADD COLUMN created_by TEXT;
ALTER TABLE reels ADD COLUMN updated_by TEXT;
ALTER TABLE reels ADD COLUMN updated_at TEXT;
ALTER TABLE reels ADD COLUMN rendered_at TEXT;
-- Set when you mark a reel as posted (e.g. the YouTube link after a manual upload).
ALTER TABLE reels ADD COLUMN youtube_url TEXT;

-- Old rows have no saved video in R2, so rendered_at stays empty (the list only offers downloads when it is set).
UPDATE reels SET created_by = rendered_by, updated_at = created_at WHERE data IS NULL;

CREATE INDEX IF NOT EXISTS reels_status ON reels (status);
