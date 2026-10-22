// Liquidity analytics. Two distinct outputs, deliberately kept apart:
//   1. MEASURED: Fed net liquidity = WALCL − TGA − ON RRP (all converted to USD billions).
//   2. ESTIMATED: a composite liquidity *score* built from unit-free, standardized changes.
// Raw series with incompatible units are never summed together except in (1), where
// all three are USD balance-sheet quantities of the same central bank.

import { forwardFill, mean, std, pearson } from './stats.js';

export const UNIT_TO_BILLIONS = { WALCL: 1 / 1000, WTREGEN: 1 / 1000, RRPONTSYD: 1, WRESBAL: 1 / 1000 };

export function netLiquidity(walcl, tga, rrp) {
  const dates = walcl.filter((p) => Number.isFinite(p.value)).map((p) => p.date);
  const w = forwardFill(walcl, dates, 0);
  const t = forwardFill(tga, dates, 7);
  const r = forwardFill(rrp, dates, 7);
  return dates.map((d, i) => {
    const parts = { walcl: w[i].value * UNIT_TO_BILLIONS.WALCL, tga: t[i].value * UNIT_TO_BILLIONS.WTREGEN, rrp: r[i].value * UNIT_TO_BILLIONS.RRPONTSYD };
    const ok = Object.values(parts).every(Number.isFinite);
    return { date: d, value: ok ? parts.walcl - parts.tga - parts.rrp : NaN, parts };
  });
}

// Percent change over `lag` observations on an aligned grid.
export function pctChange(values, lag) {
  return values.map((v, i) => (i >= lag && Number.isFinite(v) && Number.isFinite(values[i - lag]) && values[i - lag] !== 0 ? (v / values[i - lag] - 1) * 100 : NaN));
}
export function absChange(values, lag) {
  return values.map((v, i) => (i >= lag && Number.isFinite(v) && Number.isFinite(values[i - lag]) ? v - values[i - lag] : NaN));
}

// Rolling z-score that uses ONLY past and current observations (no full-sample
// normalization, which would leak future information into historical values).
export function rollingZ(values, window = 156, minObs = 52) {
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return NaN;
    const hist = values.slice(Math.max(0, i - window + 1), i + 1).filter(Number.isFinite);
    if (hist.length < minObs) return NaN;
    const s = std(hist);
    return s > 0 ? (v - mean(hist)) / s : NaN;
  });
}

export const COMPOSITE_COMPONENTS = [
  { key: 'netLiq', label: 'Fed net liquidity, 13-week % change', sign: 1, weight: 0.35, transform: 'pct13' },
  { key: 'ecb', label: 'Eurosystem total assets, 13-week % change (EUR, no FX conversion)', sign: 1, weight: 0.15, transform: 'pct13' },
  { key: 'stables', label: 'Total stablecoin supply, 13-week % change', sign: 1, weight: 0.2, transform: 'pct13' },
  { key: 'realYield', label: '10-year real yield (TIPS), 13-week change in pp (inverted)', sign: -1, weight: 0.15, transform: 'abs13' },
  { key: 'dollar', label: 'Broad dollar index, 13-week % change (inverted)', sign: -1, weight: 0.15, transform: 'pct13' },
];

// raw: { [key]: [{date,value}] } — each component's raw series. Grid: weekly dates.
export function compositeScore(raw, grid, opts = {}) {
  const comps = opts.components || COMPOSITE_COMPONENTS;
  const minCoverage = opts.minCoverage ?? 0.6;
  const z = {};
  for (const c of comps) {
    const series = raw[c.key];
    if (!series || !series.length) { z[c.key] = grid.map(() => NaN); continue; }
    const aligned = forwardFill(series, grid, opts.maxStaleDays ?? 10).map((p) => p.value);
    const tr = c.transform === 'abs13' ? absChange(aligned, 13) : pctChange(aligned, 13);
    z[c.key] = rollingZ(tr, opts.window ?? 156, opts.minObs ?? 52).map((v) => v * c.sign);
  }
  const rows = grid.map((date, i) => {
    let s = 0, wsum = 0;
    const parts = {};
    for (const c of comps) {
      const v = z[c.key][i];
      parts[c.key] = Number.isFinite(v) ? +v.toFixed(3) : null;
      if (Number.isFinite(v)) { s += v * c.weight; wsum += c.weight; }
    }
    const totalW = comps.reduce((a, c) => a + c.weight, 0);
    const coverage = wsum / totalW;
    // Missing components: renormalize over available weights, but refuse below minCoverage.
    return { date, value: coverage >= minCoverage ? s / wsum : NaN, coverage: +coverage.toFixed(2), parts };
  });
  return { rows, components: comps, method: { normalization: `rolling z-score of 13-week changes, window ${opts.window ?? 156} weeks, min ${opts.minObs ?? 52} obs`, missing: `weights renormalized over available components; NaN if coverage < ${minCoverage}` } };
}

// Sensitivity: equal weights and leave-one-out variants, compared with the base score.
export function sensitivity(raw, grid, opts = {}) {
  const base = compositeScore(raw, grid, opts).rows.map((r) => r.value);
  const variants = [];
  const comps = opts.components || COMPOSITE_COMPONENTS;
  const corrWithBase = (vals) => {
    const a = [], b = [];
    vals.forEach((v, i) => { if (Number.isFinite(v) && Number.isFinite(base[i])) { a.push(v); b.push(base[i]); } });
    return { r: pearson(a, b), n: a.length, last: vals.filter(Number.isFinite).at(-1) ?? null };
  };
  const eq = comps.map((c) => ({ ...c, weight: 1 / comps.length }));
  variants.push({ name: 'Equal weights', ...corrWithBase(compositeScore(raw, grid, { ...opts, components: eq }).rows.map((r) => r.value)) });
  for (const c of comps) {
    const loo = comps.filter((x) => x.key !== c.key);
    variants.push({ name: `Without ${c.key}`, ...corrWithBase(compositeScore(raw, grid, { ...opts, components: loo }).rows.map((r) => r.value)) });
  }
  return { baseLast: base.filter(Number.isFinite).at(-1) ?? null, variants };
}

export function weeklyGrid(start, end, weekday = 3) {
  const out = [];
  const d = new Date(Date.parse(start));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  for (; d.getTime() <= Date.parse(end); d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  return out;
}
