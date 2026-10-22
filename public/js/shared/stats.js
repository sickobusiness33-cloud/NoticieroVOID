// Pure statistical helpers shared by the browser and the Worker.
// Every function is deterministic and side-effect free so it can be unit tested.

export function mean(xs) {
  const v = xs.filter(Number.isFinite);
  if (!v.length) return NaN;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

// Sample standard deviation (n - 1).
export function std(xs) {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

// Downside deviation relative to 0 (used by Sortino).
export function downsideDev(xs) {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  return Math.sqrt(v.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / (v.length - 1));
}

// Simple returns between consecutive points: r_t = p_t / p_{t-1} - 1.
export function pctReturns(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value, cur = points[i].value;
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev !== 0) {
      out.push({ date: points[i].date, value: cur / prev - 1 });
    }
  }
  return out;
}

// First differences, for series where percent change is not meaningful (yields, spreads).
export function diffs(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value, cur = points[i].value;
    if (Number.isFinite(prev) && Number.isFinite(cur)) out.push({ date: points[i].date, value: cur - prev });
  }
  return out;
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}

// Inner-join two {date,value} series on identical dates. No interpolation:
// a missing date in either series simply drops that observation.
export function alignByDate(a, b) {
  const mb = new Map(b.map((p) => [p.date, p.value]));
  const dates = [], x = [], y = [];
  for (const p of a) {
    if (mb.has(p.date) && Number.isFinite(p.value) && Number.isFinite(mb.get(p.date))) {
      dates.push(p.date); x.push(p.value); y.push(mb.get(p.date));
    }
  }
  return { dates, x, y };
}

// Last-observation-carried-forward onto a target date grid. Only carries
// values forward (never backward), so it cannot leak future information.
export function forwardFill(series, dates, maxGapDays = Infinity) {
  const sorted = [...series].filter((p) => Number.isFinite(p.value)).sort((p, q) => (p.date < q.date ? -1 : 1));
  const out = [];
  let j = -1;
  for (const d of dates) {
    while (j + 1 < sorted.length && sorted[j + 1].date <= d) j++;
    if (j < 0) { out.push({ date: d, value: NaN, filled: false }); continue; }
    const gap = (Date.parse(d) - Date.parse(sorted[j].date)) / 86400000;
    out.push({ date: d, value: gap <= maxGapDays ? sorted[j].value : NaN, filled: sorted[j].date !== d });
  }
  return out;
}

export function rollingCorrelation(dates, x, y, window) {
  const out = [];
  for (let i = window - 1; i < x.length; i++) {
    out.push({ date: dates[i], value: pearson(x.slice(i - window + 1, i + 1), y.slice(i - window + 1, i + 1)) });
  }
  return out;
}

// Rolling annualized volatility of a return series.
export function rollingVol(returns, window, periodsPerYear = 365) {
  const out = [];
  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1).map((r) => r.value);
    out.push({ date: returns[i].date, value: std(slice) * Math.sqrt(periodsPerYear) });
  }
  return out;
}

export function zscores(values) {
  const m = mean(values), s = std(values);
  return values.map((v) => (Number.isFinite(v) && s > 0 ? (v - m) / s : NaN));
}

// Cross-correlation corr(x_t, y_{t+lag}). Positive lag: x leads y.
// Returns the approximate 95% significance bound 1.96/sqrt(n) for white noise.
export function crossCorrelation(x, y, maxLag) {
  const rows = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const a = [], b = [];
    for (let i = 0; i < x.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < y.length) { a.push(x[i]); b.push(y[j]); }
    }
    rows.push({ lag, r: pearson(a, b), n: a.length, bound: 1.96 / Math.sqrt(a.length) });
  }
  return rows;
}

// Average of `target` returns grouped by the sign of a same-day `condition` change.
export function conditionalReturns(condition, target) {
  const { x, y } = alignByDate(condition, target);
  const up = [], down = [];
  x.forEach((c, i) => { if (c > 0) up.push(y[i]); else if (c < 0) down.push(y[i]); });
  const summary = (v) => ({ n: v.length, mean: mean(v), std: std(v), hitRate: v.length ? v.filter((r) => r > 0).length / v.length : NaN });
  return { whenUp: summary(up), whenDown: summary(down) };
}

// Mean cumulative return of `series` from day `before` to day `after` around event dates.
export function eventStudy(series, eventDates, before = 1, after = 3) {
  const idx = new Map(series.map((p, i) => [p.date, i]));
  const rows = [];
  for (const d of eventDates) {
    // Use the first trading day on/after the event date.
    let i = idx.get(d);
    if (i === undefined) {
      i = series.findIndex((p) => p.date >= d);
      if (i < 0) continue;
    }
    if (i - before < 0 || i + after >= series.length) continue;
    const p0 = series[i - before].value, p1 = series[i + after].value;
    if (Number.isFinite(p0) && Number.isFinite(p1) && p0 !== 0) rows.push({ date: d, ret: p1 / p0 - 1 });
  }
  const rets = rows.map((r) => r.ret);
  return { events: rows, n: rows.length, mean: mean(rets), std: std(rets), hitRate: rows.length ? rets.filter((r) => r > 0).length / rows.length : NaN };
}

export function lastValid(points) {
  for (let i = points.length - 1; i >= 0; i--) if (Number.isFinite(points[i].value)) return { ...points[i], index: i };
  return null;
}

// Year-over-year percent change, matched by calendar date (same day one year earlier),
// not by position — so a missing observation (e.g. an unpublished month) never pairs
// the wrong months together.
export function yoy(points) {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out = [];
  for (const p of points) {
    const prevDate = `${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4)}`;
    const a = byDate.get(prevDate);
    if (Number.isFinite(a) && Number.isFinite(p.value) && a !== 0) out.push({ date: p.date, value: (p.value / a - 1) * 100 });
  }
  return out;
}
