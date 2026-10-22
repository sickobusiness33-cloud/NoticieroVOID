-- News archive: headline-level metadata only (no article bodies).
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,            -- sha256(canonical url), first 20 hex chars
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  source TEXT NOT NULL,
  lang TEXT NOT NULL,
  published_at TEXT,
  categories TEXT,
  assets TEXT,
  countries TEXT,
  official INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_lang_published ON articles(lang, published_at DESC);
