-- Latest parsed items per publisher feed. The cron refreshes feeds in small shards (Workers
-- allow a limited number of outbound requests per invocation); page requests read this table
-- instead of fetching feeds themselves.
CREATE TABLE IF NOT EXISTS feed_cache (
  feed_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  items TEXT NOT NULL DEFAULT '[]',   -- JSON array of parsed items (headline, ≤240-char excerpt, link, image)
  fetched_at TEXT NOT NULL
);
