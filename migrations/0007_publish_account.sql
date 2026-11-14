-- The platform account a post went to, so a channel removed and connected again (new channel id)
-- gets its old posts back — for analytics and retries.
ALTER TABLE publishes ADD COLUMN account_id TEXT;
UPDATE publishes SET account_id = (SELECT account_id FROM channels WHERE channels.id = publishes.channel_id) WHERE account_id IS NULL;
