// Solana memecoin market-regime service. Gathers real observations from independent
// providers, then applies the transparent rule set in shared/regime.js. Any provider that
// fails simply removes its inputs; the classifier reports INSUFFICIENT_DATA rather than guess.

import { sharedMarkets, history, dexVolume, stablecoinChain, solanaPools, solanaFees } from '../adapters/crypto.js';
import { cached } from '../lib/core.js';
import { memeRegime, MEME_DEFAULT_RULES } from '../../public/js/shared/regime.js';
import { pctReturns, std } from '../../public/js/shared/stats.js';

const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

export async function memeState(env, rulesOverride) {
  const providers = {};
  const get = async (name, key, ttl, fn) => {
    try { const r = await cached(env, key, ttl, fn); providers[name] = { ok: true, lastUpdated: new Date(r.cachedAt).toISOString(), stale: r.stale }; return r.value; }
    catch (e) { providers[name] = { ok: false, error: e.message }; return null; }
  };
  const [mk, solHist, dex, stables, trending, fresh, fees] = await Promise.all([
    get('coingecko', 'cg:markets:v2', 180, async () => (await sharedMarkets(env)).value),
    get('coingecko-history', 'cg:hist:solana:365', 6 * 3600, () => history(env, 'solana', 365)),
    get('defillama-dex', 'llama:dex:solana', 1800, () => dexVolume('solana')),
    get('defillama-stablecoins', 'llama:stables:Solana', 3600, () => stablecoinChain('Solana')),
    get('geckoterminal-trending', 'gt:trending', 180, () => solanaPools('trending', env)),
    get('geckoterminal-new', 'gt:new', 180, () => solanaPools('new', env)),
    get('solana-rpc', 'sol:fees', 60, () => solanaFees(env)),
  ]);

  const sol = mk?.find((c) => c.id === 'solana');
  const btc = mk?.find((c) => c.id === 'bitcoin');
  let solVol30d = null;
  if (solHist?.length > 31) solVol30d = std(pctReturns(solHist.slice(-31)).map((r) => r.value)) * Math.sqrt(365);

  // DEX volume: last 7 complete days vs the 7 days before.
  let dexVolumeChange7d = null;
  if (dex?.series?.length > 15) {
    const s = dex.series.slice(-15, -1).map((p) => p.value);
    const a = s.slice(7).reduce((x, y) => x + y, 0), b = s.slice(0, 7).reduce((x, y) => x + y, 0);
    dexVolumeChange7d = b > 0 ? (a / b - 1) * 100 : null;
  }
  let stablecoinChange30d = null;
  if (stables?.length > 31) {
    const last = stables.at(-1).value, prev = stables.at(-31).value;
    stablecoinChange30d = prev > 0 ? (last / prev - 1) * 100 : null;
  }
  const pools = trending || [];
  const poolBreadth = pools.length >= 5 ? pools.filter((p) => p.change24h > 0).length / pools.length : null;
  const medianPoolLiquidity = pools.length >= 5 ? median(pools.map((p) => p.liquidityUsd)) : null;

  const observations = {
    solChange7d: sol?.change7d ?? null, btcChange7d: btc?.change7d ?? null, solVol30d,
    dexVolumeChange7d, stablecoinChange30d, poolBreadth, medianPoolLiquidity,
  };
  const rules = rulesOverride ? mergeRules(rulesOverride) : MEME_DEFAULT_RULES;
  const now = Date.now();
  const ageH = (p) => (p.createdAt ? (now - Date.parse(p.createdAt)) / 3600000 : null);
  return {
    classification: memeRegime(observations, rules),
    observations, rules,
    sol: sol || null,
    dex: dex ? { total24h: dex.total24h, total7d: dex.total7d, change7d: dex.change7d, change1d: dex.change1d, protocols: dex.protocols, series: dex.series.slice(-120) } : null,
    stablecoins: stables ? stables.slice(-180) : null,
    fees,
    trendingPools: pools.slice(0, 20).map((p) => ({ ...p, ageHours: ageH(p) })),
    newPools: (fresh || []).slice(0, 20).map((p) => ({ ...p, ageHours: ageH(p) })),
    providers,
    disclaimer: 'Market-wide regime only. It does not predict the performance of any individual token. Pool data are third-party aggregates and may include wash trading.',
    generatedAt: new Date().toISOString(),
  };
}

// Accept only numeric threshold overrides for known keys (input validation).
export function mergeRules(o) {
  const r = structuredClone(MEME_DEFAULT_RULES);
  for (const [k, v] of Object.entries(o || {})) {
    if (!r[k] || typeof v !== 'object' || k === 'hardStops') continue;
    for (const f of ['good', 'bad']) if (Number.isFinite(Number(v[f]))) r[k][f] = Number(v[f]);
  }
  return r;
}
