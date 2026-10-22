import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, std, pearson, pctReturns, alignByDate, forwardFill, rollingCorrelation, crossCorrelation, conditionalReturns, eventStudy, yoy } from '../public/js/shared/stats.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('mean and sample std', () => {
  close(mean([1, 2, 3, 4]), 2.5);
  close(std([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395);
  assert.ok(Number.isNaN(std([1])));
});

test('pearson: perfect, inverse, constant', () => {
  close(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  close(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.ok(Number.isNaN(pearson([1, 1, 1], [1, 2, 3])));
});

test('pctReturns', () => {
  const r = pctReturns([{ date: 'a', value: 100 }, { date: 'b', value: 110 }, { date: 'c', value: 99 }]);
  close(r[0].value, 0.1); close(r[1].value, -0.1);
});

test('alignByDate drops unmatched dates, never interpolates', () => {
  const a = [{ date: '2024-01-01', value: 1 }, { date: '2024-01-02', value: 2 }, { date: '2024-01-03', value: 3 }];
  const b = [{ date: '2024-01-01', value: 10 }, { date: '2024-01-03', value: 30 }];
  assert.deepEqual(alignByDate(a, b), { dates: ['2024-01-01', '2024-01-03'], x: [1, 3], y: [10, 30] });
});

test('forwardFill only carries past values and respects max gap', () => {
  const s = [{ date: '2024-01-03', value: 5 }];
  const out = forwardFill(s, ['2024-01-01', '2024-01-03', '2024-01-05', '2024-01-20'], 7);
  assert.ok(Number.isNaN(out[0].value)); // nothing known yet: no backfill
  assert.equal(out[1].value, 5);
  assert.equal(out[2].value, 5);
  assert.ok(Number.isNaN(out[3].value)); // stale beyond 7 days
});

test('rolling correlation window length', () => {
  const x = [1, 2, 3, 4, 5, 6], y = [2, 4, 6, 8, 10, 12];
  const r = rollingCorrelation(['a', 'b', 'c', 'd', 'e', 'f'], x, y, 3);
  assert.equal(r.length, 4);
  r.forEach((p) => close(p.value, 1));
});

test('cross correlation detects a known lead', () => {
  const x = Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * 0.11));
  const y = [0, 0, ...x.slice(0, 198)]; // y lags x by 2
  const rows = crossCorrelation(x, y, 4);
  const best = rows.reduce((a, b) => (b.r > a.r ? b : a));
  assert.equal(best.lag, 2);
  assert.ok(best.r > best.bound);
});

test('conditional returns split by sign of condition', () => {
  const c = [{ date: '1', value: 1 }, { date: '2', value: -1 }, { date: '3', value: 2 }];
  const t = [{ date: '1', value: 0.02 }, { date: '2', value: -0.01 }, { date: '3', value: 0.04 }];
  const r = conditionalReturns(c, t);
  assert.equal(r.whenUp.n, 2); close(r.whenUp.mean, 0.03);
  assert.equal(r.whenDown.n, 1); close(r.whenDown.mean, -0.01);
});

test('event study uses first trading day on/after event', () => {
  const s = ['2024-01-01', '2024-01-02', '2024-01-04', '2024-01-05', '2024-01-08'].map((d, i) => ({ date: d, value: 100 + i * 10 }));
  const r = eventStudy(s, ['2024-01-03'], 1, 1);
  assert.equal(r.n, 1);
  close(r.events[0].ret, 130 / 110 - 1);
});

test('yoy matches by calendar date and skips gaps', () => {
  const pts = [
    { date: '2024-09-01', value: 100 }, { date: '2024-10-01', value: 100 }, { date: '2024-11-01', value: 100 },
    { date: '2025-09-01', value: 103 }, /* 2025-10 missing */ { date: '2025-11-01', value: 102 },
  ];
  const r = yoy(pts);
  assert.deepEqual(r.map((p) => p.date), ['2025-09-01', '2025-11-01']);
  close(r[0].value, 3); close(r[1].value, 2);
});
