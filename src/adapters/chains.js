// On-chain providers for the whale tracker.
//  * EVM chains: Blockscout public API v2 (keyless; holders, labels, transfers, balances).
//  * Solana: JSON-RPC. Public endpoints rate-limit holder queries heavily, so production
//    needs SOLANA_RPC_URL (e.g. a free Helius endpoint). Errors are surfaced, never hidden.
//  * Prices: CoinGecko /onchain (with key) or GeckoTerminal public simple token price.
//  * Stocks: SEC EDGAR (company tickers + filings). SEC requires a contact User-Agent.

import { upstream, cached } from '../lib/core.js';
import { onchain } from './crypto.js';

const UA = 'Mozilla/5.0 (compatible; NoticieroVOID/1.0; +https://github.com/sickobusiness33-cloud/NoticieroVOID)';

export const EVM_CHAINS = {
  ethereum: { name: 'Ethereum', api: 'https://eth.blockscout.com', explorer: 'https://eth.blockscout.com', cg: 'ethereum', net: 'eth', native: 'ETH' },
  base: { name: 'Base', api: 'https://base.blockscout.com', explorer: 'https://base.blockscout.com', cg: 'base', net: 'base', native: 'ETH' },
  arbitrum: { name: 'Arbitrum One', api: 'https://arbitrum.blockscout.com', explorer: 'https://arbitrum.blockscout.com', cg: 'arbitrum-one', net: 'arbitrum', native: 'ETH' },
  optimism: { name: 'Optimism', api: 'https://explorer.optimism.io', explorer: 'https://explorer.optimism.io', cg: 'optimistic-ethereum', net: 'optimism', native: 'ETH' },
  polygon: { name: 'Polygon PoS', api: 'https://polygon.blockscout.com', explorer: 'https://polygon.blockscout.com', cg: 'polygon-pos', net: 'polygon_pos', native: 'POL' },
};
export const CG_PLATFORM_TO_CHAIN = Object.fromEntries([...Object.entries(EVM_CHAINS).map(([k, v]) => [v.cg, k]), ['solana', 'solana']]);

export function bs(chain, path) {
  const c = EVM_CHAINS[chain];
  if (!c) throw Object.assign(new Error(`Unsupported chain ${chain}`), { status: 400 });
  return upstream(`blockscout:${chain}`, c.api + path, { timeoutMs: 15000, retries: 1, init: { headers: { 'user-agent': UA } } });
}

// ---------- Solana JSON-RPC ----------
export async function solRpc(env, method, params) {
  const url = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const body = await upstream('solana-rpc', url, {
    timeoutMs: 15000, retries: 1,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) },
  }).catch((e) => {
    if (!env.SOLANA_RPC_URL) throw Object.assign(new Error(`${e.message} — the public Solana RPC blocks this request. Configure SOLANA_RPC_URL (e.g. a free Helius endpoint) to enable Solana holders and wallets.`), { status: 503, code: 'solana_rpc_required' });
    throw e;
  });
  if (body.error) {
    const hint = env.SOLANA_RPC_URL ? '' : ' (public RPC limits this call; set SOLANA_RPC_URL to a dedicated endpoint such as Helius)';
    throw Object.assign(new Error(`Solana RPC ${method}: ${body.error.message || body.error.code}${hint}`), { status: 502, provider: 'solana-rpc' });
  }
  return body.result;
}

export const solanaRpcConfigured = (env) => !!env.SOLANA_RPC_URL;

// Token price in USD from on-chain DEX data (null when unknown — never guessed).
export async function tokenPrices(env, network, addresses) {
  if (!addresses.length) return {};
  const r = await cached(env, `px:${network}:${addresses.slice().sort().join(',')}`, 120, async () => {
    const body = await onchain(env, `/simple/networks/${network}/token_price/${addresses.join(',')}`);
    const prices = body.data?.attributes?.token_prices || {};
    return Object.fromEntries(Object.entries(prices).map(([k, v]) => [k.toLowerCase(), v === null ? null : Number(v)]));
  });
  return r.value;
}

// ---------- SEC EDGAR ----------
function secUA(env) {
  if (!env.SEC_USER_AGENT) throw Object.assign(new Error('SEC EDGAR requires SEC_USER_AGENT (e.g. "NoticieroVOID you@yourdomain.com"); not configured.'), { status: 503, code: 'sec_not_configured' });
  return env.SEC_USER_AGENT;
}
export async function secTickers(env) {
  const ua = secUA(env);
  const r = await cached(env, 'sec:tickers', 24 * 3600, async () => {
    const body = await upstream('sec', 'https://www.sec.gov/files/company_tickers.json', { timeoutMs: 20000, init: { headers: { 'user-agent': ua } } });
    return Object.values(body).map((x) => ({ cik: String(x.cik_str).padStart(10, '0'), ticker: x.ticker, name: x.title }));
  });
  return r.value;
}
export async function secSubmissions(env, cik) {
  const ua = secUA(env);
  const r = await cached(env, `sec:sub:${cik}`, 3600, () => upstream('sec', `https://data.sec.gov/submissions/CIK${cik}.json`, { timeoutMs: 20000, init: { headers: { 'user-agent': ua } } }));
  return r.value;
}
