// Global Liquidity Lab data service: measured components + an explicitly labelled
// analytical composite with documented inputs, weights, normalization and sensitivity.

import { series, netLiq } from './macro.js';
import { stablecoinTotal } from '../adapters/crypto.js';
import { cached } from '../lib/core.js';
import { compositeScore, sensitivity, weeklyGrid, COMPOSITE_COMPONENTS } from '../../public/js/shared/liquidity.js';

export async function liquidityLab(env) {
  const errors = [];
  const safe = async (name, fn) => { try { return await fn(); } catch (e) { errors.push({ name, error: e.message }); return null; } };
  const [nl, ecb, boj, m2, realY, dxy, sofr, reserves, rrp, tga, stables] = await Promise.all([
    safe('netLiquidity', () => netLiq(env)),
    safe('ECBASSETSW', () => series(env, 'ECBASSETSW', '2018-01-01')),
    safe('JPNASSETS', () => series(env, 'JPNASSETS', '2018-01-01')),
    safe('M2SL', () => series(env, 'M2SL', '2018-01-01')),
    safe('DFII10', () => series(env, 'DFII10', '2018-01-01')),
    safe('DTWEXBGS', () => series(env, 'DTWEXBGS', '2018-01-01')),
    safe('SOFR', () => series(env, 'SOFR', '2022-01-01')),
    safe('WRESBAL', () => series(env, 'WRESBAL', '2018-01-01')),
    safe('RRPONTSYD', () => series(env, 'RRPONTSYD', '2018-01-01')),
    safe('WTREGEN', () => series(env, 'WTREGEN', '2018-01-01')),
    safe('stablecoins', async () => (await cached(env, 'llama:stables:all', 3600, () => stablecoinTotal())).value),
  ]);
  const grid = weeklyGrid('2018-01-03', new Date().toISOString().slice(0, 10));
  const raw = {
    netLiq: nl?.rows?.map((r) => ({ date: r.date, value: r.value })) || [],
    ecb: ecb?.points || [], stables: (stables || []).filter((p) => p.date >= '2018-01-01'),
    realYield: realY?.points || [], dollar: dxy?.points || [],
  };
  const comp = compositeScore(raw, grid);
  const sens = sensitivity(raw, grid);
  const thin = (pts, n = 900) => (pts && pts.length > n ? pts.filter((_, i) => i % Math.ceil(pts.length / n) === 0 || i === pts.length - 1) : pts);
  const measured = (s, id) => s && { id, points: thin(s.points), unit: s.catalog.unit, frequency: s.catalog.freq, stale: s.stale, lastUpdated: new Date(s.cachedAt).toISOString(), sourceUrl: `https://fred.stlouisfed.org/series/${id}` };
  return {
    measured: {
      netLiquidity: nl && { points: nl.rows.map((r) => ({ date: r.date, value: r.value, walcl: r.parts.walcl, tga: r.parts.tga, rrp: r.parts.rrp })), meta: nl.meta },
      ecbAssets: measured(ecb, 'ECBASSETSW'), bojAssets: measured(boj, 'JPNASSETS'), m2: measured(m2, 'M2SL'),
      realYield10y: measured(realY, 'DFII10'), dollar: measured(dxy, 'DTWEXBGS'), sofr: measured(sofr, 'SOFR'),
      reserves: measured(reserves, 'WRESBAL'), rrp: measured(rrp, 'RRPONTSYD'), tga: measured(tga, 'WTREGEN'),
      stablecoins: stables && { points: thin(stables), unit: 'USD', frequency: 'daily', sourceUrl: 'https://defillama.com/stablecoins' },
    },
    composite: {
      label: 'ANALYTICAL ESTIMATE — not a measured quantity',
      rows: comp.rows.filter((r) => Number.isFinite(r.value) || r.coverage > 0),
      components: COMPOSITE_COMPONENTS, method: comp.method, sensitivity: sens,
    },
    errors, generatedAt: new Date().toISOString(),
  };
}
