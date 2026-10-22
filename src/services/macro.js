// Macro data service: cached FRED series, indicator cards (latest / previous / context),
// net liquidity, and the inputs for the rule-based regime model.

import { CATALOG, STATUS_BY_FREQ, fetchSeries, fredUrl, FULL_HISTORY_START } from '../adapters/fred.js';
import { cached } from '../lib/core.js';
import { yoy, mean, std } from '../../public/js/shared/stats.js';
import { netLiquidity } from '../../public/js/shared/liquidity.js';
import { macroRegime } from '../../public/js/shared/regime.js';

// Cache by publication frequency: re-fetching a monthly series every minute is pointless.
const TTL = { daily: 3600, weekly: 6 * 3600, monthly: 12 * 3600, quarterly: 24 * 3600 };

export async function series(env, id, start = '2015-01-01') {
  const c = CATALOG[id];
  if (!c) throw Object.assign(new Error(`Unknown series ${id}`), { status: 404 });
  // One cached download per series (full history); callers' start dates are sliced locally.
  const r = await cached(env, `fred:${id}`, TTL[c.freq] || 3600, () => fetchSeries(env, id, FULL_HISTORY_START));
  return { points: start ? r.value.filter((p) => p.date >= start) : r.value, cachedAt: r.cachedAt, stale: r.stale, catalog: c };
}

export function transformPoints(points, transform) {
  if (transform === 'yoy') return { points: yoy(points), unit: '% YoY' };
  if (transform === 'diff') return { points: points.slice(1).map((p, i) => ({ date: p.date, value: p.value - points[i].value })), unit: 'change' };
  return { points, unit: null };
}

// Indicator card: latest, previous, change, 5-year percentile context.
export async function indicator(env, id, lang = 'en') {
  const s = await series(env, id);
  const c = s.catalog;
  const t = transformPoints(s.points, c.transform);
  const pts = t.points;
  const last = pts.at(-1), prev = pts.at(-2);
  const fiveY = pts.filter((p) => Date.parse(p.date) >= Date.parse(last?.date) - 5 * 365 * 86400000).map((p) => p.value);
  const pct = last ? fiveY.filter((v) => v <= last.value).length / fiveY.length : null;
  return {
    id, name: lang === 'es' ? c.nameEs : c.name, group: c.group,
    unit: t.unit || c.unit, rawUnit: c.unit, frequency: c.freq, transform: c.transform || null,
    latest: last || null, previous: prev || null,
    change: last && prev ? last.value - prev.value : null,
    context: last ? { percentile5y: pct, mean5y: mean(fiveY), std5y: std(fiveY), min5y: Math.min(...fiveY), max5y: Math.max(...fiveY) } : null,
    meta: {
      source: 'FRED, Federal Reserve Bank of St. Louis', sourceUrl: fredUrl(id),
      status: s.stale ? 'stale' : STATUS_BY_FREQ[c.freq], lastUpdated: new Date(s.cachedAt).toISOString(),
      observationDate: last?.date ?? null,
      note: c.freq === 'daily' ? 'End-of-day value, published with a delay. Not real-time.' : `Published ${c.freq}. Observation date ≠ publication date.`,
    },
  };
}

export async function netLiq(env) {
  const [w, t, r] = await Promise.all(['WALCL', 'WTREGEN', 'RRPONTSYD'].map((id) => series(env, id, '2018-01-01')));
  const rows = netLiquidity(w.points, t.points, r.points).filter((p) => Number.isFinite(p.value));
  return {
    rows,
    meta: {
      source: 'FRED (WALCL, WTREGEN, RRPONTSYD)', sourceUrl: 'https://fred.stlouisfed.org/series/WALCL',
      status: 'historical', unit: 'USD billions', frequency: 'weekly (Wednesday grid)',
      lastUpdated: new Date(Math.min(w.cachedAt, t.cachedAt, r.cachedAt)).toISOString(), stale: w.stale || t.stale || r.stale,
      method: 'WALCL/1000 − WTREGEN/1000 − RRPONTSYD. TGA and RRP forward-filled up to 7 days onto WALCL dates.',
    },
  };
}

export async function regime(env) {
  const ids = ['CPIAUCSL', 'PCEPILFE', 'UNRATE', 'ICSA', 'A191RL1Q225SBEA', 'DFF', 'DGS2', 'NFCI', 'BAMLH0A0HYM2', 'VIXCLS', 'SP500'];
  const settled = await Promise.allSettled(ids.map((id) => series(env, id, '2020-01-01')));
  const s = {};
  const missing = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled') s[ids[i]] = r.value.points; else missing.push(ids[i]); });
  if (s.CPIAUCSL) s.CPI_YOY = yoy(s.CPIAUCSL);
  if (s.PCEPILFE) s.CORE_PCE_YOY = yoy(s.PCEPILFE);
  try { s.NET_LIQUIDITY = (await netLiq(env)).rows; } catch { missing.push('NET_LIQUIDITY'); }
  return { ...macroRegime(s), missingInputs: missing, generatedAt: new Date().toISOString() };
}
