// Live Solana memecoin scanner (GeckoTerminal). Lists are cached ~60s; contract/holder
// checks for the most active tokens are cached 15 min. GeckoTerminal's free API allows
// ~30 calls/min, so the number of upstream requests per refresh is kept small.

import { upstream, cached, log } from '../lib/core.js';
import { normalizePool, normalizeInfo, analyze, mergePools } from '../../public/js/shared/memescan.js';
import { latest as latestNews } from './news.js';

const GT = 'https://api.geckoterminal.com/api/v2/networks/solana';
const HDR = { init: { headers: { accept: 'application/json;version=20230302' } }, timeoutMs: 12000, retries: 1 };

const LISTS = {
  new: `${GT}/new_pools?page=1&include=base_token`,
  new2: `${GT}/new_pools?page=2&include=base_token`,
  trending5m: `${GT}/trending_pools?duration=5m&page=1&include=base_token`,
  trending1h: `${GT}/trending_pools?duration=1h&page=1&include=base_token`,
  pumpfun: `${GT}/dexes/pump-fun/pools?page=1&sort=h24_volume_usd_desc&include=base_token`,
};

async function fetchList(env, key) {
  const r = await cached(env, `gt:list:${key}`, 60, async () => {
    const body = await upstream('geckoterminal', LISTS[key], HDR);
    const tokens = Object.fromEntries((body.included || []).map((t) => [t.id, t]));
    return (body.data || []).map((p) => ({ raw: p, tokens: { [p.relationships?.base_token?.data?.id]: tokens[p.relationships?.base_token?.data?.id] } }));
  });
  return r;
}

async function tokenInfo(env, address) {
  const r = await cached(env, `gt:info:${address}`, 900, async () => {
    const body = await upstream('geckoterminal', `${GT}/tokens/${address}/info`, HDR);
    return normalizeInfo(body.data?.attributes);
  });
  return r.value;
}

export async function scanner(env) {
  const r = await cached(env, 'meme:scanner:v1', 45, () => build(env));
  return { ...r.value, cachedAt: new Date(r.cachedAt).toISOString(), stale: r.stale };
}

async function build(env) {
  const now = Date.now();
  const status = {};
  const lists = [];
  for (const key of Object.keys(LISTS)) {
    try {
      const r = await fetchList(env, key);
      status[key] = { ok: true, count: r.value.length, lastUpdated: new Date(r.cachedAt).toISOString(), stale: r.stale };
      lists.push([key, r.value.map((x) => normalizePool(x.raw, x.tokens, now))]);
    } catch (e) { status[key] = { ok: false, error: e.message }; }
  }
  if (!lists.length) throw Object.assign(new Error('GeckoTerminal unavailable: no scanner lists could be loaded'), { status: 502 });
  // Drop stablecoin/major pairs that are not memecoins (quote-side pools of SOL, USDC…).
  const MAJORS = /^(SOL|WSOL|USDC|USDT|JUP|JTO|PYTH|RAY|BONK|WIF)$/i;
  let rows = mergePools(lists).filter((r) => r.symbol && !MAJORS.test(r.symbol)).map(analyze);

  // Contract & holder checks for the most active tokens (bounded, sequential-ish).
  const candidates = [...rows].sort((a, b) => b.momentum.score - a.momentum.score || b.signals.length - a.signals.length).slice(0, 14);
  let checked = 0;
  for (let i = 0; i < candidates.length; i += 3) {
    await Promise.all(candidates.slice(i, i + 3).map(async (c) => {
      try { c.info = await tokenInfo(env, c.token); checked++; } catch (e) { log('warn', 'gt_info_failed', { token: c.token, error: e.message }); }
    }));
  }
  const infoByToken = new Map(candidates.filter((c) => c.info).map((c) => [c.token, c.info]));
  rows = rows.map((r) => (infoByToken.has(r.token) ? analyze({ ...r, info: infoByToken.get(r.token) }) : r));
  rows.sort((a, b) => b.momentum.score - a.momentum.score);

  // Related news: memecoin-category stories, or stories that name a scanned token symbol.
  let news = [];
  try {
    const items = (await latestNews(env)).value.items;
    // Symbols only match as "$SYM", or as a 4+ letter word in a headline that is also about crypto.
    const syms = [...new Set(rows.map((r) => r.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter((s) => s.length >= 3))];
    const cryptoCtx = /\b(crypto|cripto|token|coin|moneda|solana|memecoin|dex|pump)/i;
    news = items.filter((i) => i.categories.includes('memecoins') || /\b(pump\.?fun|memecoins?|meme coins?|pumpswap|raydium|letsbonk)\b/i.test(i.title)
      || syms.some((s) => new RegExp(`\\$${s}\\b`, 'i').test(i.title) || (s.length >= 4 && cryptoCtx.test(i.title) && new RegExp(`\\b${s}\\b`).test(i.title))))
      .slice(0, 24).map(({ id, title, url, source, publishedAt, image, lang, excerpt }) => ({ id, title, url, source, publishedAt, image, lang, excerpt }));
  } catch { /* news is optional for the scanner */ }

  const signals = rows.flatMap((r) => r.signals.map((s) => ({ ...s, pool: r.pool, symbol: r.symbol, image: r.image, risk: r.risk.level, ageMin: r.ageMin, value: r.marketCapUsd ?? r.fdvUsd, url: r.url })));
  return {
    rows: rows.slice(0, 120), signals, news, status, checkedTokens: checked,
    stats: {
      pools: rows.length,
      launchedLastHour: rows.filter((r) => r.ageMin !== null && r.ageMin <= 60).length,
      over1MFirstHour: rows.filter((r) => r.ageMin !== null && r.ageMin <= 60 && (r.marketCapUsd ?? r.fdvUsd) >= 1e6).length,
      volume5m: rows.reduce((a, r) => a + (r.vol.m5 || 0), 0),
      extremeRisk: rows.filter((r) => r.risk.level === 'EXTREME').length,
    },
    generatedAt: new Date().toISOString(),
    disclaimer: 'Activity signals from on-chain/DEX data. Not investment advice or buy recommendations. Most new memecoins lose most of their value; many are scams.',
  };
}
