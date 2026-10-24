// Quantum Lab — whale tracker data service: universal search, asset card, holder
// ranking, wallet view and balance history. Every number comes from a named provider;
// unsupported cases return an explicit limitation instead of filler data.

import { cached } from '../lib/core.js';
import { onchain } from '../adapters/crypto.js';
import { EVM_CHAINS, CG_PLATFORM_TO_CHAIN, bs, solRpc, tokenPrices, secTickers, secSubmissions } from '../adapters/chains.js';
import { classifySolanaTx, classifyEvmTransfers, evmLabel, concentration, balanceHistory, isEvmAddress, isSolanaAddress, SOLANA_PROGRAMS, SOLANA_BURN } from '../../public/js/shared/whales.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const units = (raw, dec) => Number(raw) / 10 ** Number(dec || 0);

// ---------------- SEARCH ----------------
export async function search(env, q) {
  q = String(q || '').trim();
  if (q.length < 2 || q.length > 80) throw bad('Query must be 2–80 characters');
  const out = [];
  const errors = [];
  if (isEvmAddress(q)) {
    const res = await Promise.allSettled(Object.keys(EVM_CHAINS).map(async (chain) => {
      try {
        const t = await bs(chain, `/api/v2/tokens/${q}`);
        if (t?.symbol || t?.name) return { kind: 'token', chain, address: q, symbol: t.symbol, name: t.name, image: t.icon_url, source: 'Blockscout', holders: num(t.holders_count) };
      } catch { /* not a token on this chain */ }
      const a = await bs(chain, `/api/v2/addresses/${q}`).catch(() => null);
      if (a && (Number(a.coin_balance) > 0 || a.has_token_transfers === true || a.has_tokens === true)) return { kind: 'wallet', chain, address: q, name: evmLabel(a) || null, source: 'Blockscout' };
      return null;
    }));
    res.forEach((r) => { if (r.status === 'fulfilled' && r.value) out.push(r.value); });
  } else if (isSolanaAddress(q)) {
    try {
      const body = await onchain(env, `/networks/solana/tokens/${q}`);
      const a = body.data?.attributes;
      if (a?.symbol) out.push({ kind: 'token', chain: 'solana', address: q, symbol: a.symbol, name: a.name, image: a.image_url, source: 'GeckoTerminal' });
    } catch { /* not a known token */ }
    if (!out.length) out.push({ kind: 'wallet', chain: 'solana', address: q, name: null, source: 'address format' });
  } else {
    const [cg, pools, sec] = await Promise.allSettled([
      cached(env, `cg:search:${q.toLowerCase()}`, 600, () => import('../adapters/crypto.js').then((m) => m.cgSearch(env, q))),
      cached(env, `gt:search:${q.toLowerCase()}`, 300, () => onchain(env, `/search/pools?query=${encodeURIComponent(q)}&network=solana&include=base_token`)),
      secTickers(env),
    ]);
    if (cg.status === 'fulfilled') for (const c of cg.value.value.slice(0, 8)) out.push({ kind: 'coin', id: c.id, symbol: c.symbol, name: c.name, image: c.thumb, rank: c.market_cap_rank, source: 'CoinGecko' });
    else errors.push(`CoinGecko: ${cg.reason?.message}`);
    if (pools.status === 'fulfilled') {
      const inc = Object.fromEntries((pools.value.value.included || []).map((t) => [t.id, t.attributes]));
      const seen = new Set();
      for (const p of pools.value.value.data || []) {
        const id = p.relationships?.base_token?.data?.id; const t = inc[id];
        if (!t || seen.has(t.address)) continue; seen.add(t.address);
        out.push({ kind: 'token', chain: 'solana', address: t.address, symbol: t.symbol, name: t.name, image: t.image_url, source: 'GeckoTerminal', liquidityUsd: num(p.attributes?.reserve_in_usd) });
        if (seen.size >= 6) break;
      }
    } else errors.push(`GeckoTerminal: ${pools.reason?.message}`);
    if (sec.status === 'fulfilled') {
      const U = q.toUpperCase();
      const hits = sec.value.filter((s) => s.ticker === U).concat(sec.value.filter((s) => s.ticker !== U && (s.ticker.startsWith(U) || s.name.toUpperCase().includes(U))).slice(0, 4));
      for (const s of hits.slice(0, 5)) out.push({ kind: 'stock', cik: s.cik, symbol: s.ticker, name: s.name, source: 'SEC EDGAR' });
    } else errors.push(`SEC: ${sec.reason?.message}`);
  }
  return { query: q, results: out, errors, ambiguous: out.length > 1 };
}

// ---------------- ASSET CARD ----------------
export async function asset(env, p) {
  if (p.kind === 'coin') {
    const r = await cached(env, `cg:coin:${p.id}`, 600, () => import('../adapters/crypto.js').then((m) => m.cgCoin(env, p.id)));
    const c = r.value;
    const deployments = Object.entries(c.platforms || {}).filter(([pl, addr]) => addr && CG_PLATFORM_TO_CHAIN[pl]).map(([pl, addr]) => ({ chain: CG_PLATFORM_TO_CHAIN[pl], address: addr }));
    const unsupported = Object.entries(c.platforms || {}).filter(([pl, addr]) => addr && pl && !CG_PLATFORM_TO_CHAIN[pl]).map(([pl]) => pl);
    const native = { bitcoin: null, ethereum: 'ethereum', solana: 'solana', 'matic-network': 'polygon', 'polygon-ecosystem-token': 'polygon' }[c.id];
    return {
      kind: 'coin', id: c.id, symbol: c.symbol?.toUpperCase(), name: c.name, image: c.image?.small,
      priceUsd: c.market_data?.current_price?.usd ?? null, marketCapUsd: c.market_data?.market_cap?.usd ?? null,
      circulatingSupply: c.market_data?.circulating_supply ?? null, totalSupply: c.market_data?.total_supply ?? null,
      change24h: c.market_data?.price_change_percentage_24h ?? null,
      deployments, unsupportedPlatforms: unsupported, nativeChain: native,
      limitation: !deployments.length && !native ? (c.id === 'bitcoin'
        ? 'Bitcoin has no token contract and no keyless rich-list provider is integrated (UTXO model). Holder ranking unavailable.'
        : 'No contract on a supported chain (Ethereum, Base, Arbitrum, Optimism, Polygon, Solana).') : null,
      source: 'CoinGecko', sourceUrl: `https://www.coingecko.com/en/coins/${c.id}`, lastUpdated: c.last_updated || null,
    };
  }
  if (p.kind === 'stock') {
    const sub = await secSubmissions(env, p.cik);
    const r = sub.filings?.recent || {};
    const HOLDER_FORMS = /^(SC 13D|SC 13G|SCHEDULE 13D|SCHEDULE 13G|3|4|5)(\/A)?$/;
    const filings = [];
    for (let i = 0; i < (r.form || []).length && filings.length < 40; i++) {
      if (!HOLDER_FORMS.test(r.form[i])) continue;
      filings.push({ form: r.form[i], filed: r.filingDate[i], reportDate: r.reportDate?.[i] || null, accession: r.accessionNumber[i],
        url: `https://www.sec.gov/Archives/edgar/data/${Number(p.cik)}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}` });
    }
    return {
      kind: 'stock', cik: p.cik, symbol: (sub.tickers || [])[0] || null, name: sub.name, exchanges: sub.exchanges || [], sic: sub.sicDescription || null,
      holderFilings: filings,
      limitation: 'Shareholders are not wallets. This view lists official SEC filings about beneficial owners (>5%, Schedules 13D/13G) and insiders (Forms 3/4/5). Full institutional holdings (13F) and share prices need a licensed data provider and are not integrated.',
      source: 'SEC EDGAR', sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${p.cik}`,
    };
  }
  if (p.kind === 'token') {
    if (p.chain === 'solana') {
      const body = await onchain(env, `/networks/solana/tokens/${p.address}`);
      const a = body.data?.attributes || {};
      return { kind: 'token', chain: 'solana', address: p.address, symbol: a.symbol, name: a.name, image: a.image_url, decimals: a.decimals,
        priceUsd: num(a.price_usd), marketCapUsd: num(a.market_cap_usd), fdvUsd: num(a.fdv_usd), totalSupply: a.normalized_total_supply ? Number(a.normalized_total_supply) : null,
        volume24h: num(a.volume_usd?.h24), source: 'GeckoTerminal', sourceUrl: `https://www.geckoterminal.com/solana/tokens/${p.address}`, explorerUrl: `https://solscan.io/token/${p.address}` };
    }
    const t = await bs(p.chain, `/api/v2/tokens/${p.address}`);
    return { kind: 'token', chain: p.chain, address: p.address, symbol: t.symbol, name: t.name, image: t.icon_url, decimals: num(t.decimals),
      priceUsd: num(t.exchange_rate), marketCapUsd: num(t.circulating_market_cap), totalSupply: t.total_supply ? units(t.total_supply, t.decimals) : null,
      holdersCount: num(t.holders_count), volume24h: num(t.volume_24h), source: 'Blockscout', sourceUrl: `${EVM_CHAINS[p.chain].explorer}/token/${p.address}`, explorerUrl: `${EVM_CHAINS[p.chain].explorer}/token/${p.address}` };
  }
  throw bad('Unknown asset kind');
}

// ---------------- HOLDERS ----------------
export async function holders(env, { chain, address, native }) {
  const fetchedAt = new Date().toISOString();
  if (chain === 'solana') return solanaHolders(env, address, fetchedAt);
  if (!EVM_CHAINS[chain]) throw bad('Unsupported chain');
  const c = EVM_CHAINS[chain];
  if (native) {
    const r = await cached(env, `bs:top:${chain}`, 600, () => bs(chain, '/api/v2/addresses'));
    const items = r.value.items || [];
    return {
      chain, native: true, symbol: c.native, denominator: null, denominatorLabel: 'Native coin: percentages not shown (no reliable total supply from this source)',
      holders: items.slice(0, 50).map((i, k) => ({ rank: k + 1, address: i.hash, amount: units(i.coin_balance, 18), pct: null, label: evmLabel(i), isContract: !!i.is_contract })),
      source: 'Blockscout (top accounts)', sourceUrl: `${c.explorer}/accounts`, fetchedAt: new Date(r.cachedAt).toISOString(),
    };
  }
  const [t, h] = await Promise.all([
    cached(env, `bs:tok:${chain}:${address}`, 300, () => bs(chain, `/api/v2/tokens/${address}`)),
    cached(env, `bs:holders:${chain}:${address}`, 300, () => bs(chain, `/api/v2/tokens/${address}/holders`)),
  ]);
  const tok = t.value, dec = tok.decimals;
  const total = tok.total_supply ? units(tok.total_supply, dec) : null;
  const price = num(tok.exchange_rate);
  const list = (h.value.items || []).map((i, k) => {
    const amount = units(i.value, dec);
    return { rank: k + 1, address: i.address.hash, amount, pct: total ? (amount / total) * 100 : null, valueUsd: price ? amount * price : null,
      label: evmLabel(i.address), isContract: !!i.address.is_contract, isScam: !!i.address.is_scam };
  });
  return {
    chain, token: address, symbol: tok.symbol, decimals: num(dec), priceUsd: price, totalSupply: total,
    denominator: total, denominatorLabel: 'total supply (on-chain totalSupply)', holdersCount: num(tok.holders_count),
    holders: list, concentration: concentration(list, total),
    labelsNote: 'Labels come only from Blockscout public tags / verified contract names. Unlabeled addresses are not identified.',
    source: 'Blockscout', sourceUrl: `${c.explorer}/token/${address}?tab=holders`, fetchedAt: new Date(h.cachedAt).toISOString(),
  };
}

async function solanaHolders(env, mint, fetchedAt) {
  const r = await cached(env, `sol:holders:${mint}`, 300, async () => {
    const [largest, supply] = await Promise.all([solRpc(env, 'getTokenLargestAccounts', [mint]), solRpc(env, 'getTokenSupply', [mint])]);
    const accts = largest.value || [];
    const parsed = await solRpc(env, 'getMultipleAccounts', [accts.map((a) => a.address), { encoding: 'jsonParsed' }]);
    const owners = parsed.value.map((v) => v?.data?.parsed?.info?.owner || null);
    const uniqOwners = [...new Set(owners.filter(Boolean))];
    const ownerInfo = uniqOwners.length ? await solRpc(env, 'getMultipleAccounts', [uniqOwners, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]) : { value: [] };
    const ownerProgram = Object.fromEntries(uniqOwners.map((o, i) => [o, ownerInfo.value[i]?.owner || null]));
    return { accts, owners, ownerProgram, supply: supply.value };
  });
  const { accts, owners, ownerProgram, supply } = r.value;
  const total = Number(supply.uiAmountString ?? supply.uiAmount);
  let price = null;
  try { price = (await tokenPrices(env, 'solana', [mint]))[mint.toLowerCase()] ?? null; } catch { /* price optional */ }
  const list = accts.map((a, k) => {
    const owner = owners[k];
    const prog = ownerProgram[owner];
    const amount = Number(a.uiAmountString ?? a.uiAmount);
    let label = null;
    if (SOLANA_BURN.has(owner)) label = 'Burn address';
    else if (prog && prog !== '11111111111111111111111111111111') label = SOLANA_PROGRAMS[prog] ? `${SOLANA_PROGRAMS[prog]} (program-owned)` : `Program-owned account (${prog.slice(0, 4)}…${prog.slice(-4)})`;
    return { rank: k + 1, address: owner || a.address, tokenAccount: a.address, amount, pct: total ? (amount / total) * 100 : null, valueUsd: price ? amount * price : null, label, isContract: !!label && !/Burn/.test(label) };
  });
  return {
    chain: 'solana', token: mint, priceUsd: price, totalSupply: total, denominator: total, denominatorLabel: 'total supply (getTokenSupply)',
    holders: list, concentration: concentration(list, total),
    labelsNote: 'Ranking by token account (getTokenLargestAccounts returns the 20 largest). Owners controlled by a program (pools, bonding curves, vaults) are labelled from the on-chain owner program; other wallets are not identified.',
    source: 'Solana RPC', sourceUrl: `https://solscan.io/token/${mint}#holders`, fetchedAt: new Date(r.cachedAt).toISOString(), rpc: env.SOLANA_RPC_URL ? 'configured' : 'public',
  };
}

// ---------------- WALLET ----------------
export async function walletActivity(env, chain, address, { limit = 25 } = {}) {
  if (chain === 'solana') {
    const sigs = await solRpc(env, 'getSignaturesForAddress', [address, { limit: Math.min(limit, 15) }]);
    const txs = [];
    for (const s of sigs) {
      const r = await cached(env, `sol:tx:${s.signature}`, 86400, () => solRpc(env, 'getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]));
      if (r.value) txs.push(...classifySolanaTx(r.value, address));
    }
    return { events: txs, cursor: sigs[0]?.signature || null, source: 'Solana RPC', latency: 'confirmed commitment, polled' };
  }
  const c = EVM_CHAINS[chain];
  if (!c) throw bad('Unsupported chain');
  const [tt, nt] = await Promise.all([
    bs(chain, `/api/v2/addresses/${address}/token-transfers?type=ERC-20`),
    bs(chain, `/api/v2/addresses/${address}/transactions`).catch(() => ({ items: [] })),
  ]);
  const legs = classifyEvmTransfers(tt.items || [], address, chain, c.explorer);
  // Native coin transfers (with on-chain status: ok / error).
  for (const tx of (nt.items || []).slice(0, 25)) {
    const v = Number(tx.value || 0) / 1e18;
    if (!(v > 0)) continue;
    const out = tx.from?.hash?.toLowerCase() === address.toLowerCase();
    const cp = out ? tx.to : tx.from;
    const price = num(tx.exchange_rate);
    legs.push({ chain, address, tx_hash: tx.hash, ts: tx.timestamp, status: tx.status === 'ok' ? 'confirmed' : tx.status === 'error' ? 'failed' : (tx.result || 'pending'),
      kind: out ? 'transfer_out' : 'transfer_in', token: null, token_symbol: c.native, amount: v, amount_usd: price ? v * price : null,
      counterparty: cp?.hash || null, counterparty_label: evmLabel(cp), method: tx.method || null, explorer_url: `${c.explorer}/tx/${tx.hash}` });
  }
  legs.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return { events: legs.slice(0, limit * 2), source: 'Blockscout', latency: 'indexed by Blockscout (typically seconds behind the chain), polled' };
}

export async function wallet(env, chain, address) {
  if (chain === 'solana') {
    if (!isSolanaAddress(address)) throw bad('Invalid Solana address');
    const [bal, toks] = await Promise.all([
      solRpc(env, 'getBalance', [address]),
      solRpc(env, 'getTokenAccountsByOwner', [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]),
    ]);
    const positions = (toks.value || []).map((a) => a.account.data.parsed.info).map((i) => ({ token: i.mint, amount: Number(i.tokenAmount.uiAmountString) })).filter((p) => p.amount > 0)
      .sort((a, b) => b.amount - a.amount).slice(0, 40);
    let prices = {};
    try { prices = await tokenPrices(env, 'solana', positions.slice(0, 25).map((p) => p.token)); } catch { /* optional */ }
    positions.forEach((p) => { const px = prices[p.token.toLowerCase()]; p.valueUsd = px ? px * p.amount : null; });
    positions.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    return { chain, address, native: { symbol: 'SOL', amount: bal.value / 1e9 }, positions, label: null, explorerUrl: `https://solscan.io/account/${address}`, source: 'Solana RPC', fetchedAt: new Date().toISOString() };
  }
  const c = EVM_CHAINS[chain];
  if (!c) throw bad('Unsupported chain');
  if (!isEvmAddress(address)) throw bad('Invalid EVM address');
  const [info, balances] = await Promise.all([bs(chain, `/api/v2/addresses/${address}`).catch(() => ({})), bs(chain, `/api/v2/addresses/${address}/token-balances`)]);
  const positions = (balances || []).filter((b) => b.token?.type === 'ERC-20').map((b) => {
    const amount = units(b.value, b.token.decimals);
    const px = num(b.token.exchange_rate);
    return { token: b.token.address_hash || b.token.address, symbol: b.token.symbol, name: b.token.name, amount, priceUsd: px, valueUsd: px ? amount * px : null };
  }).filter((p) => p.amount > 0).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1)).slice(0, 60);
  return { chain, address, native: { symbol: c.native, amount: info.coin_balance ? Number(info.coin_balance) / 1e18 : null, priceUsd: num(info.exchange_rate) },
    positions, label: evmLabel(info), isContract: !!info.is_contract, explorerUrl: `${c.explorer}/address/${address}`, source: 'Blockscout', fetchedAt: new Date().toISOString() };
}

// Balance of one token over time, rebuilt from the wallet's own classified movements.
export async function tokenHistory(env, chain, address, token) {
  if (chain === 'solana') {
    const act = await walletActivity(env, chain, address, { limit: 15 });
    const ev = act.events.filter((e) => e.token === token && e.status === 'confirmed' && e.balance_after != null);
    return { points: ev.slice().reverse().map((e) => ({ date: e.ts, value: e.balance_after })), basis: 'post-transaction token balance (exact), last 15 transactions', source: 'Solana RPC' };
  }
  const c = EVM_CHAINS[chain];
  const [bal, tt] = await Promise.all([
    bs(chain, `/api/v2/addresses/${address}/token-balances`),
    bs(chain, `/api/v2/addresses/${address}/token-transfers?type=ERC-20&token=${token}`),
  ]);
  const b = (bal || []).find((x) => (x.token?.address_hash || x.token?.address || '').toLowerCase() === token.toLowerCase());
  const current = b ? units(b.value, b.token.decimals) : 0;
  const legs = classifyEvmTransfers(tt.items || [], address, chain, c.explorer).filter((e) => (e.token || '').toLowerCase() === token.toLowerCase());
  legs.sort((x, y) => (y.ts || '').localeCompare(x.ts || ''));
  return { points: balanceHistory(current, legs), basis: `current balance minus the last ${legs.length} transfers (newest first)`, source: 'Blockscout' };
}
