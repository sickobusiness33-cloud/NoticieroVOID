// Cross-asset snapshot for the article "market impact" panel: real latest values,
// recent change and a typical one-period move (1σ) for every asset in the universe.

import { UNIVERSE, typicalMove } from '../../public/js/shared/impact.js';
import { markets } from '../adapters/crypto.js';
import { STATUS_BY_FREQ } from '../adapters/fred.js';
import { cached } from '../lib/core.js';
import { series } from './macro.js';
import { std } from '../../public/js/shared/stats.js';

export async function universe(env) {
  const r = await cached(env, 'assets:universe:v1', 300, () => build(env));
  return { ...r.value, cachedAt: new Date(r.cachedAt).toISOString(), stale: r.stale };
}

async function build(env) {
  const cgIds = UNIVERSE.filter((a) => a.src === 'cg').map((a) => a.ref).join(',');
  const [cg, ...fred] = await Promise.allSettled([
    markets(env, cgIds, { sparkline: true, perPage: 50 }),
    ...UNIVERSE.filter((a) => a.src === 'fred').map((a) => series(env, a.ref, new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10))),
  ]);
  const fredAssets = UNIVERSE.filter((a) => a.src === 'fred');
  const out = {};
  for (const a of UNIVERSE) {
    if (a.src === 'cg') {
      const c = cg.status === 'fulfilled' ? cg.value.find((x) => x.id === a.ref) : null;
      if (!c) { out[a.id] = { status: 'unavailable', error: cg.reason?.message || 'not returned by CoinGecko' }; continue; }
      // Hourly sparkline → daily 1σ ≈ σ_hourly × √24 (assumes roughly independent hourly returns).
      let move = null;
      const sp = (c.sparkline || []).filter(Number.isFinite);
      if (sp.length > 48) {
        const rets = sp.slice(1).map((v, i) => (v / sp[i] - 1) * 100);
        move = { sigma: std(rets) * Math.sqrt(24), n: rets.length, unit: '%', basis: '7d hourly, scaled to 1 day' };
      }
      out[a.id] = {
        value: c.price, unit: 'USD', change: c.change24h, changeUnit: '% 24h', change7d: c.change7d, date: c.lastUpdated,
        move, status: a.proxy ? 'estimated' : 'delayed', source: 'CoinGecko', sourceUrl: `https://www.coingecko.com/en/coins/${a.ref}`,
      };
    } else {
      const i = fredAssets.indexOf(a);
      const r = fred[i];
      if (r.status !== 'fulfilled' || !r.value.points.length) { out[a.id] = { status: 'unavailable', error: r.reason?.message || 'no data' }; continue; }
      const pts = r.value.points;
      const kind = ['rates', 'credit'].includes(a.cls) ? 'bp' : 'pct';
      const last = pts.at(-1), prev = pts.at(-2);
      const change = prev ? (kind === 'bp' ? (last.value - prev.value) * 100 : (last.value / prev.value - 1) * 100) : null;
      out[a.id] = {
        value: last.value, unit: r.value.catalog.unit, change, changeUnit: kind === 'bp' ? 'bp 1d' : '% 1d', date: last.date,
        move: typicalMove(pts, kind, 60) && { ...typicalMove(pts, kind, 60), basis: 'last 60 daily observations' },
        status: r.value.stale ? 'stale' : STATUS_BY_FREQ[r.value.catalog.freq], source: 'FRED', sourceUrl: `https://fred.stlouisfed.org/series/${a.ref}`,
      };
    }
  }
  return { assets: out, generatedAt: new Date().toISOString() };
}
