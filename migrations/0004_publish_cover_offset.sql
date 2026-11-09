-- Moment of the video (ms) Instagram should use as the Reel cover: the question with all
-- options on screen, which matches the studio thumbnail.
ALTER TABLE publishes ADD COLUMN cover_offset_ms INTEGER;
