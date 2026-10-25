// News pipeline: fetch feeds (in cron shards) → parse → enrich → de-duplicate → rank.
// Optional D1 archive (binding DB) persists items for historical search; inserts are
// idempotent (primary key = hash of canonical URL) so cron re-runs never duplicate.

import { FEEDS, fetchFeed, NO_HOTLINK_IMAGES } from '../adapters/sources.js';
import { parseFeed, dedupe, enrich, hashId, canonicalUrl } from '../../public/js/shared/news.js';
import { cached, log } from '../lib/core.js';

// Parsed items of one feed (headline, short excerpt, link, credited image).
async function fetchOne(f) {
  const xml = await fetchFeed(f);
  return parseFeed(xml).slice(0, 30).map((it) => ({
    ...it, source: f.source, feedId: f.id, lang: f.lang, official: !!f.official, topics: f.topics || [], tier: f.tier || 0, feedCountry: f.country || null,
    image: it.image && !NO_HOTLINK_IMAGES.test(new URL(it.image).host) ? it.image : null,
  }));
}

// enrich → de-duplicate → stable ids → rank.
async function finish(all) {
  const items = enrich(dedupe(all));
  for (const it of items) it.id = await hashId(canonicalUrl(it.url));
  items.sort((a, b) => b.score - a.score);
  return items;
}

// Fetches every feed in one invocation. Only used without D1 (local tools); with many feeds
// it exceeds the Workers per-invocation subrequest limit, so production uses feed shards.
export async function collect(env) {
  const results = await Promise.allSettled(FEEDS.map(fetchOne));
  const feedStatus = FEEDS.map((f, i) => ({ id: f.id, source: f.source, lang: f.lang, ok: results[i].status === 'fulfilled', count: results[i].value?.length ?? 0, error: results[i].reason?.message }));
  return { items: await finish(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))), feedStatus };
}

// ---- sharded refresh (cron) ----
// ≤12 feeds per run: at most 24 outbound requests even with one retry each, which leaves room
// for the whale-alert scan in the same minute under the 50-subrequest limit.
export const SHARD_SIZE = 12;
export const shardCount = () => Math.ceil(FEEDS.length / SHARD_SIZE);
export const shardFeeds = (n) => FEEDS.slice(n * SHARD_SIZE, (n + 1) * SHARD_SIZE);

export async function refreshShard(env, n) {
  const feeds = shardFeeds(n);
  const results = await Promise.allSettled(feeds.map(fetchOne));
  const now = new Date().toISOString();
  // A failed fetch keeps the previous items (marked not ok) instead of emptying the feed.
  const stmt = env.DB.prepare(`INSERT INTO feed_cache (feed_id, ok, count, error, items, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(feed_id) DO UPDATE SET ok = excluded.ok, error = excluded.error, fetched_at = excluded.fetched_at,
      count = CASE WHEN excluded.ok = 1 THEN excluded.count ELSE feed_cache.count END,
      items = CASE WHEN excluded.ok = 1 THEN excluded.items ELSE feed_cache.items END`);
  await env.DB.batch(feeds.map((f, i) => {
    const r = results[i];
    return r.status === 'fulfilled' ? stmt.bind(f.id, 1, r.value.length, null, JSON.stringify(r.value), now) : stmt.bind(f.id, 0, 0, String(r.reason?.message || 'failed').slice(0, 300), '[]', now);
  }));
  const items = await finish(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
  const stored = await archive(env, items);
  return { shard: n, feeds: feeds.length, ok: results.filter((r) => r.status === 'fulfilled').length, seen: items.length, ...stored };
}

// Builds the live news set from the per-feed cache (one D1 read, no outbound requests).
export async function collectFromCache(env) {
  const { results } = await env.DB.prepare('SELECT feed_id, ok, count, error, items, fetched_at FROM feed_cache').all();
  if (!results.length) return collect(env); // first deploy, before any shard has run
  const rows = Object.fromEntries(results.map((r) => [r.feed_id, r]));
  const known = new Set(FEEDS.map((f) => f.id));
  const all = results.filter((r) => known.has(r.feed_id)).flatMap((r) => JSON.parse(r.items || '[]'));
  const feedStatus = FEEDS.map((f) => {
    const r = rows[f.id];
    return { id: f.id, source: f.source, lang: f.lang, ok: !!r?.ok, count: r?.count ?? 0, error: r ? r.error : 'not fetched yet', fetchedAt: r?.fetched_at || null };
  });
  return { items: await finish(all), feedStatus };
}

export async function latest(env) {
  return cached(env, 'news:v4', 120, () => (env.DB ? collectFromCache(env) : collect(env)));
}

export function filterItems(items, { lang, category, asset, country, q, limit = 60, sort = 'relevance' }) {
  let out = items;
  if (lang && lang !== 'all') out = out.filter((i) => i.lang === lang);
  if (category) out = out.filter((i) => i.categories.includes(category));
  if (asset) out = out.filter((i) => i.assets.includes(asset));
  if (country) out = out.filter((i) => i.countries.includes(country));
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    out = out.filter((i) => terms.every((t) => `${i.title} ${i.excerpt} ${i.source}`.toLowerCase().includes(t)));
  }
  if (sort === 'time') out = [...out].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  return out.slice(0, Math.min(200, limit));
}

export async function archive(env, items) {
  if (!env.DB) return { stored: 0, skipped: 'D1 binding DB not configured' };
  // Existing rows are only rewritten to backfill a missing image (keeps D1 writes low).
  const stmt = env.DB.prepare(`INSERT INTO articles (id, url, title, excerpt, source, lang, published_at, categories, assets, countries, official, ingested_at, image)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(id) DO UPDATE SET image = excluded.image WHERE articles.image IS NULL AND excluded.image IS NOT NULL`);
  const now = new Date().toISOString();
  const batch = items.map((i) => stmt.bind(i.id, i.url, i.title, i.excerpt, i.source, i.lang, i.publishedAt, i.categories.join(','), i.assets.join(','), i.countries.join(','), i.official ? 1 : 0, now, i.image || null));
  let stored = 0;
  for (let k = 0; k < batch.length; k += 50) {
    const res = await env.DB.batch(batch.slice(k, k + 50));
    stored += res.reduce((a, r) => a + (r.meta?.changes || 0), 0);
  }
  log('info', 'news_archived', { stored, seen: items.length });
  return { stored };
}

export async function searchArchive(env, { q, lang, from, to, limit = 50, offset = 0 }) {
  if (!env.DB) return null;
  const where = [], args = [];
  if (q) { where.push('(title LIKE ? OR excerpt LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (lang && lang !== 'all') { where.push('lang = ?'); args.push(lang); }
  if (from) { where.push('published_at >= ?'); args.push(from); }
  if (to) { where.push('published_at <= ?'); args.push(to); }
  // Bounded query: hard cap on page size.
  const sql = `SELECT id, url, title, excerpt, source, lang, published_at AS publishedAt, categories, assets, countries FROM articles
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY published_at DESC LIMIT ? OFFSET ?`;
  args.push(Math.min(100, Number(limit) || 50), Math.max(0, Number(offset) || 0));
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results.map((r) => ({ ...r, categories: r.categories ? r.categories.split(',') : [], assets: r.assets ? r.assets.split(',') : [], countries: r.countries ? r.countries.split(',') : [] }));
}

const COLS = 'id, url, title, excerpt, source, lang, published_at AS publishedAt, categories, assets, countries, official, image';
const fromRow = (row) => ({ ...row, official: !!row.official, image: row.image || null, alsoReportedBy: [], categories: row.categories ? row.categories.split(',') : [], assets: row.assets ? row.assets.split(',') : [], countries: row.countries ? row.countries.split(',') : [] });

export async function getArchived(env, id) {
  const row = await env.DB.prepare(`SELECT ${COLS} FROM articles WHERE id = ?`).bind(id).first();
  return row ? fromRow(row) : null;
}

// Most recent archived items (server-rendered front/section pages read D1, not the feeds).
export async function recentArchived(env, { limit = 200, sinceHours = 72 } = {}) {
  if (!env.DB) return [];
  const since = new Date(Date.now() - sinceHours * 3600e3).toISOString();
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM articles WHERE published_at >= ? AND published_at <= ? ORDER BY published_at DESC LIMIT ?`)
    .bind(since, new Date(Date.now() + 3600e3).toISOString(), Math.min(500, limit)).all();
  return results.map(fromRow);
}
