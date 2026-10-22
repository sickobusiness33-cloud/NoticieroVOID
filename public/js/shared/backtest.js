// Causal backtesting engine. Shared by the Quant Lab (browser) and tests (Node).
//
// Timing convention (prevents look-ahead bias):
//   * signal[i] is computed using only prices[0..i] (the close of bar i).
//   * the position decided at close i is held over bar i+1, so it earns ret[i+1].
//   * transaction cost + slippage are charged on the change in position at that point.
// External (macro) filter series are aligned with forward-fill AND an explicit
// publication lag, so an observation is only usable once it was actually published.

import { mean, std, downsideDev, forwardFill } from './stats.js';

export function sma(values, n) {
  const out = new Array(values.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = values[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

// Wilder's RSI.
export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export const STRATEGIES = {
  buy_hold: { params: {}, grid: {} },
  sma_cross: { params: { fast: 20, slow: 50 }, grid: { fast: [10, 20, 30], slow: [50, 100, 150] } },
  rsi_reversion: { params: { period: 14, entry: 30, exit: 55 }, grid: { period: [14], entry: [25, 30, 35], exit: [50, 55, 65] } },
  momentum: { params: { lookback: 30 }, grid: { lookback: [14, 30, 60, 90] } },
  breakout: { params: { lookback: 20 }, grid: { lookback: [10, 20, 40] } },
};

// Returns an array of target positions (0 or 1), one per bar, computed causally.
export function signals(closes, type, p = {}) {
  const n = closes.length;
  const pos = new Array(n).fill(0);
  switch (type) {
    case 'buy_hold':
      pos.fill(1);
      break;
    case 'sma_cross': {
      if (!(p.fast < p.slow)) throw new Error('fast period must be smaller than slow period');
      const f = sma(closes, p.fast), s = sma(closes, p.slow);
      for (let i = 0; i < n; i++) pos[i] = Number.isFinite(s[i]) && f[i] > s[i] ? 1 : 0;
      break;
    }
    case 'rsi_reversion': {
      const r = rsi(closes, p.period);
      let held = 0;
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(r[i])) {
          if (!held && r[i] < p.entry) held = 1;
          else if (held && r[i] > p.exit) held = 0;
        }
        pos[i] = held;
      }
      break;
    }
    case 'momentum':
      for (let i = p.lookback; i < n; i++) pos[i] = closes[i] / closes[i - p.lookback] - 1 > 0 ? 1 : 0;
      break;
    case 'breakout': {
      let held = 0;
      const exitLb = Math.max(2, Math.floor(p.lookback / 2));
      for (let i = p.lookback; i < n; i++) {
        const prior = closes.slice(i - p.lookback, i);
        const priorExit = closes.slice(i - exitLb, i);
        if (!held && closes[i] > Math.max(...prior)) held = 1;
        else if (held && closes[i] < Math.min(...priorExit)) held = 0;
        pos[i] = held;
      }
      break;
    }
    default:
      throw new Error(`Unknown strategy: ${type}`);
  }
  return pos;
}

// Optional macro filter: only allow exposure when the filter condition holds,
// evaluated with data that had been published by the bar's date.
export function applyMacroFilter(dates, pos, filter) {
  if (!filter || !filter.series || !filter.series.length) return { pos, coverage: 1 };
  const lag = Number(filter.publicationLagDays ?? 1);
  const shifted = filter.series.map((p) => ({ date: shiftDate(p.date, lag), value: p.value }));
  const aligned = forwardFill(shifted, dates, filter.maxStaleDays ?? 10).map((p) => p.value);
  const ma = sma(aligned.map((v) => (Number.isFinite(v) ? v : 0)), filter.period || 20);
  let usable = 0;
  const out = pos.map((v, i) => {
    const x = aligned[i];
    // Need a complete, gap-free window for the moving average.
    const window = aligned.slice(Math.max(0, i - (filter.period || 20) + 1), i + 1);
    if (!Number.isFinite(x) || window.length < (filter.period || 20) || window.some((w) => !Number.isFinite(w))) return 0;
    usable++;
    const ok = filter.rule === 'above_sma' ? x > ma[i] : x < ma[i];
    return ok ? v : 0;
  });
  return { pos: out, coverage: usable / dates.length };
}

export function shiftDate(date, days) {
  const d = new Date(Date.parse(date) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function runBacktest(prices, strategy, opts = {}) {
  const costBps = opts.costBps ?? 10;
  const slipBps = opts.slippageBps ?? 5;
  const ppy = opts.periodsPerYear ?? 365;
  const clean = prices.filter((p) => Number.isFinite(p.value) && p.value > 0);
  if (clean.length < 30) throw new Error('Not enough observations (need at least 30).');
  const dates = clean.map((p) => p.date);
  const closes = clean.map((p) => p.value);
  let pos = signals(closes, strategy.type, { ...STRATEGIES[strategy.type]?.params, ...strategy.params });
  let filterCoverage = null;
  if (opts.macroFilter) {
    const r = applyMacroFilter(dates, pos, opts.macroFilter);
    pos = r.pos; filterCoverage = r.coverage;
  }
  const unitCost = (costBps + slipBps) / 10000;
  const rets = [], bench = [], equity = [{ date: dates[0], value: 1 }], benchEq = [{ date: dates[0], value: 1 }];
  const trades = [];
  let eq = 1, beq = 1, prevPos = 0, open = null, costs = 0, exposed = 0;
  for (let i = 1; i < closes.length; i++) {
    const held = pos[i - 1]; // decided at close i-1
    const turnover = Math.abs(held - prevPos);
    const c = turnover * unitCost;
    const mret = closes[i] / closes[i - 1] - 1;
    const r = held * mret - c;
    costs += c;
    if (held) exposed++;
    if (held && !prevPos) open = { entryDate: dates[i - 1], entryPrice: closes[i - 1], growth: 1 - c };
    if (open) open.growth *= 1 + (held ? mret : 0);
    if (!held && prevPos && open) {
      open.growth *= 1 - c;
      trades.push({ ...open, exitDate: dates[i - 1], exitPrice: closes[i - 1], ret: open.growth - 1, bars: 0 });
      open = null;
    }
    prevPos = held;
    eq *= 1 + r; beq *= 1 + mret;
    rets.push({ date: dates[i], value: r });
    bench.push({ date: dates[i], value: mret });
    equity.push({ date: dates[i], value: eq });
    benchEq.push({ date: dates[i], value: beq });
  }
  if (open) trades.push({ ...open, exitDate: null, exitPrice: closes.at(-1), ret: open.growth - 1, openAtEnd: true });
  for (const t of trades) t.ret = Number.isFinite(t.ret) ? t.ret : 0;
  const m = metrics(rets.map((r) => r.value), equity.map((e) => e.value), trades, ppy, dates);
  m.exposure = exposed / rets.length;
  m.costsPaid = costs;
  return {
    kind: 'BACKTEST',
    sample: { start: dates[0], end: dates.at(-1), observations: closes.length },
    strategy, opts: { costBps, slippageBps: slipBps, periodsPerYear: ppy },
    filterCoverage,
    metrics: m,
    benchmark: metrics(bench.map((r) => r.value), benchEq.map((e) => e.value), [], ppy, dates),
    equity, benchEq, trades, returns: rets,
  };
}

export function maxDrawdown(equity) {
  let peak = -Infinity, mdd = 0;
  for (const v of equity) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  return mdd;
}

export function metrics(rets, equity, trades, ppy, dates) {
  const total = equity.at(-1) / equity[0] - 1;
  const days = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000;
  const sd = std(rets), dd = downsideDev(rets), mu = mean(rets);
  const wins = trades.filter((t) => t.ret > 0), losses = trades.filter((t) => t.ret <= 0);
  const grossWin = wins.reduce((a, t) => a + t.ret, 0), grossLoss = -losses.reduce((a, t) => a + t.ret, 0);
  return {
    totalReturn: total,
    // Annualizing a sample shorter than one year is misleading, so we refuse.
    annualizedReturn: days >= 365 ? (1 + total) ** (365 / days) - 1 : null,
    maxDrawdown: maxDrawdown(equity),
    sharpe: sd > 0 ? (mu / sd) * Math.sqrt(ppy) : null,
    sortino: dd > 0 ? (mu / dd) * Math.sqrt(ppy) : null,
    volatility: Number.isFinite(sd) ? sd * Math.sqrt(ppy) : null,
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    avgTrade: trades.length ? mean(trades.map((t) => t.ret)) : null,
    observations: rets.length,
  };
}

function* gridCombos(grid) {
  const keys = Object.keys(grid);
  if (!keys.length) { yield {}; return; }
  const [k, ...rest] = keys;
  const restGrid = Object.fromEntries(rest.map((r) => [r, grid[r]]));
  for (const v of grid[k]) for (const c of gridCombos(restGrid)) yield { [k]: v, ...c };
}

// Walk-forward: optimize parameters on each training window (by Sharpe), then
// evaluate the chosen parameters on the immediately following, unseen test window.
export function walkForward(prices, type, opts = {}) {
  const train = opts.trainBars ?? 180, test = opts.testBars ?? 60;
  const grid = opts.grid ?? STRATEGIES[type].grid;
  const folds = [];
  const oos = [];
  for (let start = 0; start + train + test <= prices.length; start += test) {
    const trainSlice = prices.slice(start, start + train);
    let best = null;
    for (const params of gridCombos(grid)) {
      if (type === 'sma_cross' && !(params.fast < params.slow)) continue;
      try {
        const r = runBacktest(trainSlice, { type, params }, opts);
        const s = r.metrics.sharpe ?? -Infinity;
        if (!best || s > best.sharpe) best = { params, sharpe: s };
      } catch { /* not enough data for these params */ }
    }
    if (!best) continue;
    // Include the training window as warm-up so indicators are defined, but only
    // score the returns that fall inside the test window.
    const warm = prices.slice(start, start + train + test);
    const r = runBacktest(warm, { type, params: best.params }, opts);
    const testRets = r.returns.slice(train - 1);
    oos.push(...testRets);
    folds.push({
      trainStart: trainSlice[0].date, trainEnd: trainSlice.at(-1).date,
      testStart: testRets[0]?.date, testEnd: testRets.at(-1)?.date,
      params: best.params, trainSharpe: best.sharpe,
      testReturn: testRets.reduce((a, x) => a * (1 + x.value), 1) - 1,
    });
  }
  const eq = [1];
  for (const r of oos) eq.push(eq.at(-1) * (1 + r.value));
  return {
    kind: 'WALK_FORWARD_OUT_OF_SAMPLE',
    folds,
    metrics: oos.length ? metrics(oos.map((r) => r.value), eq, [], opts.periodsPerYear ?? 365, [oos[0].date, oos.at(-1).date]) : null,
    equity: oos.map((r, i) => ({ date: r.date, value: eq[i + 1] })),
  };
}

// Split into in-sample / out-of-sample by fraction and run the same parameters on both.
export function splitTest(prices, strategy, opts = {}, frac = 0.7) {
  const cut = Math.floor(prices.length * frac);
  return {
    inSample: runBacktest(prices.slice(0, cut), strategy, opts),
    // Run independently: indicators restart their warm-up inside the OOS slice,
    // so no in-sample information reaches the out-of-sample result.
    outOfSample: runBacktest(prices.slice(cut), strategy, opts),
  };
}

export function toCSV(result) {
  const head = 'entry_date,entry_price,exit_date,exit_price,return_pct,open_at_end';
  const rows = result.trades.map((t) => [t.entryDate, t.entryPrice, t.exitDate ?? '', t.exitPrice, (t.ret * 100).toFixed(4), t.openAtEnd ? 'yes' : 'no'].join(','));
  return [head, ...rows].join('\n');
}
