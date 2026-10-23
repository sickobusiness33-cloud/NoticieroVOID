import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePool, normalizeInfo, momentum, signalsFor, riskFor, analyze, mergePools } from '../public/js/shared/memescan.js';

const NOW = Date.parse('2026-10-23T18:00:00Z');
const pool = (o = {}) => ({
  attributes: {
    address: o.address || 'POOL1', name: 'KIM / SOL', pool_created_at: o.created || '2026-10-23T17:40:00Z',
    base_token_price_usd: '0.02', fdv_usd: String(o.fdv ?? 20_000_000), market_cap_usd: o.mc ?? null, reserve_in_usd: String(o.liq ?? 900_000),
    price_change_percentage: { m5: '12', h1: String(o.h1 ?? 400), h24: '400' },
    volume_usd: { m5: String(o.v5 ?? 300_000), h1: String(o.v1h ?? 900_000), h24: '900000' },
    transactions: { m5: { buys: o.b ?? 400, sells: o.s ?? 100, buyers: o.buyers ?? 300, sellers: 80 }, h1: { buys: 2000, sells: 900, buyers: 1200, sellers: 500 } },
  },
  relationships: { base_token: { data: { id: 'solana_TOKENpump' } }, dex: { data: { id: 'pump-fun' } } },
});
const tokens = { solana_TOKENpump: { attributes: { symbol: 'KIM', name: 'Kimchi', image_url: 'https://assets.x/k.png' } } };

test('normalizes a GeckoTerminal pool with its token', () => {
  const r = normalizePool(pool(), tokens, NOW);
  assert.equal(r.symbol, 'KIM'); assert.equal(r.token, 'TOKENpump'); assert.equal(r.dex, 'pump-fun');
  assert.equal(r.ageMin, 20); assert.equal(r.fdvUsd, 20_000_000); assert.equal(r.tx.m5.buyers, 300);
});

test('a fast launch triggers rocket, surge, buy pressure and breakout signals', () => {
  const r = normalizePool(pool(), tokens, NOW);
  const keys = signalsFor(r).map((s) => s.key);
  assert.deepEqual(keys.sort(), ['BREAKOUT', 'BUY_PRESSURE', 'ROCKET_LAUNCH', 'VOLUME_SURGE']);
  const rocket = signalsFor(r).find((s) => s.key === 'ROCKET_LAUNCH');
  assert.match(rocket.reason.es, /20\.00M/);
  assert.ok(momentum(r).score > 70);
});

test('quiet pool has no signals and a low score', () => {
  const r = normalizePool(pool({ fdv: 5000, liq: 3000, v5: 20, v1h: 300, b: 2, s: 2, buyers: 2, h1: 1 }), tokens, NOW);
  assert.deepEqual(signalsFor(r), []);
  assert.ok(momentum(r).score < 25);
});

test('risk: mint authority is EXTREME; missing checks never mean safe', () => {
  const r = normalizePool(pool(), tokens, NOW);
  r.info = normalizeInfo({ mint_authority: 'yes', freeze_authority: 'no', is_honeypot: 'no', developer_holding_percentage: '0', twitter_handle: 'x' });
  assert.equal(riskFor(r).level, 'EXTREME');
  const clean = normalizePool(pool({ created: '2026-10-20T00:00:00Z' }), tokens, NOW);
  clean.info = normalizeInfo({ mint_authority: 'no', freeze_authority: 'no', is_honeypot: 'no', developer_holding_percentage: '0', gt_score: 80, twitter_handle: 'x', holders: { distribution_percentage: { top_10: '20' } } });
  assert.equal(riskFor(clean).level, 'MODERATE');
  const unknown = normalizePool(pool({ created: '2026-10-20T00:00:00Z' }), tokens, NOW);
  assert.notEqual(riskFor(unknown).level, 'LOW');
  assert.ok(riskFor(unknown).flags.some((f) => /not loaded/.test(f.en)));
});

test('near-graduation signal uses launchpad progress', () => {
  const r = normalizePool(pool({ fdv: 60_000, liq: 20_000, v5: 100, v1h: 1000, h1: 5, buyers: 3 }), tokens, NOW);
  r.info = normalizeInfo({ launchpad_details: { graduation_percentage: 91, completed: false } });
  assert.deepEqual(signalsFor(r).map((s) => s.key), ['NEAR_GRADUATION']);
});

test('merge keeps one row per pool and records every list it appeared in', () => {
  const a = normalizePool(pool(), tokens, NOW), b = normalizePool(pool({ address: 'POOL2' }), tokens, NOW);
  const m = mergePools([['new', [a]], ['trending5m', [a, b]]]);
  assert.equal(m.length, 2);
  assert.deepEqual(m.find((x) => x.pool === 'POOL1').lists, ['new', 'trending5m']);
  assert.ok(analyze(m[0]).risk && analyze(m[0]).momentum);
});

test('rocket launch ignores valuations not backed by liquidity or volume', () => {
  const fake = normalizePool(pool({ fdv: 123_000_000, liq: 15_000, v5: 2000, v1h: 8000, h1: 5, buyers: 10 }), tokens, NOW);
  assert.ok(!signalsFor(fake).some((s) => s.key === 'ROCKET_LAUNCH'));
  assert.ok(riskFor(fake).flags.some((f) => /2% of valuation/.test(f.en)));
});
