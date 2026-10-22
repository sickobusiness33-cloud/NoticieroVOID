// Transparent, rule-based regime classifiers. These are deterministic analytics,
// NOT AI output. Every conclusion lists the observations and thresholds it used.

import { lastValid } from './stats.js';

// Value of a series on or before a date that is `daysBack` before the last observation.
export function valueAgo(points, daysBack) {
  const last = lastValid(points);
  if (!last) return null;
  const target = Date.parse(last.date) - daysBack * 86400000;
  for (let i = last.index; i >= 0; i--) {
    if (Date.parse(points[i].date) <= target && Number.isFinite(points[i].value)) return points[i];
  }
  return null;
}

function change(points, daysBack) {
  const last = lastValid(points), prev = valueAgo(points, daysBack);
  if (!last || !prev) return null;
  return { last, prev, delta: last.value - prev.value };
}

function vote(signals) {
  const valid = signals.filter((s) => s.vote !== null);
  if (!valid.length) return { label: 'insufficient', confidence: 'none', score: null };
  const score = valid.reduce((a, s) => a + s.vote, 0) / valid.length;
  const agree = valid.every((s) => s.vote === valid[0].vote);
  const confidence = valid.length >= 2 && agree ? 'moderate' : valid.length >= 2 ? 'low (mixed signals)' : 'low (single input)';
  return { score, confidence, agree };
}

// series: map of FRED id -> [{date,value}] (already transformed where noted).
export function macroRegime(series) {
  const dims = [];
  const ev = (id, c, label) => c && { id, label, latest: c.last, comparison: c.prev, delta: +c.delta.toFixed(4) };

  // Inflation: CPI and core PCE year-over-year, 3-month trend.
  {
    const cpi = series.CPI_YOY && change(series.CPI_YOY, 92);
    const pce = series.CORE_PCE_YOY && change(series.CORE_PCE_YOY, 92);
    const s = [cpi, pce].map((c) => ({ vote: c ? Math.sign(Math.round(c.delta * 10)) : null }));
    const v = vote(s);
    dims.push({
      key: 'inflation',
      label: v.score === null ? 'insufficient' : v.score > 0 ? 'inflationary (re-accelerating)' : v.score < 0 ? 'disinflationary' : 'stable / mixed',
      confidence: v.confidence,
      evidence: [ev('CPIAUCSL→YoY', cpi, 'Headline CPI YoY %, vs ~3 months earlier'), ev('PCEPILFE→YoY', pce, 'Core PCE YoY %, vs ~3 months earlier')].filter(Boolean),
    });
  }
  // Growth: unemployment trend and initial claims trend (rising = weakening).
  {
    const ur = series.UNRATE && change(series.UNRATE, 92);
    const cl = series.ICSA && change(series.ICSA, 91);
    const gdp = series.A191RL1Q225SBEA && lastValid(series.A191RL1Q225SBEA);
    const s = [
      { vote: ur ? (ur.delta >= 0.2 ? -1 : ur.delta <= -0.2 ? 1 : 0) : null },
      { vote: cl ? (cl.delta / cl.prev.value > 0.1 ? -1 : cl.delta / cl.prev.value < -0.1 ? 1 : 0) : null },
      { vote: gdp ? (gdp.value < 0 ? -1 : gdp.value > 2.5 ? 1 : 0) : null },
    ];
    const v = vote(s);
    dims.push({
      key: 'growth',
      label: v.score === null ? 'insufficient' : v.score > 0.3 ? 'accelerating' : v.score < -0.3 ? 'decelerating' : 'steady / mixed',
      confidence: v.confidence,
      evidence: [ev('UNRATE', ur, 'Unemployment rate %, vs ~3 months earlier'), ev('ICSA', cl, 'Initial jobless claims, vs ~13 weeks earlier'),
        gdp && { id: 'A191RL1Q225SBEA', label: 'Real GDP growth, % SAAR (latest quarter)', latest: gdp }].filter(Boolean),
    });
  }
  // Monetary policy: policy rate path and 2-year yield (market-implied direction).
  {
    const ff = series.DFF && change(series.DFF, 182);
    const y2 = series.DGS2 && change(series.DGS2, 91);
    const s = [
      { vote: ff ? (ff.delta <= -0.2 ? -1 : ff.delta >= 0.2 ? 1 : 0) : null },
      { vote: y2 ? (y2.delta <= -0.25 ? -1 : y2.delta >= 0.25 ? 1 : 0) : null },
    ];
    const v = vote(s);
    dims.push({
      key: 'policy',
      label: v.score === null ? 'insufficient' : v.score > 0.3 ? 'tightening' : v.score < -0.3 ? 'easing' : 'on hold / mixed',
      confidence: v.confidence,
      evidence: [ev('DFF', ff, 'Effective fed funds %, vs ~6 months earlier'), ev('DGS2', y2, '2-year Treasury yield %, vs ~3 months earlier')].filter(Boolean),
    });
  }
  // Financial conditions: Chicago Fed NFCI level and high-yield spread trend.
  {
    const nf = series.NFCI && change(series.NFCI, 91);
    const hy = series.BAMLH0A0HYM2 && change(series.BAMLH0A0HYM2, 91);
    const s = [
      { vote: nf ? (nf.last.value < 0 ? 1 : -1) : null },
      { vote: hy ? (hy.delta <= -0.3 ? 1 : hy.delta >= 0.3 ? -1 : 0) : null },
    ];
    const v = vote(s);
    dims.push({
      key: 'financialConditions',
      label: v.score === null ? 'insufficient' : v.score > 0.3 ? 'loose' : v.score < -0.3 ? 'tight' : 'neutral / mixed',
      confidence: v.confidence,
      evidence: [ev('NFCI', nf, 'Chicago Fed NFCI (negative = looser than average)'), ev('BAMLH0A0HYM2', hy, 'US high-yield OAS %, vs ~3 months earlier')].filter(Boolean),
    });
  }
  // Liquidity: Fed net liquidity proxy, 13-week change.
  {
    const nl = series.NET_LIQUIDITY && change(series.NET_LIQUIDITY, 91);
    const v = vote([{ vote: nl ? (nl.delta / Math.abs(nl.prev.value) > 0.02 ? 1 : nl.delta / Math.abs(nl.prev.value) < -0.02 ? -1 : 0) : null }]);
    dims.push({
      key: 'liquidity',
      label: v.score === null ? 'insufficient' : v.score > 0 ? 'expanding' : v.score < 0 ? 'contracting' : 'flat',
      confidence: v.confidence,
      evidence: [ev('WALCL−WTREGEN−RRPONTSYD', nl, 'Fed net liquidity proxy (USD bn), vs ~13 weeks earlier')].filter(Boolean),
    });
  }
  // Risk appetite: VIX level and S&P 500 3-month return.
  {
    const vix = series.VIXCLS && lastValid(series.VIXCLS);
    const spx = series.SP500 && change(series.SP500, 91);
    const s = [
      { vote: vix ? (vix.value < 16 ? 1 : vix.value > 25 ? -1 : 0) : null },
      { vote: spx ? (spx.delta / spx.prev.value > 0.03 ? 1 : spx.delta / spx.prev.value < -0.03 ? -1 : 0) : null },
    ];
    const v = vote(s);
    dims.push({
      key: 'riskAppetite',
      label: v.score === null ? 'insufficient' : v.score > 0.3 ? 'risk-on' : v.score < -0.3 ? 'risk-off' : 'neutral / mixed',
      confidence: v.confidence,
      evidence: [vix && { id: 'VIXCLS', label: 'VIX close (thresholds: <16 calm, >25 stressed)', latest: vix }, ev('SP500', spx, 'S&P 500, vs ~3 months earlier')].filter(Boolean),
    });
  }
  return { method: 'RULE_BASED', dimensions: dims };
}

// ---- Solana memecoin market regime -------------------------------------------------

export const MEME_DEFAULT_RULES = {
  // Each rule: positive vote above `good`, negative vote below `bad` (or reversed with `invert`).
  solChange7d: { good: 5, bad: -8, label: 'SOL 7-day price change (%)' },
  solVol30d: { good: 0.55, bad: 0.95, invert: true, label: 'SOL 30-day annualized volatility' },
  dexVolumeChange7d: { good: 10, bad: -20, label: 'Solana DEX volume, 7d vs prior 7d (%)' },
  stablecoinChange30d: { good: 2, bad: -3, label: 'Stablecoin supply on Solana, 30d change (%)' },
  poolBreadth: { good: 0.55, bad: 0.35, label: 'Share of trending pools up over 24h' },
  medianPoolLiquidity: { good: 250000, bad: 60000, label: 'Median liquidity of trending pools (USD)' },
  btcChange7d: { good: 3, bad: -7, label: 'BTC 7-day price change (%)' },
  hardStops: { solChange7d: -15, btcChange7d: -12 },
  minInputs: 4,
};

export function memeRegime(obs, rules = MEME_DEFAULT_RULES) {
  const contributions = [];
  for (const [key, r] of Object.entries(rules)) {
    if (key === 'hardStops' || key === 'minInputs') continue;
    const v = obs[key];
    if (!Number.isFinite(v)) { contributions.push({ key, label: r.label, value: null, vote: null, reason: 'unavailable' }); continue; }
    let vote = 0;
    if (r.invert) vote = v <= r.good ? 1 : v >= r.bad ? -1 : 0;
    else vote = v >= r.good ? 1 : v <= r.bad ? -1 : 0;
    contributions.push({ key, label: r.label, value: v, vote, thresholds: { good: r.good, bad: r.bad, invert: !!r.invert } });
  }
  const valid = contributions.filter((c) => c.vote !== null);
  const stops = Object.entries(rules.hardStops || {}).filter(([k, t]) => Number.isFinite(obs[k]) && obs[k] <= t).map(([k, t]) => `${k} ≤ ${t}`);
  if (valid.length < (rules.minInputs ?? 4)) {
    return { regime: 'INSUFFICIENT_DATA', score: null, inputs: valid.length, contributions, hardStops: stops,
      explanation: `Only ${valid.length} of ${contributions.length} inputs were available; at least ${rules.minInputs ?? 4} are required.` };
  }
  const score = valid.reduce((a, c) => a + c.vote, 0) / valid.length;
  let regime;
  if (stops.length) regime = 'DEFENSIVE';
  else if (score >= 0.45) regime = 'FAVORABLE';
  else if (score >= 0) regime = 'SELECTIVE';
  else if (score >= -0.45) regime = 'HIGH_RISK';
  else regime = 'DEFENSIVE';
  return {
    regime, score: +score.toFixed(3), inputs: valid.length, contributions, hardStops: stops,
    explanation: stops.length
      ? `Hard stop triggered (${stops.join(', ')}), forcing DEFENSIVE regardless of other inputs.`
      : `Average vote ${score.toFixed(2)} across ${valid.length} inputs (≥0.45 FAVORABLE, ≥0 SELECTIVE, ≥−0.45 HIGH RISK, else DEFENSIVE).`,
  };
}
