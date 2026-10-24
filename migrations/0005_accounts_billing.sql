-- VOID PRO: accounts (Google sign-in), sessions, Stripe subscriptions and synced lists.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Only the SHA-256 hash of the session token is stored; the token lives in an HttpOnly cookie.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
-- One VOID PRO record per user, mirrored from Stripe (status values are Stripe's).
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,
  price_id TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  last_invoice_status TEXT,
  updated_at TEXT NOT NULL
);
-- Stripe webhook event ids already processed (deliveries are retried).
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
-- PRO: per-account synced lists (e.g. saved stories).
CREATE TABLE IF NOT EXISTS user_lists (
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
