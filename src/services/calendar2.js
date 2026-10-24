// Intelligence Calendar: multi-source events for any range (year/month/week/day), news
// counts per day, change tracking in D1 and per-date impact analysis.
// Sources (all verifiable): Fed & ECB official calendars, BEA official release ICS,
// U.S. Treasury FiscalData auctions, FRED release calendar (needs FRED_API_KEY),
// exchange expiry rules, Finnhub earnings (needs FINNHUB_API_KEY), publisher news feeds.

import { upstream, cached, log } from '../lib/core.js';
import { CB_MEETINGS, KEY_RELEASES } from '../adapters/sources.js';
import { releaseDates } from '../adapters/fred.js';
import { history as cgHistory } from '../adapters/crypto.js';
import { series } from './macro.js';
import { latest as latestNews } from './news.js';
import { parseIcs, classifyBea, expiries, statusFor, TYPE_TO_TRANSMISSION, WATCH, horizonLabel, CATEGORIES } from '../../public/js/shared/calendarx.js';
import { TRANSMISSION, UNIVERSE } from '../../public/js/shared/impact.js';
import { eventStudy, mean } from '../../public/js/shared/stats.js';

// FOMC 2025 decision days (second day), from the Fed's official calendar.
const FOMC_2025 = ['2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10'];

const D = /^\d{4}-\d{2}-\d{2}$/;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

// Local wall-clock time in an IANA zone → UTC ISO string (DST-aware via Intl).
export function zonedToUtc(date, time, tz) {
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const asIf = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asIf - guess)).toISOString();
}

function norm(e) {
  const datetimeUtc = e.datetimeUtc || (e.time && e.tz && /^\d{2}:\d{2}$/.test(e.time) ? zonedToUtc(e.date, e.time, e.tz) : null);
  return { confirmation: 'official', importance: 'medium', assets: [], ...e, datetimeUtc };
}

async function sourceCB() {
  const fomc25 = FOMC_2025.map((date) => ({ date, time: '14:00', tz: 'America/New_York', region: 'US', event: 'FOMC rate decision', eventEs: 'Decisión de tipos del FOMC', source: 'Federal Reserve', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', markets: ['UST', 'USD', 'SPX', 'BTC'] }));
  return [...fomc25, ...CB_MEETINGS].map((m) => norm({
    id: `${/ECB/.test(m.event) ? 'ecb' : 'fomc'}:${m.date}`, type: /ECB/.test(m.event) ? 'ecb' : 'fomc', date: m.date, time: m.time, tz: m.tz, region: m.region,
    title: m.event, titleEs: m.eventEs, categories: ['cb', 'risk'], importance: 'high', durationMin: 90, source: m.source, sourceUrl: m.sourceUrl,
    assets: /ECB/.test(m.event) ? ['EURUSD', 'UST10Y'] : ['UST2Y', 'UST10Y', 'DXY', 'SPX', 'NDX', 'GOLD', 'BTC'],
  }));
}

async function sourceBEA(env) {
  const r = await cached(env, 'cal:bea:ics', 12 * 3600, async () => parseIcs(await upstream('bea', 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics', { as: 'text', timeoutMs: 15000 })));
  return r.value.map((x) => {
    const c = classifyBea(x.summary);
    return norm({
      id: `bea:${x.uid}`, type: c.type, date: x.start.slice(0, 10), datetimeUtc: x.start, time: null, tz: 'America/New_York', region: 'US',
      title: x.summary, titleEs: x.summary, categories: [c.category], importance: c.importance, durationMin: 30,
      source: 'U.S. Bureau of Economic Analysis (official release schedule)', sourceUrl: 'https://www.bea.gov/news/schedule', updatedAt: x.stamp,
      assets: c.type === 'pce' ? ['UST2Y', 'UST10Y', 'DXY', 'SPX', 'GOLD', 'BTC'] : c.type === 'gdp' ? ['SPX', 'UST10Y', 'DXY'] : ['DXY'],
    });
  });
}

async function sourceTreasury(env, from, to) {
  const today = new Date().toISOString().slice(0, 10);
  const past = from < today ? await cached(env, `cal:auctions:${from}`, 6 * 3600, () => upstream('treasury',
    `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?filter=auction_date:gte:${from},auction_date:lte:${to}&sort=-auction_date&page%5Bsize%5D=400&fields=auction_date,security_type,security_term,high_yield,high_investment_rate,bid_to_cover_ratio,offering_amt,cusip,reopening,closing_time_comp`, { timeoutMs: 20000 })) : null;
  const up = await cached(env, 'cal:auctions:upcoming', 3 * 3600, () => upstream('treasury',
    'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions?sort=-record_date&page%5Bsize%5D=80', { timeoutMs: 15000 }));
  const rows = [...(past?.value?.data || []), ...(up.value.data || [])];
  const seen = new Set();
  const nn = (v) => (v === null || v === 'null' || v === '' || v === undefined ? null : Number(v));
  return rows.filter((r) => { const k = `${r.cusip}:${r.auction_date}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((r) => {
    const time = /11:30/.test(r.closing_time_comp || '') ? '11:30' : '13:00';
    const coupon = r.security_type !== 'Bill';
    return norm({
      id: `ust:${r.cusip}:${r.auction_date}`, type: 'auction', date: r.auction_date, time, tz: 'America/New_York', region: 'US',
      title: `Treasury auction: ${r.security_term} ${r.security_type}${r.reopening === 'Yes' ? ' (reopening)' : ''}`,
      titleEs: `Subasta del Tesoro: ${r.security_term} ${r.security_type}${r.reopening === 'Yes' ? ' (reapertura)' : ''}`,
      categories: ['cb'], importance: coupon && /10-Year|30-Year|20-Year/.test(r.security_term) ? 'high' : coupon ? 'medium' : 'low', durationMin: 5,
      source: 'U.S. Treasury FiscalData', sourceUrl: 'https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/',
      data: { offeringUsd: nn(r.offering_amt), highYield: nn(r.high_yield) ?? nn(r.high_investment_rate), bidToCover: nn(r.bid_to_cover_ratio) },
      assets: ['UST10Y', 'UST2Y'],
    });
  });
}

async function sourceFred(env, from, to) {
  if (!env.FRED_API_KEY) return { events: [], pending: 'FRED_API_KEY not set: BLS/DOL releases (CPI, payrolls, jobless claims, PPI, retail sales) are not on the calendar.' };
  const r = await cached(env, `cal:fred:${from}:${to}`, 6 * 3600, () => releaseDates(env, from, to));
  const map = { 'CPIAUCSL': 'cpi', 'PAYEMS': 'nfp', 'ICSA': 'claims', 'A191RL1Q225SBEA': 'gdp', 'PCEPILFE': 'pce' };
  const events = [];
  for (const rd of r.value || []) {
    const def = KEY_RELEASES.find((k) => k.match.test(rd.release_name));
    if (!def || def.skip) continue;
    const type = map[def.series] || (/Producer/.test(def.event) ? 'ppi' : /Retail/.test(def.event) ? 'retail' : 'macro');
    if (['gdp', 'pce'].includes(type)) continue; // BEA ICS is the primary source for these
    events.push(norm({
      id: `fred:${rd.release_id}:${rd.date}`, type, date: rd.date, time: def.time, tz: 'America/New_York', region: 'US', title: def.event, titleEs: def.eventEs,
      categories: ['macro', ...(def.importance === 'high' ? ['risk'] : [])], importance: def.importance, durationMin: 30,
      source: `FRED release calendar: ${rd.release_name}`, sourceUrl: `https://fred.stlouisfed.org/release?rid=${rd.release_id}`, assets: ['UST2Y', 'UST10Y', 'DXY', 'SPX', 'BTC'],
    }));
  }
  return { events };
}

async function sourceEarnings(env, from, to) {
  if (!env.FINNHUB_API_KEY) return { events: [], pending: 'FINNHUB_API_KEY not set: company earnings and dividends are not on the calendar.' };
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span > 45) return { events: [], note: 'Earnings are loaded for month/week/day views (≤45 days).' };
  const r = await cached(env, `cal:earn:${from}:${to}`, 6 * 3600, () => upstream('finnhub', `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${env.FINNHUB_API_KEY}`, { timeoutMs: 15000 }));
  const rows = (r.value.earningsCalendar || []).filter((e) => e.symbol && (e.revenueEstimate || 0) >= 5e9).slice(0, 300);
  return { events: rows.map((e) => norm({
    id: `earn:${e.symbol}:${e.date}`, type: 'earnings', date: e.date, time: e.hour === 'bmo' ? '08:00' : e.hour === 'amc' ? '16:05' : null, tz: 'America/New_York', region: 'US',
    title: `${e.symbol} earnings (Q${e.quarter} ${e.year})`, titleEs: `Resultados de ${e.symbol} (T${e.quarter} ${e.year})`, categories: ['corporate'], importance: 'medium',
    source: 'Finnhub earnings calendar', sourceUrl: `https://finnhub.io/`, data: { epsEstimate: e.epsEstimate, epsActual: e.epsActual, revenueEstimate: e.revenueEstimate, revenueActual: e.revenueActual },
    confirmation: 'provider', assets: ['SPX', 'NDX'],
  })) };
}

async function previousDates(env, ids) {
  if (!env.DB || !ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, previous_date FROM cal_events WHERE previous_date IS NOT NULL AND id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    for (const r of results) out[r.id] = r.previous_date;
  }
  return out;
}

async function newsByDay(env, from, to) {
  const byDay = {};
  const add = (d, cat) => { const x = (byDay[d] ||= { total: 0, macro: 0, cb: 0, crypto: 0, corporate: 0 }); x.total++; x[cat]++; };
  const catOf = (cats, assets) => (cats.includes('central-banks') || cats.includes('rates-bonds') ? 'cb'
    : ['etf-flows', 'regulation', 'defi', 'stablecoins', 'memecoins'].some((c) => cats.includes(c)) || assets.some((a) => ['BTC', 'ETH', 'SOL', 'XRP'].includes(a)) ? 'crypto'
      : ['inflation', 'labor', 'growth', 'fx-dollar', 'geopolitics', 'commodities'].some((c) => cats.includes(c)) ? 'macro' : 'corporate');
  const seen = new Set();
  try {
    for (const it of (await latestNews(env)).value.items) {
      const d = (it.publishedAt || '').slice(0, 10);
      if (d >= from && d <= to) { seen.add(it.url); add(d, catOf(it.categories, it.assets)); }
    }
  } catch { /* feeds optional */ }
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare('SELECT url, substr(published_at,1,10) AS d, categories, assets FROM articles WHERE published_at >= ? AND published_at <= ? LIMIT 20000').bind(from, `${to}T23:59:59Z`).all();
      for (const r of results) if (!seen.has(r.url)) add(r.d, catOf((r.categories || '').split(','), (r.assets || '').split(',')));
    } catch (e) { log('warn', 'news_by_day_failed', { error: e.message }); }
  }
  return byDay;
}

export async function range(env, from, to, { internal = false } = {}) {
  if (!D.test(from) || !D.test(to) || from > to) throw bad('from/to must be YYYY-MM-DD and from ≤ to');
  // Public requests are bounded; internal history lookups (impact comparables) may span ~2 years.
  if (!internal && (Date.parse(to) - Date.parse(from)) / 86400000 > 400) throw bad('Range limited to 400 days');
  const sources = [];
  const pending = [];
  const all = [];
  const run = async (name, fn) => {
    try {
      const r = await fn();
      const evs = Array.isArray(r) ? r : r.events;
      if (!Array.isArray(r) && r.pending) pending.push(r.pending);
      all.push(...evs);
      sources.push({ name, ok: true, count: evs.filter((e) => e.date >= from && e.date <= to).length, note: r.note || null });
    } catch (e) { sources.push({ name, ok: false, error: e.message }); }
  };
  const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])].map(Number);
  await Promise.all([
    run('Federal Reserve & ECB calendars', sourceCB),
    run('BEA release schedule', () => sourceBEA(env)),
    run('U.S. Treasury auctions', () => sourceTreasury(env, from, to)),
    run('FRED release calendar', () => sourceFred(env, from, to)),
    run('Earnings (Finnhub)', () => sourceEarnings(env, from, to)),
    run('Expiry rules (Cboe/OCC, Deribit)', async () => years.flatMap(expiries).map(norm)),
  ]);
  pending.push('Token unlocks and protocol upgrades: no verified free provider integrated (e.g. Token Unlocks / CoinMarketCal require paid or keyed access).');
  const now = Date.now();
  const events = all.filter((e) => e.date >= from && e.date <= to);
  const prev = await previousDates(env, events.map((e) => e.id));
  for (const e of events) {
    if (prev[e.id] && prev[e.id] !== e.date) e.previousDate = prev[e.id];
    e.status = statusFor(e, now);
    if (e.status === 'finished' || e.status === 'published') e.categories = [...new Set([...e.categories, 'past'])];
  }
  events.sort((a, b) => (a.datetimeUtc || `${a.date}T23:59`).localeCompare(b.datetimeUtc || `${b.date}T23:59`));
  return { from, to, events, news: await newsByDay(env, from, to), sources, pending, categories: CATEGORIES, generatedAt: new Date().toISOString() };
}

// Persist current events to D1 and record reschedules (run by the 6-hourly cron).
export async function persist(env) {
  if (!env.DB) return { skipped: true };
  const y = new Date().getUTCFullYear();
  const r = await range(env, `${y}-01-01`, `${y + 1}-12-31`);
  const now = new Date().toISOString();
  let moved = 0;
  for (let i = 0; i < r.events.length; i += 50) {
    const batch = r.events.slice(i, i + 50);
    const existing = await env.DB.prepare(`SELECT id, date FROM cal_events WHERE id IN (${batch.map(() => '?').join(',')})`).bind(...batch.map((e) => e.id)).all();
    const old = Object.fromEntries(existing.results.map((x) => [x.id, x.date]));
    const stmts = batch.map((e) => {
      const changed = old[e.id] && old[e.id] !== e.date;
      if (changed) moved++;
      return env.DB.prepare(`INSERT INTO cal_events (id, title, category, date, time_utc, source, source_url, status, previous_date, first_seen, last_updated)
        VALUES (?,?,?,?,?,?,?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, time_utc=excluded.time_utc, status=excluded.status,
        previous_date=CASE WHEN cal_events.date <> excluded.date THEN cal_events.date ELSE cal_events.previous_date END, last_updated=excluded.last_updated`)
        .bind(e.id, e.title, e.categories[0], e.date, e.datetimeUtc, e.source, e.sourceUrl, e.status, now, now);
    });
    await env.DB.batch(stmts);
  }
  return { stored: r.events.length, rescheduled: moved };
}

// ---------------- Impact analysis ----------------
const ASSET_SERIES = {
  SPX: { fred: 'SP500', kind: 'pct' }, NDX: { fred: 'NASDAQ100', kind: 'pct' }, DJI: { fred: 'DJIA', kind: 'pct' }, UST2Y: { fred: 'DGS2', kind: 'bp' }, UST10Y: { fred: 'DGS10', kind: 'bp' },
  DXY: { fred: 'DTWEXBGS', kind: 'pct' }, EURUSD: { fred: 'DEXUSEU', kind: 'pct' }, WTI: { fred: 'DCOILWTICO', kind: 'pct' }, VIX: { fred: 'VIXCLS', kind: 'pct' },
  BTC: { cg: 'bitcoin', kind: 'pct' }, ETH: { cg: 'ethereum', kind: 'pct' }, SOL: { cg: 'solana', kind: 'pct' },
};
export const IMPACT_ASSETS = Object.keys(ASSET_SERIES);

async function assetSeries(env, id) {
  const s = ASSET_SERIES[id];
  if (s.fred) return (await series(env, s.fred, '2019-01-01')).points;
  return (await cached(env, `cg:hist:${s.cg}:365`, 6 * 3600, () => cgHistory(env, s.cg, 365))).value;
}

// Reaction on the event day: close of the previous observation → close of the event day.
export function reactions(points, dates, kind) {
  if (kind === 'bp') {
    const idx = new Map(points.map((p, i) => [p.date, i]));
    const rows = [];
    for (const d of dates) {
      let i = idx.get(d);
      if (i === undefined) i = points.findIndex((p) => p.date >= d);
      if (i <= 0) continue;
      rows.push({ date: d, move: (points[i].value - points[i - 1].value) * 100 });
    }
    const all = points.slice(1).map((p, i) => Math.abs((p.value - points[i].value) * 100));
    return summarize(rows, all, 'bp');
  }
  const es = eventStudy(points, dates, 1, 0);
  const all = points.slice(1).map((p, i) => Math.abs((p.value / points[i].value - 1) * 100));
  return summarize(es.events.map((e) => ({ date: e.date, move: e.ret * 100 })), all, '%');
}

function summarize(rows, allAbs, unit) {
  if (!rows.length) return null;
  const moves = rows.map((r) => r.move);
  const meanAbs = mean(moves.map(Math.abs));
  const base = mean(allAbs.filter(Number.isFinite));
  return { n: rows.length, unit, meanMove: mean(moves), meanAbsMove: meanAbs, baselineAbsMove: base, ratioToBaseline: base ? meanAbs / base : null,
    upShare: moves.filter((m) => m > 0).length / rows.length, events: rows };
}

function pastDatesOfType(events, type, before) {
  return [...new Set(events.filter((e) => e.type === type && e.date < before).map((e) => e.date))];
}

export async function impact(env, date, assets) {
  if (!D.test(date)) throw bad('date must be YYYY-MM-DD');
  const sel = (assets || []).filter((a) => ASSET_SERIES[a]).slice(0, 6);
  const today = new Date().toISOString().slice(0, 10);
  const y = Number(date.slice(0, 4));
  // Load the day plus two years of history for comparables.
  const histFrom = `${Math.min(y, Number(today.slice(0, 4))) - 1}-01-01`;
  const [day, hist] = await Promise.all([range(env, date, date), range(env, histFrom, today < date ? today : date, { internal: true })]);
  const seriesCache = {};
  const getSeries = async (a) => (seriesCache[a] ||= assetSeries(env, a).catch(() => null));
  const horizon = horizonLabel(date);
  const analyses = [];
  for (const ev of day.events) {
    const tcat = TYPE_TO_TRANSMISSION[ev.type];
    const scenarios = tcat ? TRANSMISSION[tcat] : null;
    const comparables = {};
    const pastDates = ev.type === 'fomc' ? [...FOMC_2025, ...CB_MEETINGS.filter((m) => /FOMC/.test(m.event)).map((m) => m.date)].filter((d) => d < today)
      : pastDatesOfType(hist.events, ev.type, today).slice(-24);
    if (pastDates.length) {
      for (const a of (sel.length ? sel : (ev.assets || []).filter((x) => ASSET_SERIES[x]).slice(0, 4))) {
        const pts = await getSeries(a);
        if (!pts) { comparables[a] = { error: 'series unavailable' }; continue; }
        comparables[a] = reactions(pts, pastDates, ASSET_SERIES[a].kind);
      }
    }
    analyses.push({
      eventId: ev.id, title: ev.title, titleEs: ev.titleEs, type: ev.type, status: ev.status, confirmation: ev.confirmation,
      whyItMatters: scenarios ? scenarios.map((s) => s.label) : null,
      scenarios: scenarios ? scenarios.map((s) => ({ key: s.key, label: s.label, moves: Object.fromEntries(Object.entries(s.moves).filter(([k]) => !sel.length || sel.includes(k) || (ev.assets || []).includes(k))) })) : null,
      watch: WATCH[ev.type] || null,
      comparables, comparableDates: pastDates,
      probabilities: null,
      probabilityNote: { en: 'No calibrated model: scenarios are qualitative, no probabilities are assigned.', es: 'Sin modelo calibrado: los escenarios son cualitativos y no se asignan probabilidades.' },
    });
  }
  // Assets-centric view: what is coming up for each selected asset in the next 30 days from the date.
  const upcoming = sel.length ? (await range(env, date, new Date(Date.parse(date) + 30 * 86400000).toISOString().slice(0, 10))).events
    .filter((e) => (e.assets || []).some((a) => sel.includes(a))).slice(0, 25).map((e) => ({ id: e.id, date: e.date, title: e.title, titleEs: e.titleEs, importance: e.importance, assets: e.assets.filter((a) => sel.includes(a)) })) : [];
  return {
    date, horizon, events: day.events, news: day.news[date] || null, analyses, upcomingForAssets: upcoming, assets: sel,
    universe: UNIVERSE.filter((u) => ASSET_SERIES[u.id]).map((u) => ({ id: u.id, en: u.en, es: u.es })),
    evidenceNote: horizon.kind === 'far'
      ? { en: 'Far-dated: only confirmed or rule-based events are shown; market conditions on that date are unknown and the analysis will change as new data arrive.', es: 'Fecha lejana: solo se muestran eventos confirmados o basados en reglas; las condiciones de mercado de ese día son desconocidas y el análisis cambiará con nuevos datos.' }
      : null,
    generatedAt: new Date().toISOString(), sources: day.sources, pending: day.pending,
  };
}

export async function dayNews(env, date) {
  const items = (await latestNews(env)).value.items.filter((i) => (i.publishedAt || '').startsWith(date));
  let archived = [];
  if (env.DB) {
    try { archived = (await env.DB.prepare('SELECT id, url, title, source, published_at AS publishedAt FROM articles WHERE substr(published_at,1,10) = ? ORDER BY published_at DESC LIMIT 40').bind(date).all()).results; } catch { /* optional */ }
  }
  const seen = new Set(items.map((i) => i.url));
  return [...items.map(({ id, url, title, source, publishedAt, categories }) => ({ id, url, title, source, publishedAt, categories })), ...archived.filter((a) => !seen.has(a.url))].slice(0, 40);
}
