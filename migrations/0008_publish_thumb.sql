-- Cover image link from the platform, for posts made outside the studio (no reel thumbnail here).
-- Platform CDN links expire, so it is refreshed whenever the account's posts are listed.
ALTER TABLE publishes ADD COLUMN thumb_url TEXT;
