// Noticiero VOID / VOID TERMINAL — Cloudflare Worker entry point.
// Serves the static SPA (Workers Static Assets, binding ASSETS) and the JSON API.

import { json, apiError, cached, meta, rateLimit, healthSnapshot, log } from './lib/core.js';
import { CATALOG } from './adapters/fred.js';
import * as crypto from './adapters/crypto.js';
import * as news from './services/news.js';
import * as macro from './services/macro.js';
import { calendar } from './services/calendar.js';
import { memeState } from './services/meme.js';
import { liquidityLab } from './services/liquidity.js';
import * as ai from './services/ai.js';
import { universe } from './services/assets.js';
import { scanner } from './services/memescan.js';
import * as lab from './services/lab.js';
import * as alerts from './services/alerts.js';
import * as cal2 from './services/calendar2.js';
import { officialText } from './services/official.js';
import { story, pregenerate } from './services/story.js';
import { crawlFile, renderPage, siteUrl } from './services/site.js';
import { impactFor } from '../public/js/shared/impact.js';
import { SECTIONS, inSection } from '../public/js/shared/seo.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9-]{2,60}$/;

// Ad network and data provider domains are allowed explicitly; everything else is 'self'.
// Ad networks (Coinzilla, Monetag) load creatives from rotating domains, so scripts, frames
// and connections allow any HTTPS origin; everything else stays restricted.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "frame-src https:",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https:",
  "worker-src 'self'",
  "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

const LANGS = new Set(['en', 'es', 'all']);

function q(url, name, fallback = null) { const v = url.searchParams.get(name); return v === null || v === '' ? fallback : v; }

async function readJson(request, maxBytes = 16_384) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

function requireAdmin(request, env) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN) throw Object.assign(new Error('ADMIN_TOKEN secret is not configured'), { status: 503 });
  if (!tok || tok.length !== env.ADMIN_TOKEN.length || !timingSafeEqual(tok, env.ADMIN_TOKEN)) throw Object.assign(new Error('Unauthorized'), { status: 401 });
}
function timingSafeEqual(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

const routes = {
  'GET /api/config': async (req, env) => json({
    name: 'Noticiero VOID', product: 'VOID TERMINAL',
    ai: ai.aiEnabled(env), fredKey: !!env.FRED_API_KEY, archive: !!env.DB,
    coinzilla: {
      // Zone IDs are public by design (they are embedded in page HTML).
      leaderboard: env.COINZILLA_ZONE_LEADERBOARD || null, // 728x90
      rectangle: env.COINZILLA_ZONE_RECTANGLE || null, // 300x250
      mobile: env.COINZILLA_ZONE_MOBILE || null, // 320x100
      sticky: env.COINZILLA_STICKY_ZONE || null,
    },
  }, 200, { 'cache-control': 'public, max-age=300' }),

  'GET /api/health': async (req, env) => json({ providers: healthSnapshot(), bindings: { kv: !!env.CACHE, d1: !!env.DB, ai: ai.aiEnabled(env), fredKey: !!env.FRED_API_KEY }, now: new Date().toISOString() }),

  'GET /api/markets/overview': async (req, env) => {
    const [mk, gl, gold] = await Promise.allSettled([
      crypto.sharedMarkets(env),
      cached(env, 'cg:global', 300, () => crypto.globalStats(env)),
      cached(env, 'cg:paxg', 600, () => crypto.markets(env, 'pax-gold')),
    ]);
    const tradfiIds = ['SP500', 'NASDAQCOM', 'DJIA', 'VIXCLS', 'DGS2', 'DGS10', 'T10Y2Y', 'DFII10', 'DTWEXBGS', 'DCOILWTICO', 'DFF', 'ECBDFR', 'BAMLH0A0HYM2'];
    const lang = q(new URL(req.url), 'lang', 'en');
    const tradfi = await Promise.allSettled(tradfiIds.map((id) => macro.indicator(env, id, lang)));
    const crypt = mk.status === 'fulfilled' ? mk.value : null;
    const paxg = (mk.status === 'fulfilled' && mk.value.value.find((c) => c.id === 'pax-gold')) || (gold.status === 'fulfilled' ? gold.value.value.find((c) => c.id === 'pax-gold') : null);
    return json({
      crypto: crypt ? { rows: crypto.withoutSparkline(crypt.value).slice(0, 50), meta: meta({ source: crypt.value[0]?.provider || 'CoinGecko', sourceUrl: crypt.value[0]?.provider === 'CoinPaprika' ? 'https://coinpaprika.com' : 'https://www.coingecko.com', status: 'delayed', frequency: crypt.value[0]?.provider === 'CoinPaprika' ? '~5–15 min' : '~1–2 min', unit: 'USD', cachedAt: crypt.cachedAt, stale: crypt.stale, note: crypt.value[0]?.provider === 'CoinPaprika' ? 'CoinGecko unavailable; prices from CoinPaprika (fallback).' : 'Aggregated spot prices; cached up to 2 minutes.' }) } : { rows: [], meta: { status: 'unavailable', error: mk.reason?.message } },
      global: gl.status === 'fulfilled' ? { ...gl.value.value, meta: meta({ source: gl.value.value.provider || 'CoinGecko', sourceUrl: gl.value.value.provider ? 'https://coinpaprika.com' : 'https://www.coingecko.com/en/global-charts', status: 'delayed', unit: 'USD', cachedAt: gl.value.cachedAt, stale: gl.value.stale }) } : { meta: { status: 'unavailable', error: gl.reason?.message } },
      tradfi: tradfi.map((r, i) => (r.status === 'fulfilled' ? r.value : { id: tradfiIds[i], meta: { status: 'unavailable', error: r.reason?.message } })),
      goldProxy: paxg ? { price: paxg.price, change24h: paxg.change24h, meta: { status: 'estimated', source: 'CoinGecko (PAX Gold token)', note: 'PAXG is a gold-backed token used as a proxy. It is NOT the LBMA/COMEX spot price and can deviate from it.' } } : { meta: { status: 'unavailable', note: 'No free official real-time gold price source is integrated.' } },
    });
  },

  'GET /api/markets/history': async (req, env) => {
    const url = new URL(req.url);
    const id = q(url, 'asset', 'bitcoin');
    const days = Math.min(3650, Math.max(7, Number(q(url, 'days', 365)) || 365));
    if (!ID_RE.test(id)) return apiError(400, 'bad_asset', 'Invalid asset id');
    const r = await cached(env, `cg:hist:${id}:${days}`, 6 * 3600, () => crypto.history(env, id, days));
    return json({ points: r.value, meta: meta({ source: 'CoinGecko', sourceUrl: `https://www.coingecko.com/en/coins/${id}`, status: 'historical', frequency: 'daily (00:00 UTC)', unit: 'USD', cachedAt: r.cachedAt, stale: r.stale, note: env.COINGECKO_PLAN === 'pro' ? null : 'Free CoinGecko API: last 365 days only.' }) });
  },

  'GET /api/macro/catalog': async () => json({ series: Object.entries(CATALOG).map(([id, c]) => ({ id, ...c })) }, 200, { 'cache-control': 'public, max-age=3600' }),

  'GET /api/macro/series': async (req, env) => {
    const url = new URL(req.url);
    const id = q(url, 'id');
    const start = q(url, 'start', '2015-01-01');
    if (!id || !CATALOG[id]) return apiError(400, 'bad_series', 'Unknown or missing series id', { allowed: Object.keys(CATALOG) });
    if (!DATE_RE.test(start)) return apiError(400, 'bad_date', 'start must be YYYY-MM-DD');
    const s = await macro.series(env, id, start);
    const t = macro.transformPoints(s.points, q(url, 'transform', s.catalog.transform || 'none'));
    return json({ id, points: t.points, catalog: s.catalog, meta: meta({ source: 'FRED, Federal Reserve Bank of St. Louis', sourceUrl: `https://fred.stlouisfed.org/series/${id}`, status: 'historical', frequency: s.catalog.freq, unit: t.unit || s.catalog.unit, cachedAt: s.cachedAt, stale: s.stale }) });
  },

  'GET /api/macro/indicators': async (req, env) => {
    const url = new URL(req.url);
    const lang = q(url, 'lang', 'en');
    const group = q(url, 'group');
    const ids = Object.entries(CATALOG).filter(([, c]) => !group || c.group === group).map(([id]) => id);
    const r = await Promise.allSettled(ids.map((id) => macro.indicator(env, id, lang)));
    return json({ indicators: r.map((x, i) => (x.status === 'fulfilled' ? x.value : { id: ids[i], name: CATALOG[ids[i]].name, group: CATALOG[ids[i]].group, unit: CATALOG[ids[i]].unit, frequency: CATALOG[ids[i]].freq, meta: { status: 'unavailable', error: x.reason?.message } })) });
  },

  'GET /api/macro/regime': async (req, env) => json((await cached(env, 'regime:macro', 3600, () => macro.regime(env))).value),

  'GET /api/liquidity': async (req, env) => json((await cached(env, 'liquidity:lab:v1', 3 * 3600, () => liquidityLab(env))).value),

  'GET /api/crypto/derivatives': async (req, env) => {
    const r = await cached(env, 'okx:deriv', 120, () => crypto.derivatives());
    return json({ rows: r.value, meta: meta({ source: 'OKX public API', sourceUrl: 'https://www.okx.com/trade-swap', status: 'delayed', frequency: '~2 min cache', unit: 'funding rate per 8h interval; OI in USD', cachedAt: r.cachedAt, stale: r.stale, note: 'Single venue (OKX). Not an aggregate across exchanges.' }) });
  },

  'GET /api/crypto/defi': async (req, env) => {
    const [st, tvl] = await Promise.allSettled([
      cached(env, 'llama:stables:all', 3600, () => crypto.stablecoinTotal()),
      cached(env, 'llama:tvl:Solana', 3600, () => crypto.chainTvl('Solana')),
    ]);
    return json({
      stablecoins: st.status === 'fulfilled' ? { points: st.value.value.slice(-730), meta: meta({ source: 'DefiLlama', sourceUrl: 'https://defillama.com/stablecoins', status: 'historical', frequency: 'daily', unit: 'USD', cachedAt: st.value.cachedAt, stale: st.value.stale }) } : { meta: { status: 'unavailable', error: st.reason?.message } },
      solanaTvl: tvl.status === 'fulfilled' ? { points: tvl.value.value.slice(-730), meta: meta({ source: 'DefiLlama', sourceUrl: 'https://defillama.com/chain/Solana', status: 'historical', frequency: 'daily', unit: 'USD', cachedAt: tvl.value.cachedAt, stale: tvl.value.stale }) } : { meta: { status: 'unavailable', error: tvl.reason?.message } },
    });
  },

  'GET /api/meme/scanner': async (req, env) => json(await scanner(env)),
  'GET /api/meme/regime': async (req, env) => json(await memeState(env)),
  'POST /api/meme/regime': async (req, env) => {
    const body = await readJson(req);
    return json(await memeState(env, body.rules));
  },

  'GET /api/news': async (req, env) => {
    const url = new URL(req.url);
    const lang = q(url, 'lang', 'all');
    if (!LANGS.has(lang)) return apiError(400, 'bad_lang', 'lang must be en, es or all');
    const r = await news.latest(env);
    const items = news.filterItems(r.value.items, {
      lang, category: q(url, 'category'), asset: q(url, 'asset'), country: q(url, 'country'),
      q: (q(url, 'q') || '').slice(0, 100), limit: Number(q(url, 'limit', 60)), sort: q(url, 'sort', 'relevance'),
    });
    return json({ items, feeds: r.value.feedStatus, meta: meta({ source: 'Publisher RSS/Atom feeds', status: 'delayed', frequency: '5 min cache', cachedAt: r.cachedAt, stale: r.stale, note: 'Headlines and short excerpts only; follow links for the full article at the publisher.' }) });
  },

  'GET /api/news/item': async (req, env, ctx) => {
    const id = q(new URL(req.url), 'id');
    if (!id || !/^[a-f0-9]{20}$/.test(id)) return apiError(400, 'bad_id', 'Invalid article id');
    // A cold isolate must refetch every feed (several seconds). Article pages then answer from
    // the D1 archive instead of waiting; the feed refresh continues in the background.
    const feed = news.latest(env);
    ctx.waitUntil(feed.catch(() => null));
    const r = env.DB ? await Promise.race([feed, new Promise((res) => setTimeout(() => res(null), 2500))]).catch(() => null) : await feed;
    let item = r?.value.items.find((i) => i.id === id);
    if (!item && env.DB) item = await news.getArchived(env, id);
    if (!item) return apiError(404, 'not_found', 'Article not found (it may have left the current feed window).');
    const pool = r ? r.value.items : await news.recentArchived(env, { limit: 150, sinceHours: 72 });
    const related = pool.filter((i) => i.id !== id && i.categories.some((c) => item.categories?.includes(c))).slice(0, 8);
    return json({ item, impact: impactFor(item), related, meta: meta({ source: item.source, sourceUrl: item.url, status: 'delayed', cachedAt: r?.cachedAt, stale: r ? r.stale : false }) });
  },

  'GET /api/news/official': async (req, env) => {
    const id = q(new URL(req.url), 'id');
    if (!id || !/^[a-f0-9]{20}$/.test(id)) return apiError(400, 'bad_id', 'Invalid article id');
    const r = await news.latest(env);
    const item = r.value.items.find((i) => i.id === id) || (env.DB ? await news.getArchived(env, id) : null);
    if (!item) return apiError(404, 'not_found', 'Article not found');
    return json(await officialText(env, item));
  },

  'GET /api/news/story': async (req, env) => {
    const url = new URL(req.url);
    const id = q(url, 'id');
    const lang = q(url, 'lang') === 'es' ? 'es' : 'en';
    if (!id || !/^[a-f0-9]{20}$/.test(id)) return apiError(400, 'bad_id', 'Invalid article id');
    const r = await news.latest(env);
    const item = r.value.items.find((i) => i.id === id) || (env.DB ? await news.getArchived(env, id) : null);
    if (!item) return apiError(404, 'not_found', 'Article not found');
    try {
      return json(await story(env, item, r.value.items, lang));
    } catch (e) {
      if (e.status) return apiError(e.status, e.code || 'story_error', e.message);
      throw e;
    }
  },

  'GET /api/assets/universe': async (req, env) => json(await universe(env)),

  'GET /api/news/archive': async (req, env) => {
    const url = new URL(req.url);
    const from = q(url, 'from'), to = q(url, 'to');
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return apiError(400, 'bad_date', 'from/to must be YYYY-MM-DD');
    const rows = await news.searchArchive(env, { q: (q(url, 'q') || '').slice(0, 100), lang: q(url, 'lang'), from, to, limit: q(url, 'limit'), offset: q(url, 'offset') });
    if (rows === null) return apiError(503, 'archive_unavailable', 'Historical archive requires the D1 binding "DB" (see README).');
    return json({ items: rows });
  },

  'POST /api/news/analyze': async (req, env) => {
    if (!ai.aiEnabled(env)) return apiError(503, 'ai_not_configured', 'Set the ANTHROPIC_API_KEY secret to enable AI analysis.');
    if (!(await rateLimit(env, req, 'ai', 10, 600))) return apiError(429, 'rate_limited', 'Too many AI requests; try again in a few minutes.');
    const body = await readJson(req);
    const lang = body.lang === 'es' ? 'es' : 'en';
    if (typeof body.id !== 'string' || !/^[a-f0-9]{20}$/.test(body.id)) return apiError(400, 'bad_id', 'Invalid article id');
    const all = (await news.latest(env)).value.items;
    const article = all.find((i) => i.id === body.id);
    if (!article) return apiError(404, 'not_found', 'Article not found in the current feed window');
    const r = await cached(env, `ai:article:${body.id}:${lang}`, 24 * 3600, async () => {
      const inds = await Promise.allSettled(['DGS10', 'DTWEXBGS', 'VIXCLS', 'DFF'].map((id) => macro.indicator(env, id, lang)));
      const context = ai.buildEvidence({ indicators: inds.filter((x) => x.status === 'fulfilled').map((x) => x.value) });
      return ai.analyzeArticle(env, article, context, lang);
    });
    return json({ ...r.value, cachedAt: new Date(r.cachedAt).toISOString() });
  },

  'GET /api/ai/briefing': async (req, env) => {
    const lang = q(new URL(req.url), 'lang', 'en') === 'es' ? 'es' : 'en';
    if (!ai.aiEnabled(env)) return apiError(503, 'ai_not_configured', 'Set the ANTHROPIC_API_KEY secret to enable the AI analyst. The rule-based regime remains available at /api/macro/regime.');
    // Cached for 6h; regenerated by cron. Users never trigger more than one generation per window.
    const bucket = Math.floor(Date.now() / (6 * 3600 * 1000));
    const r = await cached(env, `ai:briefing:${lang}:${bucket}`, 6 * 3600, () => generateBriefing(env, lang));
    return json({ ...r.value, cachedAt: new Date(r.cachedAt).toISOString() });
  },

  'POST /api/ai/report': async (req, env) => {
    if (!ai.aiEnabled(env)) return apiError(503, 'ai_not_configured', 'Set the ANTHROPIC_API_KEY secret to enable the AI analyst.');
    if (!(await rateLimit(env, req, 'ai', 10, 600))) return apiError(429, 'rate_limited', 'Too many AI requests; try again in a few minutes.');
    const body = await readJson(req);
    const question = String(body.question || '').trim();
    if (question.length < 8 || question.length > 500) return apiError(400, 'bad_question', 'Question must be 8–500 characters.');
    return json(await generateBriefing(env, body.lang === 'es' ? 'es' : 'en', question));
  },

  'GET /api/calendar': async (req, env) => {
    const url = new URL(req.url);
    const from = q(url, 'from'), to = q(url, 'to');
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return apiError(400, 'bad_date', 'from/to must be YYYY-MM-DD');
    return json(await calendar(env, { from, to }));
  },

  // ---------------- Quantum Lab (whale tracker) ----------------
  'GET /api/lab/search': async (req, env) => {
    if (!(await rateLimit(env, req, 'lab', 60, 60))) return apiError(429, 'rate_limited', 'Too many searches; wait a minute.');
    return json(await lab.search(env, q(new URL(req.url), 'q')));
  },
  'GET /api/lab/asset': async (req, env) => {
    const u = new URL(req.url);
    return json(await lab.asset(env, { kind: q(u, 'kind'), id: q(u, 'id'), cik: q(u, 'cik'), chain: q(u, 'chain'), address: q(u, 'address') }));
  },
  'GET /api/lab/holders': async (req, env) => {
    const u = new URL(req.url);
    if (!(await rateLimit(env, req, 'lab', 60, 60))) return apiError(429, 'rate_limited', 'Too many requests; wait a minute.');
    return json(await lab.holders(env, { chain: q(u, 'chain'), address: q(u, 'address'), native: q(u, 'native') === '1' }));
  },
  'GET /api/lab/wallet': async (req, env) => {
    const u = new URL(req.url);
    if (!(await rateLimit(env, req, 'lab', 60, 60))) return apiError(429, 'rate_limited', 'Too many requests; wait a minute.');
    const chain = q(u, 'chain'), address = q(u, 'address');
    const [w, act] = await Promise.all([lab.wallet(env, chain, address), lab.walletActivity(env, chain, address).catch((e) => ({ events: [], error: e.message }))]);
    return json({ ...w, activity: act });
  },
  'GET /api/lab/wallet/activity': async (req, env) => {
    const u = new URL(req.url);
    if (!(await rateLimit(env, req, 'lab', 60, 60))) return apiError(429, 'rate_limited', 'Too many requests; wait a minute.');
    return json({ ...(await lab.walletActivity(env, q(u, 'chain'), q(u, 'address'))), fetchedAt: new Date().toISOString() });
  },
  'GET /api/lab/wallet/history': async (req, env) => {
    const u = new URL(req.url);
    return json(await lab.tokenHistory(env, q(u, 'chain'), q(u, 'address'), q(u, 'token')));
  },

  // ---------------- Alerts (persistent, per anonymous owner key) ----------------
  'GET /api/alerts/state': async (req, env) => json(await alerts.state(env, await alerts.ownerFrom(env, req))),
  'POST /api/alerts/watch': async (req, env) => json(await alerts.watch(env, await alerts.ownerFrom(env, req), await readJson(req))),
  'POST /api/alerts/watch/toggle': async (req, env) => { const b = await readJson(req); return json(await alerts.setWalletEnabled(env, await alerts.ownerFrom(env, req), b.id, b.enabled)); },
  'POST /api/alerts/watch/delete': async (req, env) => json(await alerts.unwatch(env, await alerts.ownerFrom(env, req), (await readJson(req)).id)),
  'POST /api/alerts/rules': async (req, env) => json(await alerts.saveRule(env, await alerts.ownerFrom(env, req), await readJson(req))),
  'POST /api/alerts/rules/delete': async (req, env) => json(await alerts.deleteRule(env, await alerts.ownerFrom(env, req), (await readJson(req)).id)),
  'GET /api/alerts/events': async (req, env) => json(await alerts.events(env, await alerts.ownerFrom(env, req), { since: q(new URL(req.url), 'since') })),
  'GET /api/alerts/feed': async (req, env) => json(await alerts.feed(env, await alerts.ownerFrom(env, req))),
  'POST /api/alerts/read': async (req, env) => json(await alerts.markRead(env, await alerts.ownerFrom(env, req), (await readJson(req)).ids)),
  'POST /api/alerts/settings': async (req, env) => json(await alerts.saveSettings(env, await alerts.ownerFrom(env, req), await readJson(req))),
  // Check the caller's own watched wallets now (same engine as the cron), rate-limited.
  'POST /api/alerts/check': async (req, env) => {
    const owner = await alerts.ownerFrom(env, req);
    if (!(await rateLimit(env, req, 'alertcheck', 4, 60))) return apiError(429, 'rate_limited', 'Check limited to 4 per minute.');
    return json(await alerts.scan(env, { maxWallets: 10, onlyOwner: owner }));
  },

  // ---------------- Intelligence Calendar ----------------
  'GET /api/cal/range': async (req, env) => {
    const u = new URL(req.url);
    const r = await cached(env, `cal2:${q(u, 'from')}:${q(u, 'to')}`, 600, () => cal2.range(env, q(u, 'from'), q(u, 'to')));
    return json({ ...r.value, cachedAt: new Date(r.cachedAt).toISOString() });
  },
  'GET /api/cal/impact': async (req, env) => {
    const u = new URL(req.url);
    if (!(await rateLimit(env, req, 'calimpact', 30, 60))) return apiError(429, 'rate_limited', 'Too many requests; wait a minute.');
    const assets = (q(u, 'assets') || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    const r = await cached(env, `calimp:${q(u, 'date')}:${assets.join(',')}`, 900, () => cal2.impact(env, q(u, 'date'), assets));
    return json({ ...r.value, cachedAt: new Date(r.cachedAt).toISOString() });
  },
  'GET /api/cal/news': async (req, env) => {
    const d = q(new URL(req.url), 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return apiError(400, 'bad_date', 'date must be YYYY-MM-DD');
    return json({ date: d, items: await cal2.dayNews(env, d) });
  },

  'POST /api/admin/ingest': async (req, env) => {
    requireAdmin(req, env);
    const { items, ...r } = await ingest(env);
    return json(r);
  },
};

async function generateBriefing(env, lang, question = null) {
  const indIds = ['DFF', 'DGS2', 'DGS10', 'T10Y2Y', 'DFII10', 'T5YIE', 'CPIAUCSL', 'PCEPILFE', 'UNRATE', 'PAYEMS', 'ICSA', 'A191RL1Q225SBEA', 'NFCI', 'BAMLH0A0HYM2', 'VIXCLS', 'SP500', 'DTWEXBGS', 'DCOILWTICO', 'ECBDFR'];
  const [inds, reg, nw, mk, nl, cal] = await Promise.all([
    Promise.allSettled(indIds.map((id) => macro.indicator(env, id, 'en'))),
    macro.regime(env).catch(() => null),
    news.latest(env).then((r) => r.value.items).catch(() => []),
    crypto.sharedMarkets(env).then((r) => crypto.withoutSparkline(r.value.slice(0, 6))).catch(() => []),
    macro.netLiq(env).catch(() => null),
    calendar(env, { from: new Date().toISOString().slice(0, 10) }).then((c) => c.events).catch(() => []),
  ]);
  let liq = null;
  if (nl?.rows?.length > 14) liq = { last: nl.rows.at(-1), prev: nl.rows.at(-14) };
  const evidence = ai.buildEvidence({
    indicators: inds.filter((x) => x.status === 'fulfilled').map((x) => x.value), regime: reg,
    news: nw.filter((n) => n.lang === 'en' || n.official).slice(0, 25), markets: mk, liquidity: liq, calendar: cal,
  });
  if (evidence.length < 5) throw Object.assign(new Error('Insufficient evidence available to generate a briefing (data providers unavailable).'), { status: 503 });
  return ai.briefing(env, evidence, lang, question);
}

async function ingest(env) {
  const { items, feedStatus } = await news.collect(env);
  const stored = await news.archive(env, items);
  return { seen: items.length, ...stored, feeds: feedStatus, items };
}

function secure(headers, html) {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (html) { headers.set('content-security-policy', CSP); headers.set('x-frame-options', 'DENY'); }
  return headers;
}

// Every non-API, non-static URL: server-rendered page in the SPA shell (or a crawl file).
// Static files (js/css/images) are served by the assets layer before the Worker runs.
async function servePage(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  if (url.pathname === '/index.html') return Response.redirect(`${siteUrl(env, url)}/`, 301);
  const file = await crawlFile(url.pathname, env, siteUrl(env, url));
  if (file) { secure(file.headers, false); return file; }
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }));
  const r = await renderPage(request, env, new Response(shell.body, shell));
  if (r.redirect) return r.redirect;
  const headers = secure(new Headers(r.response.headers), true);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.delete('etag');
  let res = new Response(r.response.body, { status: r.status, headers });
  // Coinzilla site verification <meta> is injected server-side from configuration.
  if (env.COINZILLA_VERIFICATION) {
    res = new HTMLRewriter().on('head', {
      element(el) { el.append(`<meta name="coinzilla" content="${String(env.COINZILLA_VERIFICATION).replace(/[^a-zA-Z0-9_-]/g, '')}">`, { html: true }); },
    }).transform(res);
  }
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return servePage(request, env);
    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) return apiError(404, 'not_found', `No route ${request.method} ${url.pathname}`);
    if (!(await rateLimit(env, request, 'api', 240, 60))) return apiError(429, 'rate_limited', 'Too many requests');
    const started = Date.now();
    try {
      const res = await handler(request, env, ctx);
      log('info', 'api', { path: url.pathname, status: res.status, ms: Date.now() - started });
      return res;
    } catch (err) {
      // Upstream provider errors are reported as 502 (never forward a provider's 403/404 as ours).
      const status = err.provider ? 502 : err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      log('error', 'api_error', { path: url.pathname, status, error: err.message });
      return apiError(status, status === 502 ? 'upstream_unavailable' : 'request_failed', err.message);
    }
  },

  // Cron: news ingestion every 15 min; AI briefing pre-generation every 6h (if configured).
  async scheduled(event, env, ctx) {
    // Every minute: persistent whale alerts. News ingestion runs on the quarter hour.
    if (event.cron === '* * * * *') {
      if (env.DB) {
        try { const r = await alerts.scan(env); log('info', 'cron_alert_scan', { scanned: r.scanned, fired: r.report.reduce((a, x) => a + (x.fired || 0), 0) }); }
        catch (e) { log('error', 'cron_alert_scan_failed', { error: e.message }); }
      }
      const minute = new Date(event.scheduledTime).getUTCMinutes();
      // VOID Report for the newest story without one, in its own light run (:07, :22, :37, :52)
      // so it never shares an invocation with the feed ingest. Newest items with a photo first.
      if (minute % 15 === 7 && env.DB) {
        try {
          // Only stories inside VOID's financial sections (never general/off-topic news).
          const recent = (await news.recentArchived(env, { limit: 200, sinceHours: 24 })).filter((i) => SECTIONS.some((sec) => inSection(sec, i)));
          const ranked = [...recent.filter((i) => i.image), ...recent.filter((i) => !i.image)];
          log('info', 'cron_story_pregen', await pregenerate(env, ranked, 1));
        } catch (e) { log('error', 'cron_story_pregen_failed', { error: e.message }); }
        return;
      }
      if (minute % 15 !== 0) return;
    }
    try {
      const r = await ingest(env);
      log('info', 'cron_ingest', { cron: event.cron, seen: r.seen, stored: r.stored });
    } catch (e) { log('error', 'cron_ingest_failed', { error: e.message }); }
    // Warm the FRED cache (stored in KV when bound) so user requests rarely hit FRED directly.
    if (event.cron === '5 */6 * * *') {
      ctx.waitUntil(cal2.persist(env).then((r) => log('info', 'cron_calendar_persist', r)).catch((e) => log('error', 'cron_calendar_persist_failed', { error: e.message })));
      ctx.waitUntil(Promise.allSettled(Object.keys(CATALOG).map((id) => macro.series(env, id))).then((r) => log('info', 'cron_fred_warm', { ok: r.filter((x) => x.status === 'fulfilled').length, total: r.length })));
    }
    if (event.cron === '5 */6 * * *' && ai.aiEnabled(env)) {
      for (const lang of ['en', 'es']) {
        ctx.waitUntil(routes['GET /api/ai/briefing'](new Request(`https://internal/api/ai/briefing?lang=${lang}`), env).catch((e) => log('error', 'cron_briefing_failed', { error: e.message })));
      }
    }
  },
};

export { routes, generateBriefing };
