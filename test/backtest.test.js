import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, rsi, signals, runBacktest, maxDrawdown, walkForward, applyMacroFilter } from '../public/js/shared/backtest.js';

const series = (vals, start = Date.parse('2023-01-01')) => vals.map((v, i) => ({ date: new Date(start + i * 86400000).toISOString().slice(0, 10), value: v }));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma', () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(s[1])); close(s[2], 2); close(s[4], 4);
});

test('rsi bounds and monotonic series', () => {
  const up = rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14);
  close(up[29], 100);
  const r = rsi(Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 3)), 14);
  r.filter(Number.isFinite).forEach((v) => assert.ok(v >= 0 && v <= 100));
});

test('signals are causal: changing future prices never changes past signals', () => {
  const base = Array.from({ length: 200 }, (_, i) => 100 + 20 * Math.sin(i / 9) + i * 0.1);
  for (const [type, p] of [['sma_cross', { fast: 10, slow: 30 }], ['rsi_reversion', { period: 14, entry: 30, exit: 55 }], ['momentum', { lookback: 20 }], ['breakout', { lookback: 20 }]]) {
    const a = signals(base, type, p);
    const mutated = base.slice(); for (let i = 150; i < 200; i++) mutated[i] *= 3;
    const b = signals(mutated, type, p);
    assert.deepEqual(a.slice(0, 150), b.slice(0, 150), `${type} leaked future data`);
  }
});

test('position decided at close t earns return t+1 (no same-bar fill)', () => {
  // Price doubles on bar 31 (index 31). A momentum signal that turns on at bar 31
  // because of that jump must NOT capture the jump itself.
  const vals = Array.from({ length: 40 }, (_, i) => (i < 31 ? 100 : 200));
  const r = runBacktest(series(vals), { type: 'momentum', params: { lookback: 5 } }, { costBps: 0, slippageBps: 0 });
  close(r.metrics.totalReturn, 0);
});

test('buy & hold equals benchmark before costs; costs reduce return', () => {
  const vals = Array.from({ length: 100 }, (_, i) => 100 * 1.01 ** i);
  const free = runBacktest(series(vals), { type: 'buy_hold' }, { costBps: 0, slippageBps: 0 });
  close(free.metrics.totalReturn, free.benchmark.totalReturn, 1e-9);
  const costly = runBacktest(series(vals), { type: 'buy_hold' }, { costBps: 50, slippageBps: 50 });
  assert.ok(costly.metrics.totalReturn < free.metrics.totalReturn);
  // One entry fill at bar 1: return of that bar is (1.01 - 0.01) instead of 1.01.
  close((1 + costly.metrics.totalReturn) / (1 + free.metrics.totalReturn), (1.01 - 0.01) / 1.01, 1e-9);
});

test('annualized return withheld for samples shorter than a year', () => {
  const r = runBacktest(series(Array.from({ length: 100 }, (_, i) => 100 + i)), { type: 'buy_hold' }, {});
  assert.equal(r.metrics.annualizedReturn, null);
});

test('max drawdown', () => {
  close(maxDrawdown([1, 1.5, 0.75, 1.2]), -0.5);
});

test('rejects tiny samples and invalid params', () => {
  assert.throws(() => runBacktest(series([1, 2, 3]), { type: 'buy_hold' }));
  assert.throws(() => signals([1, 2, 3], 'sma_cross', { fast: 50, slow: 20 }));
});

test('walk-forward produces only out-of-sample returns after first training window', () => {
  const vals = Array.from({ length: 400 }, (_, i) => 100 + 15 * Math.sin(i / 11) + i * 0.05);
  const wf = walkForward(series(vals), 'momentum', { trainBars: 120, testBars: 40, grid: { lookback: [10, 20] } });
  assert.ok(wf.folds.length >= 6);
  for (const f of wf.folds) assert.ok(f.testStart > f.trainEnd, 'test window must follow training window');
  assert.equal(wf.kind, 'WALK_FORWARD_OUT_OF_SAMPLE');
});

test('macro filter honours publication lag', () => {
  const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
  const filter = { series: [{ date: '2024-01-01', value: 1 }, { date: '2024-01-02', value: 1 }, { date: '2024-01-03', value: 1 }], publicationLagDays: 2, period: 1, rule: 'above_sma' };
  // Observation of 01-01 is only usable from 01-03; before that the filter must block exposure.
  const { pos } = applyMacroFilter(dates, [1, 1, 1], filter);
  assert.deepEqual(pos.slice(0, 2), [0, 0]);
});
