-- Whale tracker, persistent alerts and calendar change-tracking.
-- Owners are anonymous: the browser keeps a random key and the server stores only its SHA-256.

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen TEXT,
  telegram_chat_id TEXT
);

CREATE TABLE IF NOT EXISTS watched_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, chain, address)
);
CREATE INDEX IF NOT EXISTS idx_watched_chain_address ON watched_wallets (chain, address);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  wallet_id INTEGER NOT NULL,
  type TEXT NOT NULL,            -- buy | sell | transfer_in | transfer_out | any_move | large_move | balance_pct | counterparty | exchange_flow | repeated
  token TEXT,                    -- contract / mint filter (null = any token)
  min_amount REAL,               -- token units
  min_usd REAL,
  pct REAL,                      -- balance change % (balance_pct)
  counterparty TEXT,             -- address (counterparty rule)
  window_min INTEGER,            -- repeated rule window
  min_count INTEGER,             -- repeated rule count
  channel TEXT NOT NULL DEFAULT 'inapp',   -- inapp | telegram
  cooldown_min INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_fired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rules_wallet ON alert_rules (wallet_id);
CREATE INDEX IF NOT EXISTS idx_rules_owner ON alert_rules (owner_id);

-- Shared per (chain, address): the last transaction processed by the cron scanner.
CREATE TABLE IF NOT EXISTS wallet_cursors (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  last_ref TEXT,                 -- last signature (Solana) or tx hash (EVM)
  last_ts TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  PRIMARY KEY (chain, address)
);

-- Classified on-chain movements (one row per wallet × tx × token leg). Idempotent id.
CREATE TABLE IF NOT EXISTS wallet_events (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,            -- buy | sell | transfer_in | transfer_out
  token TEXT,
  token_symbol TEXT,
  amount REAL,
  amount_usd REAL,
  balance_after REAL,
  counterparty TEXT,
  counterparty_label TEXT,
  status TEXT NOT NULL,          -- confirmed | failed
  method TEXT,
  explorer_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wevents_addr_ts ON wallet_events (chain, address, ts DESC);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL,
  wallet_event_id TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  delivered TEXT,
  UNIQUE (rule_id, wallet_event_id)
);
CREATE INDEX IF NOT EXISTS idx_alerts_owner ON alert_events (owner_id, fired_at DESC);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  token TEXT NOT NULL,
  ts TEXT NOT NULL,
  balance REAL NOT NULL,
  PRIMARY KEY (chain, address, token, ts)
);

-- Calendar events seen by the ingestion cron, to detect reschedules.
CREATE TABLE IF NOT EXISTS cal_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  time_utc TEXT,
  source TEXT,
  source_url TEXT,
  status TEXT,
  previous_date TEXT,
  first_seen TEXT NOT NULL,
  last_updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_date ON cal_events (date);
