-- VOID Report: AI-written original stories (one per article and language).
-- status 'rejected' rows record outputs that failed the anti-fabrication / anti-copy guards,
-- so they are not regenerated and still count toward the daily free-tier cap.
CREATE TABLE IF NOT EXISTS stories (
  id TEXT NOT NULL,
  lang TEXT NOT NULL,
  headline TEXT,
  paragraphs TEXT,              -- JSON array of strings
  sources TEXT NOT NULL,        -- JSON array of {source, url} used as facts
  model TEXT NOT NULL,
  status TEXT NOT NULL,         -- ok | rejected
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, lang)
);
CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at);
