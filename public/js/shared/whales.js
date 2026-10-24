// Whale tracker analytics: classify on-chain movements, evaluate alert rules,
// compute holder concentration. Pure functions shared by the Worker and tests.
//
// Classification policy (documented in the UI):
//  * "buy"/"sell" only when the SAME transaction shows the wallet giving one asset and
//    receiving another (a swap), or an EVM router method named swap*. Everything else is
//    a transfer_in / transfer_out. A transfer is never reported as a trade.

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOLANA_QUOTES = new Set([SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
export const SOLANA_PROGRAMS = {
  '11111111111111111111111111111111': 'System Program (regular wallet)',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun bonding curve',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'PumpSwap AMM',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium CPMM',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora DLMM',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Meteora pools',
};
export const SOLANA_BURN = new Set(['1nc1nerator11111111111111111111111111111111']);

const SOL_LAMPORTS = 1e9;
const EPS = 1e-12;

// Solana: classify one jsonParsed transaction from the perspective of `wallet`.
// Uses pre/post token balances owned by the wallet and its SOL balance change.
export function classifySolanaTx(tx, wallet) {
  if (!tx?.meta || !tx.transaction) return [];
  const sig = tx.transaction.signatures?.[0];
  const ts = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  const status = tx.meta.err ? 'failed' : 'confirmed';
  const keys = (tx.transaction.message.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
  const wi = keys.indexOf(wallet);
  const fee = tx.meta.fee || 0;
  const solDelta = wi >= 0 ? (tx.meta.postBalances[wi] - tx.meta.preBalances[wi] + (wi === 0 ? fee : 0)) / SOL_LAMPORTS : 0;
  const bal = (list) => {
    const m = new Map();
    for (const b of list || []) {
      const amt = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
      const k = `${b.owner}|${b.mint}`;
      m.set(k, (m.get(k) || 0) + amt);
    }
    return m;
  };
  const pre = bal(tx.meta.preTokenBalances), post = bal(tx.meta.postTokenBalances);
  const mints = new Set([...pre.keys(), ...post.keys()].filter((k) => k.startsWith(`${wallet}|`)).map((k) => k.split('|')[1]));
  const deltas = [];
  for (const mint of mints) {
    const d = (post.get(`${wallet}|${mint}`) || 0) - (pre.get(`${wallet}|${mint}`) || 0);
    if (Math.abs(d) > EPS) deltas.push({ mint, delta: d, after: post.get(`${wallet}|${mint}`) || 0 });
  }
  // Native SOL as a quote leg (ignore dust such as fees/rent below 0.001 SOL).
  if (Math.abs(solDelta) >= 0.001) deltas.push({ mint: SOL_MINT, delta: solDelta, native: true });
  const counterpartyFor = (mint, delta) => {
    // The owner whose balance of the same mint moved the opposite way the most.
    let best = null;
    for (const k of new Set([...pre.keys(), ...post.keys()])) {
      const [owner, m] = k.split('|');
      if (m !== mint || owner === wallet) continue;
      const d = (post.get(k) || 0) - (pre.get(k) || 0);
      if (Math.sign(d) === -Math.sign(delta) && (!best || Math.abs(d) > Math.abs(best.d))) best = { owner, d };
    }
    return best?.owner || null;
  };
  const gave = deltas.filter((d) => d.delta < 0), got = deltas.filter((d) => d.delta > 0);
  const legs = [];
  for (const d of deltas) {
    if (d.native && deltas.length > 1) continue; // SOL is reported as the quote of a swap, not as its own leg
    const isQuote = SOLANA_QUOTES.has(d.mint);
    let kind;
    if (d.delta > 0) kind = gave.some((g) => g.mint !== d.mint) && !isQuote ? 'buy' : (gave.some((g) => g.mint !== d.mint) && isQuote ? 'sell_proceeds' : 'transfer_in');
    else kind = got.some((g) => g.mint !== d.mint) && !isQuote ? 'sell' : (got.some((g) => g.mint !== d.mint) && isQuote ? 'buy_payment' : 'transfer_out');
    if (kind === 'sell_proceeds' || kind === 'buy_payment') continue; // quote side of a swap already described by the other leg
    const quote = d.delta > 0 ? gave.find((g) => g.mint !== d.mint) : got.find((g) => g.mint !== d.mint);
    legs.push({
      chain: 'solana', address: wallet, tx_hash: sig, ts, status, kind, token: d.mint, amount: Math.abs(d.delta), balance_after: d.after ?? null,
      quote: quote ? { token: quote.mint, amount: Math.abs(quote.delta) } : null,
      counterparty: kind.startsWith('transfer') ? counterpartyFor(d.mint, d.delta) : null,
      explorer_url: sig ? `https://solscan.io/tx/${sig}` : null,
    });
  }
  return legs;
}

const SWAP_METHOD = /swap|exactinput|exactoutput|multicall|execute/i;

// EVM (Blockscout token-transfers): group by tx and classify per token leg.
export function classifyEvmTransfers(items, wallet, chain, explorerBase) {
  const w = wallet.toLowerCase();
  const byTx = new Map();
  for (const it of items || []) {
    const h = it.transaction_hash || it.tx_hash;
    if (!byTx.has(h)) byTx.set(h, []);
    byTx.get(h).push(it);
  }
  const legs = [];
  for (const [hash, list] of byTx) {
    const flows = list.map((it) => {
      const dec = Number(it.total?.decimals ?? it.token?.decimals ?? 18);
      const amt = Number(it.total?.value ?? 0) / 10 ** dec;
      const out = it.from?.hash?.toLowerCase() === w;
      const inn = it.to?.hash?.toLowerCase() === w;
      return { it, amt, dir: out && !inn ? -1 : inn && !out ? 1 : 0 };
    }).filter((f) => f.dir !== 0 && Number.isFinite(f.amt));
    const outs = flows.filter((f) => f.dir < 0), ins = flows.filter((f) => f.dir > 0);
    const method = list[0].method || null;
    for (const f of flows) {
      const token = f.it.token?.address_hash || f.it.token?.address;
      const other = f.dir > 0 ? outs.find((o) => (o.it.token?.address_hash || o.it.token?.address) !== token) : ins.find((o) => (o.it.token?.address_hash || o.it.token?.address) !== token);
      const viaRouter = !!method && SWAP_METHOD.test(method);
      let kind = f.dir > 0 ? 'transfer_in' : 'transfer_out';
      if (other || viaRouter) kind = f.dir > 0 ? 'buy' : 'sell';
      const cp = f.dir > 0 ? f.it.from : f.it.to;
      const price = Number(f.it.token?.exchange_rate);
      legs.push({
        chain, address: wallet, tx_hash: hash, ts: f.it.timestamp, status: 'confirmed', kind, method,
        token, token_symbol: f.it.token?.symbol || null, amount: f.amt,
        amount_usd: Number.isFinite(price) && price > 0 ? f.amt * price : null,
        quote: other ? { token: other.it.token?.address_hash || other.it.token?.address, symbol: other.it.token?.symbol, amount: other.amt } : null,
        counterparty: cp?.hash || null, counterparty_label: evmLabel(cp),
        log_index: f.it.log_index ?? null,
        explorer_url: explorerBase ? `${explorerBase}/tx/${hash}` : null,
      });
    }
  }
  return legs;
}

// Label an EVM address only from explorer-provided evidence (public tags / verified names).
export function evmLabel(a) {
  if (!a) return null;
  const tags = a.metadata?.tags || [];
  const named = tags.find((t) => t.tagType === 'name');
  if (named) return named.name;
  const generic = tags.find((t) => ['exchange', 'cex', 'dex'].includes(t.slug));
  if (generic) return generic.name;
  if (a.name) return a.is_contract ? `${a.name} (contract)` : a.name;
  if (a.hash?.toLowerCase() === '0x000000000000000000000000000000000000dead' || /^0x0{40}$/i.test(a.hash || '')) return 'Burn address';
  return a.is_contract ? 'Contract' : null;
}

export const isExchangeLabel = (label) => !!label && /\b(binance|coinbase|kraken|okx|bybit|bitfinex|kucoin|gate|htx|huobi|crypto\.com|bitget|mexc|upbit|exchange|hot wallet)\b/i.test(label);

export const eventId = (e) => `${e.chain}:${e.tx_hash}:${e.address.toLowerCase()}:${e.token || 'native'}:${e.kind}:${e.log_index ?? 0}`;

// Concentration of supply among the listed holders (denominator = total supply given).
export function concentration(holders, totalSupply) {
  if (!Number.isFinite(totalSupply) || totalSupply <= 0) return null;
  const sorted = [...holders].sort((a, b) => b.amount - a.amount);
  const sum = (n) => sorted.slice(0, n).reduce((a, h) => a + h.amount, 0) / totalSupply * 100;
  const shares = sorted.map((h) => h.amount / totalSupply);
  const hhi = shares.reduce((a, s) => a + (s * 100) ** 2, 0); // over listed holders only
  return { top1: sum(1), top5: sum(5), top10: sum(10), top20: sum(20), listed: sorted.length, hhiListed: Math.round(hhi) };
}

export const RULE_TYPES = ['buy', 'sell', 'transfer_in', 'transfer_out', 'any_move', 'large_move', 'balance_pct', 'counterparty', 'exchange_flow', 'repeated'];

// Evaluate a rule against one classified event. `recent` = same wallet's events in the
// rule window (for "repeated"). Returns { match, summary } — summary in EN/ES.
export function evaluateRule(rule, ev, recent = []) {
  if (!rule.enabled) return { match: false };
  if (rule.token && ev.token && rule.token.toLowerCase() !== ev.token.toLowerCase()) return { match: false };
  if (rule.token && !ev.token) return { match: false };
  const amountOk = (rule.min_amount == null || ev.amount >= rule.min_amount) && (rule.min_usd == null || (ev.amount_usd != null && ev.amount_usd >= rule.min_usd));
  const sym = ev.token_symbol || (ev.token ? `${ev.token.slice(0, 4)}…${ev.token.slice(-4)}` : 'native');
  const amt = `${fmtAmt(ev.amount)} ${sym}${ev.amount_usd != null ? ` (~$${fmtAmt(ev.amount_usd)})` : ''}`;
  const KIND = { buy: ['bought', 'compró'], sell: ['sold', 'vendió'], transfer_in: ['received', 'recibió'], transfer_out: ['sent', 'envió'] }[ev.kind] || ['moved', 'movió'];
  const base = { en: `${KIND[0]} ${amt}`, es: `${KIND[1]} ${amt}` };
  let match = false, extra = null;
  switch (rule.type) {
    case 'buy': case 'sell': case 'transfer_in': case 'transfer_out': match = ev.kind === rule.type && amountOk; break;
    case 'any_move': match = amountOk; break;
    case 'large_move': match = (rule.min_amount != null || rule.min_usd != null) && amountOk; break;
    case 'balance_pct': {
      const after = ev.balance_after, before = after == null ? null : ev.kind === 'buy' || ev.kind === 'transfer_in' ? after - ev.amount : after + ev.amount;
      if (before != null && before > 0 && rule.pct != null) {
        const p = ((after - before) / before) * 100;
        match = Math.abs(p) >= rule.pct;
        extra = { en: `balance ${p > 0 ? '+' : ''}${p.toFixed(1)}%`, es: `saldo ${p > 0 ? '+' : ''}${p.toFixed(1)}%` };
      } else if (before === 0 && after > 0 && rule.pct != null) { match = true; extra = { en: 'new position', es: 'posición nueva' }; }
      break;
    }
    case 'counterparty': match = !!rule.counterparty && !!ev.counterparty && rule.counterparty.toLowerCase() === ev.counterparty.toLowerCase() && amountOk; break;
    case 'exchange_flow': match = isExchangeLabel(ev.counterparty_label) && amountOk;
      if (match) extra = { en: `${ev.kind === 'transfer_out' || ev.kind === 'sell' ? 'to' : 'from'} ${ev.counterparty_label}`, es: `${ev.kind === 'transfer_out' || ev.kind === 'sell' ? 'hacia' : 'desde'} ${ev.counterparty_label}` }; break;
    case 'repeated': {
      const n = recent.filter((r) => (!rule.token || r.token === ev.token)).length;
      match = n >= (rule.min_count || 3);
      extra = { en: `${n} moves in ${rule.window_min || 60} min`, es: `${n} movimientos en ${rule.window_min || 60} min` };
      break;
    }
    default: match = false;
  }
  if (!match) return { match: false };
  return { match: true, summary: { en: [base.en, extra?.en].filter(Boolean).join(' · '), es: [base.es, extra?.es].filter(Boolean).join(' · ') } };
}

export function fmtAmt(v) {
  if (!Number.isFinite(v)) return '?';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

// Validate addresses before touching any provider.
export const isEvmAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || '');
export const isSolanaAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');

// Rebuild balance history backwards from the current balance and a list of signed deltas
// (newest first). Returns points oldest → newest.
export function balanceHistory(current, events) {
  const pts = [];
  let bal = current;
  for (const e of events) {
    pts.push({ date: e.ts, value: bal });
    bal -= e.kind === 'buy' || e.kind === 'transfer_in' ? e.amount : -e.amount;
  }
  if (events.length) pts.push({ date: events.at(-1).ts, value: Math.max(0, bal), start: true });
  return pts.reverse();
}
