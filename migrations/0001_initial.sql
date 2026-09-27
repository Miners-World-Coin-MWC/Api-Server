CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('earned','allocated','settled','adjustment')),
  amount_atomic TEXT NOT NULL,
  reference TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_pubkey ON ledger_entries(pubkey);
CREATE INDEX IF NOT EXISTS idx_ledger_kind ON ledger_entries(kind);

CREATE TABLE IF NOT EXISTS lock_watchers (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  redeem_script_hex TEXT NOT NULL,
  address TEXT NOT NULL,
  unlock_time INTEGER NOT NULL,
  lock_type TEXT NOT NULL CHECK(lock_type IN ('height','time')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pubkey, redeem_script_hex)
);

CREATE INDEX IF NOT EXISTS idx_lock_watchers_pubkey ON lock_watchers(pubkey);
CREATE INDEX IF NOT EXISTS idx_lock_watchers_address ON lock_watchers(address);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  details_json TEXT,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS health_events (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO settings(key, value, updated_at)
VALUES
  ('ledger_earned_atomic', '0', unixepoch()),
  ('ledger_allocated_atomic', '0', unixepoch()),
  ('ledger_settled_atomic', '0', unixepoch()),
  ('treasury_balance_atomic', '0', unixepoch()),
  ('min_lock_seconds', '0', unixepoch());
