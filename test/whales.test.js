import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySolanaTx, classifyEvmTransfers, evaluateRule, concentration, eventId, balanceHistory, isEvmAddress, isSolanaAddress, evmLabel, SOL_MINT } from '../public/js/shared/whales.js';

const W = 'Wa11et1111111111111111111111111111111111111';
const OTHER = 'Other11111111111111111111111111111111111111';
const MINT = 'Mint111111111111111111111111111111111111111';
const tb = (owner, mint, amt) => ({ owner, mint, uiTokenAmount: { uiAmountString: String(amt) } });
const solTx = ({ pre = [], post = [], preSol = 10e9, postSol = 10e9, err = null } = {}) => ({
  blockTime: 1792800000,
  transaction: { signatures: ['SIG1'], message: { accountKeys: [{ pubkey: W }, { pubkey: OTHER }] } },
  meta: { err, fee: 5000, preBalances: [preSol, 0], postBalances: [postSol - 5000, 0], preTokenBalances: pre, postTokenBalances: post },
});

test('solana: token received while paying SOL in the same tx is a buy', () => {
  const legs = classifySolanaTx(solTx({ pre: [tb(W, MINT, 0), tb(OTHER, MINT, 1000)], post: [tb(W, MINT, 500), tb(OTHER, MINT, 500)], postSol: 8e9 }), W);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].kind, 'buy'); assert.equal(legs[0].amount, 500);
  assert.equal(legs[0].quote.token, SOL_MINT); assert.ok(Math.abs(legs[0].quote.amount - 2) < 1e-9);
  assert.equal(legs[0].status, 'confirmed'); assert.equal(legs[0].explorer_url, 'https://solscan.io/tx/SIG1');
});

test('solana: token leaving with SOL coming back is a sell', () => {
  const legs = classifySolanaTx(solTx({ pre: [tb(W, MINT, 500)], post: [tb(W, MINT, 100)], postSol: 13e9 }), W);
  assert.deepEqual(legs.map((l) => [l.kind, l.amount, l.balance_after]), [['sell', 400, 100]]);
});

test('solana: a plain transfer is never reported as a trade, and names the counterparty', () => {
  const legs = classifySolanaTx(solTx({ pre: [tb(W, MINT, 500), tb(OTHER, MINT, 0)], post: [tb(W, MINT, 200), tb(OTHER, MINT, 300)] }), W);
  assert.equal(legs[0].kind, 'transfer_out'); assert.equal(legs[0].counterparty, OTHER);
});

test('solana: failed transactions keep status failed', () => {
  const legs = classifySolanaTx(solTx({ pre: [tb(W, MINT, 1)], post: [tb(W, MINT, 2)], err: { InstructionError: [0, 'Custom'] } }), W);
  assert.equal(legs[0].status, 'failed');
});

const evm = (o) => ({ transaction_hash: o.h || '0xT1', timestamp: '2026-10-23T10:00:00Z', method: o.method ?? null, log_index: o.li ?? 0,
  from: { hash: o.from }, to: { hash: o.to, metadata: o.toTags ? { tags: o.toTags } : undefined }, token: { address_hash: o.token, symbol: o.sym, decimals: '18', exchange_rate: o.px ?? null }, total: { value: String(o.v * 1e18), decimals: '18' } });
const ME = '0x1111111111111111111111111111111111111111', POOL = '0x2222222222222222222222222222222222222222';

test('evm: two legs in one tx → buy and sell; lone transfer stays a transfer', () => {
  const legs = classifyEvmTransfers([
    evm({ from: ME, to: POOL, token: '0xUSDC', sym: 'USDC', v: 1000, px: '1' }),
    evm({ from: POOL, to: ME, token: '0xPEPE', sym: 'PEPE', v: 5e6, li: 1 }),
    evm({ h: '0xT2', from: ME, to: '0x3333333333333333333333333333333333333333', token: '0xPEPE', sym: 'PEPE', v: 10, toTags: [{ tagType: 'name', name: 'Binance: Hot Wallet 20' }] }),
  ], ME, 'ethereum', 'https://eth.blockscout.com');
  assert.deepEqual(legs.map((l) => [l.tx_hash, l.kind, l.token_symbol]), [['0xT1', 'sell', 'USDC'], ['0xT1', 'buy', 'PEPE'], ['0xT2', 'transfer_out', 'PEPE']]);
  assert.equal(legs[0].amount_usd, 1000);
  assert.equal(legs[2].counterparty_label, 'Binance: Hot Wallet 20');
  assert.equal(legs[2].explorer_url, 'https://eth.blockscout.com/tx/0xT2');
});

test('evm labels only come from explorer evidence', () => {
  assert.equal(evmLabel({ hash: '0xabc', is_contract: false }), null);
  assert.equal(evmLabel({ hash: '0xabc', is_contract: true }), 'Contract');
  assert.equal(evmLabel({ hash: '0x000000000000000000000000000000000000dEaD' }), 'Burn address');
});

test('rules: type, thresholds, token filter, exchange flow, balance %, repeated', () => {
  const ev = { chain: 'ethereum', address: ME, tx_hash: '0xT', kind: 'transfer_out', token: '0xPEPE', token_symbol: 'PEPE', amount: 1e6, amount_usd: 12000, counterparty: '0xabc', counterparty_label: 'Binance: Hot Wallet 20', balance_after: 1e6 };
  const r = (o) => ({ enabled: 1, type: 'any_move', ...o });
  assert.equal(evaluateRule(r({ type: 'buy' }), ev).match, false);
  assert.equal(evaluateRule(r({ type: 'transfer_out' }), ev).match, true);
  assert.equal(evaluateRule(r({ min_usd: 20000 }), ev).match, false);
  assert.equal(evaluateRule(r({ min_usd: 10000 }), ev).match, true);
  assert.equal(evaluateRule(r({ token: '0xOTHER' }), ev).match, false);
  assert.equal(evaluateRule(r({ type: 'large_move' }), ev).match, false, 'large_move needs a threshold');
  const ex = evaluateRule(r({ type: 'exchange_flow' }), ev);
  assert.equal(ex.match, true); assert.match(ex.summary.es, /hacia Binance/);
  const pct = evaluateRule(r({ type: 'balance_pct', pct: 40 }), ev); // 2M → 1M = −50%
  assert.equal(pct.match, true); assert.match(pct.summary.en, /-50\.0%/);
  assert.equal(evaluateRule(r({ type: 'counterparty', counterparty: '0xABC' }), ev).match, true);
  assert.equal(evaluateRule(r({ type: 'repeated', min_count: 3, window_min: 60 }), ev, [ev, ev]).match, false);
  assert.equal(evaluateRule(r({ type: 'repeated', min_count: 3, window_min: 60 }), ev, [ev, ev, ev]).match, true);
  assert.equal(evaluateRule({ ...r({}), enabled: 0 }, ev).match, false);
});

test('event ids are stable for de-duplication', () => {
  const e = { chain: 'solana', tx_hash: 'SIG', address: W, token: MINT, kind: 'buy' };
  assert.equal(eventId(e), eventId({ ...e }));
  assert.notEqual(eventId(e), eventId({ ...e, kind: 'sell' }));
});

test('concentration uses the stated total supply as denominator', () => {
  const c = concentration([{ amount: 50 }, { amount: 30 }, { amount: 10 }], 200);
  assert.equal(c.top1, 25); assert.equal(c.top5, 45); assert.equal(concentration([], 0), null);
});

test('balance history rebuilt backwards from current balance', () => {
  const pts = balanceHistory(100, [{ ts: 't3', kind: 'buy', amount: 40 }, { ts: 't2', kind: 'transfer_out', amount: 10 }]);
  // Before t2: 70 → after transfer_out of 10: 60 → after buy of 40: 100 (current).
  assert.deepEqual(pts.map((p) => p.value), [70, 60, 100]);
});

test('address validation', () => {
  assert.ok(isEvmAddress(ME)); assert.ok(!isEvmAddress('0x123'));
  assert.ok(isSolanaAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263')); assert.ok(!isSolanaAddress('0OIl'));
});
