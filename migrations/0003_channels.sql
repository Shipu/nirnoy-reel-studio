-- Connected social channels (a Facebook Page, an Instagram account, …). Tokens are AES-GCM
-- encrypted with the TOKEN_KEY Worker secret before they are stored.
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  token_enc TEXT NOT NULL,
  token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  error TEXT,
  connected_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, account_id)
);

-- Between the platform's OAuth callback and you ticking which accounts to add.
CREATE TABLE IF NOT EXISTS oauth_pending (
  state TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  data TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per reel × channel. A Workflow instance waits for scheduled_at, then posts.
CREATE TABLE IF NOT EXISTS publishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reel_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  caption TEXT NOT NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  remote_id TEXT,
  url TEXT,
  error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS publishes_reel ON publishes (reel_id);
CREATE INDEX IF NOT EXISTS publishes_status ON publishes (status);
