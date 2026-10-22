// Crypto market adapters: CoinGecko (prices), DefiLlama (stablecoins, TVL, DEX volume),
// GeckoTerminal (Solana pools), Solana JSON-RPC (fees) and OKX (funding / open interest).
// All public endpoints; an optional COINGECKO_API_KEY (demo or pro) raises limits.

import { upstream } from '../lib/core.js';

function cg(env, path) {
  const pro = env.COINGECKO_API_KEY && env.COINGECKO_PLAN === 'pro';
  const base = pro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  const headers = env.COINGECKO_API_KEY ? { [pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: env.COINGECKO_API_KEY } : {};
  return upstream('coingecko', base + path, { init: { headers }, timeoutMs: 12000 });
}

export async function markets(env, ids) {
  const q = ids ? `&ids=${encodeURIComponent(ids)}` : '';
  const rows = await cg(env, `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&price_change_percentage=1h,24h,7d,30d&sparkline=false${q}`);
  return rows.map((c) => ({
    id: c.id, symbol: c.symbol?.toUpperCase(), name: c.name, image: c.image,
    price: c.current_price, marketCap: c.market_cap, volume24h: c.total_volume,
    change1h: c.price_change_percentage_1h_in_currency, change24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h,
    change7d: c.price_change_percentage_7d_in_currency, change30d: c.price_change_percentage_30d_in_currency,
    lastUpdated: c.last_updated,
  }));
}

export async function globalStats(env) {
  const { data } = await cg(env, '/global');
  return {
    totalMarketCap: data.total_market_cap?.usd, totalVolume: data.total_volume?.usd,
    btcDominance: data.market_cap_percentage?.btc, ethDominance: data.market_cap_percentage?.eth,
    marketCapChange24h: data.market_cap_change_percentage_24h_usd, activeCryptos: data.active_cryptocurrencies,
    updatedAt: data.updated_at ? new Date(data.updated_at * 1000).toISOString() : null,
  };
}

// Daily closes. The free CoinGecko API limits history to the last 365 days.
export async function history(env, id, days = 365) {
  const d = Math.min(Number(days) || 365, env.COINGECKO_API_KEY && env.COINGECKO_PLAN === 'pro' ? 3650 : 365);
  const body = await cg(env, `/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${d}&interval=daily`);
  const byDate = new Map();
  for (const [ts, v] of body.prices || []) byDate.set(new Date(ts).toISOString().slice(0, 10), v);
  // The last point is the current (intraday) price, not a daily close: drop it if today.
  const today = new Date().toISOString().slice(0, 10);
  return [...byDate].filter(([d]) => d !== today).map(([date, value]) => ({ date, value }));
}

export async function stablecoinTotal() {
  const rows = await upstream('defillama', 'https://stablecoins.llama.fi/stablecoincharts/all', { timeoutMs: 15000 });
  return rows.map((r) => ({ date: new Date(Number(r.date) * 1000).toISOString().slice(0, 10), value: r.totalCirculatingUSD?.peggedUSD ?? NaN })).filter((p) => Number.isFinite(p.value));
}

export async function stablecoinChain(chain) {
  const rows = await upstream('defillama', `https://stablecoins.llama.fi/stablecoincharts/${encodeURIComponent(chain)}`, { timeoutMs: 15000 });
  return rows.map((r) => ({ date: new Date(Number(r.date) * 1000).toISOString().slice(0, 10), value: r.totalCirculatingUSD?.peggedUSD ?? NaN })).filter((p) => Number.isFinite(p.value));
}

export async function chainTvl(chain) {
  const rows = await upstream('defillama', `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`, { timeoutMs: 15000 });
  return rows.map((r) => ({ date: new Date(r.date * 1000).toISOString().slice(0, 10), value: r.tvl }));
}

export async function dexVolume(chain) {
  const body = await upstream('defillama', `https://api.llama.fi/overview/dexs/${encodeURIComponent(chain)}?excludeTotalDataChartBreakdown=true`, { timeoutMs: 20000 });
  const series = (body.totalDataChart || []).map(([ts, v]) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), value: v }));
  const protocols = (body.protocols || []).map((p) => ({ name: p.displayName || p.name, total24h: p.total24h, change1d: p.change_1d, change7d: p.change_7d })).filter((p) => Number.isFinite(p.total24h)).sort((a, b) => b.total24h - a.total24h).slice(0, 12);
  return { series, total24h: body.total24h, total7d: body.total7d, change7d: body.change_7d, change1d: body.change_1d, protocols };
}

export async function solanaPools(kind = 'trending') {
  const path = kind === 'new' ? 'new_pools' : 'trending_pools';
  const body = await upstream('geckoterminal', `https://api.geckoterminal.com/api/v2/networks/solana/${path}?page=1`, { timeoutMs: 12000, init: { headers: { accept: 'application/json;version=20230302' } } });
  return (body.data || []).map((p) => {
    const a = p.attributes || {};
    const tx = a.transactions?.h24 || {};
    return {
      address: a.address, name: a.name,
      priceUsd: num(a.base_token_price_usd), liquidityUsd: num(a.reserve_in_usd), fdvUsd: num(a.fdv_usd), marketCapUsd: num(a.market_cap_usd),
      volume24h: num(a.volume_usd?.h24), volume1h: num(a.volume_usd?.h1),
      change1h: num(a.price_change_percentage?.h1), change24h: num(a.price_change_percentage?.h24),
      buys24h: tx.buys ?? null, sells24h: tx.sells ?? null, buyers24h: tx.buyers ?? null, sellers24h: tx.sellers ?? null,
      createdAt: a.pool_created_at || null,
      dex: p.relationships?.dex?.data?.id || null,
      url: a.address ? `https://www.geckoterminal.com/solana/pools/${a.address}` : null,
    };
  });
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export async function solanaFees(env) {
  const rpc = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const body = await upstream('solana-rpc', rpc, {
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRecentPrioritizationFees', params: [] }) },
    timeoutMs: 8000,
  });
  const fees = (body.result || []).map((r) => r.prioritizationFee).sort((a, b) => a - b);
  if (!fees.length) return null;
  const q = (p) => fees[Math.min(fees.length - 1, Math.floor(p * fees.length))];
  return { slots: fees.length, median: q(0.5), p75: q(0.75), p90: q(0.9), unit: 'micro-lamports per compute unit' };
}

// OKX perpetual swaps (public). May be unavailable from some regions.
export async function derivatives(insts = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']) {
  const out = [];
  for (const instId of insts) {
    const [fr, oi] = await Promise.all([
      upstream('okx', `https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, { retries: 1 }),
      upstream('okx', `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`, { retries: 1 }),
    ]);
    const f = fr.data?.[0] || {}, o = oi.data?.[0] || {};
    out.push({
      instId, venue: 'OKX',
      fundingRate: num(f.fundingRate), nextFundingTime: f.fundingTime ? new Date(Number(f.fundingTime)).toISOString() : null,
      openInterestUsd: num(o.oiUsd), openInterestCoin: num(o.oiCcy), ts: o.ts ? new Date(Number(o.ts)).toISOString() : null,
    });
  }
  return out;
}
