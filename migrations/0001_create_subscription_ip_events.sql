CREATE TABLE IF NOT EXISTS subscription_ip_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  ip TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'HEAD')),
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599)
);

CREATE INDEX IF NOT EXISTS idx_subscription_ip_events_token_time
  ON subscription_ip_events (token_hash, requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_ip_events_requested_at
  ON subscription_ip_events (requested_at);
