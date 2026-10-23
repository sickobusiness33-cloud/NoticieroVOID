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
import { impactFor } from '../public/js/shared/impact.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9-]{2,60}$/;

// Ad network and data provider domains are allowed explicitly; everything else is 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://coinzillatag.com https://*.coinzilla.com https://*.czilladx.com",
  "frame-src https://*.czilladx.com https://*.coinzilla.com https://coinzillatag.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.coinzilla.com https://*.czilladx.com https://coinzillatag.com",
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
      cached(env, 'cg:markets', 120, () => crypto.markets(env)),
      cached(env, 'cg:global', 300, () => crypto.globalStats(env)),
      cached(env, 'cg:paxg', 300, () => crypto.markets(env, 'pax-gold')),
    ]);
    const tradfiIds = ['SP500', 'NASDAQCOM', 'DJIA', 'VIXCLS', 'DGS2', 'DGS10', 'T10Y2Y', 'DFII10', 'DTWEXBGS', 'DCOILWTICO', 'DFF', 'ECBDFR', 'BAMLH0A0HYM2'];
    const lang = q(new URL(req.url), 'lang', 'en');
    const tradfi = await Promise.allSettled(tradfiIds.map((id) => macro.indicator(env, id, lang)));
    const crypt = mk.status === 'fulfilled' ? mk.value : null;
    const paxg = gold.status === 'fulfilled' ? gold.value.value.find((c) => c.id === 'pax-gold') : null;
    return json({
      crypto: crypt ? { rows: crypt.value, meta: meta({ source: 'CoinGecko', sourceUrl: 'https://www.coingecko.com', status: 'delayed', frequency: '~1–2 min', unit: 'USD', cachedAt: crypt.cachedAt, stale: crypt.stale, note: 'Aggregated spot prices; cached up to 2 minutes.' }) } : { rows: [], meta: { status: 'unavailable', error: mk.reason?.message } },
      global: gl.status === 'fulfilled' ? { ...gl.value.value, meta: meta({ source: 'CoinGecko', sourceUrl: 'https://www.coingecko.com/en/global-charts', status: 'delayed', unit: 'USD', cachedAt: gl.value.cachedAt, stale: gl.value.stale }) } : { meta: { status: 'unavailable', error: gl.reason?.message } },
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

  'GET /api/news/item': async (req, env) => {
    const id = q(new URL(req.url), 'id');
    if (!id || !/^[a-f0-9]{20}$/.test(id)) return apiError(400, 'bad_id', 'Invalid article id');
    const r = await news.latest(env);
    let item = r.value.items.find((i) => i.id === id);
    if (!item && env.DB) item = await news.getArchived(env, id);
    if (!item) return apiError(404, 'not_found', 'Article not found (it may have left the current feed window).');
    const related = r.value.items.filter((i) => i.id !== id && i.categories.some((c) => item.categories?.includes(c))).slice(0, 8);
    return json({ item, impact: impactFor(item), related, meta: meta({ source: item.source, sourceUrl: item.url, status: 'delayed', cachedAt: r.cachedAt, stale: r.stale }) });
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

  'POST /api/admin/ingest': async (req, env) => {
    requireAdmin(req, env);
    return json(await ingest(env));
  },
};

async function generateBriefing(env, lang, question = null) {
  const indIds = ['DFF', 'DGS2', 'DGS10', 'T10Y2Y', 'DFII10', 'T5YIE', 'CPIAUCSL', 'PCEPILFE', 'UNRATE', 'PAYEMS', 'ICSA', 'A191RL1Q225SBEA', 'NFCI', 'BAMLH0A0HYM2', 'VIXCLS', 'SP500', 'DTWEXBGS', 'DCOILWTICO', 'ECBDFR'];
  const [inds, reg, nw, mk, nl, cal] = await Promise.all([
    Promise.allSettled(indIds.map((id) => macro.indicator(env, id, 'en'))),
    macro.regime(env).catch(() => null),
    news.latest(env).then((r) => r.value.items).catch(() => []),
    cached(env, 'cg:markets', 120, () => crypto.markets(env)).then((r) => r.value.slice(0, 6)).catch(() => []),
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
  return { seen: items.length, ...stored, feeds: feedStatus };
}

async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  const ct = res.headers.get('content-type') || '';
  const headers = new Headers(res.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (!ct.includes('text/html')) return new Response(res.body, { status: res.status, headers });
  headers.set('content-security-policy', CSP);
  headers.set('x-frame-options', 'DENY');
  // Coinzilla site verification <meta> is injected server-side from configuration.
  let rewritten = new Response(res.body, { status: res.status, headers });
  if (env.COINZILLA_VERIFICATION) {
    rewritten = new HTMLRewriter().on('head', {
      element(el) { el.append(`<meta name="coinzilla" content="${String(env.COINZILLA_VERIFICATION).replace(/[^a-zA-Z0-9_-]/g, '')}">`, { html: true }); },
    }).transform(rewritten);
  }
  return rewritten;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return serveAsset(request, env);
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
    try {
      const r = await ingest(env);
      log('info', 'cron_ingest', { cron: event.cron, seen: r.seen, stored: r.stored });
    } catch (e) { log('error', 'cron_ingest_failed', { error: e.message }); }
    // Warm the FRED cache (stored in KV when bound) so user requests rarely hit FRED directly.
    if (event.cron === '5 */6 * * *') {
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
