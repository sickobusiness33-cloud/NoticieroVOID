// Lightweight interactive SVG line chart (no dependencies): multiple series,
// optional right axis, crosshair tooltip with exact values, keyboard inspection.
import { h, fmtNum } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
export const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];

function niceTicks(min, max, n = 5) {
  if (!(max > min)) { max = min + 1; }
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => span / x <= n) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

// series: [{ name, points:[{date,value}], axis:'left'|'right', color, dashed }]
// The SVG is drawn at the container's real pixel width (and redrawn on resize), so
// axis text is never stretched.
export function lineChart(series, opts = {}) {
  const wrap = h('div', { class: 'chart', tabindex: '0', role: 'img', 'aria-label': opts.label || series.map((x) => x.name).join(', ') });
  const valid = series.map((x) => ({ ...x, points: (x.points || []).filter((p) => Number.isFinite(p.value)) })).filter((x) => x.points.length);
  if (!valid.length) { wrap.append(h('div', { class: 'muted pad' }, 'No data')); return wrap; }
  const legend = h('div', { class: 'legend' }, valid.map((x, i) => h('span', null, h('i', { style: `background:${x.color || PALETTE[i % PALETTE.length]}` }), x.name + (x.axis === 'right' ? ' (R)' : ''))));
  const area = h('div', { class: 'chart-area' });
  wrap.append(legend, area);
  let lastW = 0;
  const render = () => {
    const W = Math.max(280, Math.round(area.clientWidth || opts.width || 760));
    if (W === lastW) return;
    lastW = W;
    area.replaceChildren(...draw(valid, opts, W, wrap));
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(render));
  ro.observe(area);
  requestAnimationFrame(render);
  return wrap;
}

function draw(valid, opts, W, wrap) {
  const H = opts.height || (W < 500 ? 200 : 240);
  const pad = { l: 52, r: valid.some((x) => x.axis === 'right') ? 56 : 14, t: 12, b: 26 };
  const fmt = opts.format || ((v) => fmtNum(v, Math.abs(v) >= 100 ? 0 : 2));
  const allDates = [...new Set(valid.flatMap((x) => x.points.map((p) => p.date)))].sort();
  const t0 = Date.parse(allDates[0]), t1 = Date.parse(allDates.at(-1));
  const X = (d) => pad.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const scale = (axis) => {
    const vals = valid.filter((x) => (x.axis || 'left') === axis).flatMap((x) => x.points.map((p) => p.value));
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (opts.zero && axis === 'left') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const m = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
    lo -= m; hi += m;
    return { lo, hi, Y: (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b) };
  };
  const L = scale('left'), R = scale('right');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg' });
  const g = s('g');
  for (const tk of L ? niceTicks(L.lo, L.hi) : []) {
    g.append(s('line', { x1: pad.l, x2: W - pad.r, y1: L.Y(tk), y2: L.Y(tk), class: tk === 0 ? 'grid zero' : 'grid' }));
    const tx = s('text', { x: pad.l - 6, y: L.Y(tk) + 4, class: 'tick', 'text-anchor': 'end' }); tx.textContent = fmt(tk); g.append(tx);
  }
  if (R) for (const tk of niceTicks(R.lo, R.hi)) {
    const tx = s('text', { x: W - pad.r + 6, y: R.Y(tk) + 4, class: 'tick' }); tx.textContent = (opts.formatRight || fmt)(tk); g.append(tx);
  }
  const years = (t1 - t0) / (365 * 86400000);
  const nX = Math.min(W < 500 ? 4 : 6, allDates.length);
  for (let i = 0; i < nX; i++) {
    const d = allDates[Math.round((i / Math.max(1, nX - 1)) * (allDates.length - 1))];
    const tx = s('text', { x: X(d), y: H - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle' });
    tx.textContent = years > 2 ? d.slice(0, 7) : d.slice(5); g.append(tx);
  }
  svg.append(g);
  valid.forEach((x, i) => {
    const sc = x.axis === 'right' ? R : L;
    let dPath = '', prevT = null;
    for (const p of x.points) {
      const tt = Date.parse(p.date);
      // Break the line across large gaps instead of drawing a misleading straight segment.
      const gap = prevT !== null && opts.maxGapDays && (tt - prevT) / 86400000 > opts.maxGapDays;
      dPath += `${!dPath || gap ? 'M' : 'L'}${X(p.date).toFixed(1)},${sc.Y(p.value).toFixed(1)}`;
      prevT = tt;
    }
    svg.append(s('path', { d: dPath, class: 'line', stroke: x.color || PALETTE[i % PALETTE.length], 'stroke-dasharray': x.dashed ? '4 3' : '' }));
  });
  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const tip = h('div', { class: 'tip', hidden: true });
  const maps = valid.map((x) => new Map(x.points.map((p) => [p.date, p.value])));
  let idx = allDates.length - 1;
  const show = (i) => {
    idx = Math.max(0, Math.min(allDates.length - 1, i));
    const d = allDates[idx];
    cross.setAttribute('x1', X(d)); cross.setAttribute('x2', X(d)); cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(h('b', null, d), ...valid.map((x, k) => {
      const v = maps[k].get(d);
      return h('div', null, h('i', { style: `background:${x.color || PALETTE[k % PALETTE.length]}` }), `${x.name}: `, v === undefined ? '—' : (x.axis === 'right' ? (opts.formatRight || fmt) : fmt)(v));
    }));
    const px = (X(d) / W) * 100;
    tip.style.left = px > 60 ? '' : `${px + 2}%`;
    tip.style.right = px > 60 ? `${100 - px + 2}%` : '';
  };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const tt = t0 + ((((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
    let best = 0, bd = Infinity;
    allDates.forEach((d, i) => { const dd = Math.abs(Date.parse(d) - tt); if (dd < bd) { bd = dd; best = i; } });
    show(best);
  });
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  wrap.onkeydown = (e) => {
    if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); }
  };
  return [svg, tip];
}

export function sliceRange(points, range) {
  if (!points?.length || range === 'max') return points || [];
  const days = { '1m': 31, '3m': 92, '6m': 183, '1y': 366, '2y': 731, '5y': 1827, '10y': 3653 }[range] || 366;
  const end = Date.parse(points.at(-1).date);
  return points.filter((p) => Date.parse(p.date) >= end - days * 86400000);
}

// Horizontal bar list (used for contributions, correlations).
export function bars(rows, { min = -1, max = 1, format = (v) => fmtNum(v, 2) } = {}) {
  return h('div', { class: 'bars' }, rows.map((r) => {
    const v = r.value;
    const zero = ((0 - min) / (max - min)) * 100;
    const pos = Number.isFinite(v) ? ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100 : zero;
    return h('div', { class: 'bar-row' }, h('span', { class: 'bar-l' }, r.label),
      h('span', { class: 'bar-track' }, h('span', { class: `bar-fill ${v >= 0 ? 'up' : 'down'}`, style: `left:${Math.min(zero, pos)}%;width:${Math.abs(pos - zero)}%` }), h('span', { class: 'bar-zero', style: `left:${zero}%` })),
      h('span', { class: 'bar-v' }, Number.isFinite(v) ? format(v) : '—'));
  }));
}
