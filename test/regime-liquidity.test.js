import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memeRegime, macroRegime, MEME_DEFAULT_RULES } from '../public/js/shared/regime.js';
import { netLiquidity, compositeScore, rollingZ, weeklyGrid, sensitivity } from '../public/js/shared/liquidity.js';

test('meme regime: insufficient data is explicit, never guessed', () => {
  const r = memeRegime({ solChange7d: 10, btcChange7d: 5 });
  assert.equal(r.regime, 'INSUFFICIENT_DATA');
  assert.equal(r.score, null);
});

test('meme regime: favorable / defensive / hard stop', () => {
  const good = { solChange7d: 12, solVol30d: 0.5, dexVolumeChange7d: 30, stablecoinChange30d: 5, poolBreadth: 0.7, medianPoolLiquidity: 400000, btcChange7d: 6 };
  assert.equal(memeRegime(good).regime, 'FAVORABLE');
  const bad = { solChange7d: -10, solVol30d: 1.2, dexVolumeChange7d: -40, stablecoinChange30d: -5, poolBreadth: 0.2, medianPoolLiquidity: 20000, btcChange7d: -8 };
  assert.equal(memeRegime(bad).regime, 'DEFENSIVE');
  const stop = { ...good, solChange7d: -20 };
  const r = memeRegime(stop);
  assert.equal(r.regime, 'DEFENSIVE');
  assert.ok(r.hardStops.length === 1);
});

test('meme regime: rules are configurable', () => {
  const obs = { solChange7d: 4, solVol30d: 0.5, dexVolumeChange7d: 30, stablecoinChange30d: 5, poolBreadth: 0.7 };
  const strict = { ...MEME_DEFAULT_RULES, solChange7d: { ...MEME_DEFAULT_RULES.solChange7d, good: 3 } };
  assert.ok(memeRegime(obs, strict).score > memeRegime(obs).score);
});

test('macro regime marks missing dimensions as insufficient', () => {
  const r = macroRegime({});
  assert.ok(r.dimensions.every((d) => d.label === 'insufficient'));
});

test('macro regime detects disinflation from falling CPI YoY', () => {
  const mk = (vals, startMonth = 0) => vals.map((v, i) => ({ date: new Date(Date.UTC(2025, startMonth + i, 1)).toISOString().slice(0, 10), value: v }));
  const r = macroRegime({ CPI_YOY: mk([3.5, 3.4, 3.2, 3.0, 2.8, 2.6]) });
  assert.equal(r.dimensions.find((d) => d.key === 'inflation').label, 'disinflationary');
});

test('net liquidity converts units to USD billions', () => {
  const w = [{ date: '2026-10-21', value: 6_753_604 }];
  const t = [{ date: '2026-10-21', value: 952_002 }];
  const r = [{ date: '2026-10-20', value: 0.351 }];
  const [row] = netLiquidity(w, t, r);
  assert.ok(Math.abs(row.value - (6753.604 - 952.002 - 0.351)) < 1e-9);
});

test('rolling z uses only past data', () => {
  const vals = Array.from({ length: 100 }, (_, i) => Math.sin(i));
  const a = rollingZ(vals, 50, 20);
  const mutated = vals.slice(); mutated[99] = 1000;
  const b = rollingZ(mutated, 50, 20);
  assert.deepEqual(a.slice(0, 99), b.slice(0, 99));
});

test('composite renormalizes for missing components and enforces coverage', () => {
  const grid = weeklyGrid('2020-01-01', '2024-12-31');
  const s = (f) => grid.map((d, i) => ({ date: d, value: 100 + f(i) }));
  const raw = { netLiq: s((i) => i + 5 * Math.sin(i / 5)), stables: s((i) => 2 * i + 3 * Math.cos(i / 7)) };
  const out = compositeScore(raw, grid);
  // Only 0.55 of weight is available (< 0.6 minCoverage) → no score.
  assert.ok(out.rows.every((r) => Number.isNaN(r.value)));
  const out2 = compositeScore(raw, grid, { minCoverage: 0.5 });
  assert.ok(out2.rows.some((r) => Number.isFinite(r.value)));
  const sens = sensitivity(raw, grid, { minCoverage: 0.3 });
  assert.ok(sens.variants.length >= 2);
});
