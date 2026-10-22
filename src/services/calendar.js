// Economic calendar. Sources, in order of authority:
//   1. FRED release-dates API (official BLS/BEA/DOL release schedule) — needs FRED_API_KEY.
//   2. Central-bank meeting dates from the official Fed / ECB calendars (static, dated).
//   3. U.S. Treasury upcoming auctions (FiscalData, live).
// Consensus forecasts are NOT available from any free official source, so the
// `consensus` field is always null unless a licensed provider is integrated.

import { CB_MEETINGS, KEY_RELEASES, treasuryAuctions } from '../adapters/sources.js';
import { releaseDates } from '../adapters/fred.js';
import { cached } from '../lib/core.js';
import { series, transformPoints } from './macro.js';

export async function calendar(env, { from, to }) {
  const fromD = from || new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const toD = to || new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const sources = [];
  const events = CB_MEETINGS.filter((e) => e.date >= fromD && e.date <= toD).map((e) => ({ ...e, previous: null, consensus: null, actual: null }));
  sources.push({ name: 'Fed / ECB official meeting calendars (verified 2026-10-22)', ok: true });

  try {
    const r = await cached(env, 'treasury:auctions', 3 * 3600, () => treasuryAuctions());
    events.push(...r.value.filter((e) => e.date >= fromD && e.date <= toD).map((e) => ({ ...e, previous: null, consensus: null, actual: null })));
    sources.push({ name: 'U.S. Treasury FiscalData', ok: true, stale: r.stale });
  } catch (e) { sources.push({ name: 'U.S. Treasury FiscalData', ok: false, error: e.message }); }

  if (env.FRED_API_KEY) {
    try {
      const r = await cached(env, `fred:releases:${fromD}:${toD}`, 6 * 3600, () => releaseDates(env, fromD, toD));
      for (const rd of r.value || []) {
        const def = KEY_RELEASES.find((k) => k.match.test(rd.release_name));
        if (!def || def.skip) continue;
        events.push({
          date: rd.date, time: def.time, tz: 'America/New_York', region: 'US', event: def.event, eventEs: def.eventEs,
          source: `FRED release calendar: ${rd.release_name}`, sourceUrl: `https://fred.stlouisfed.org/release?rid=${rd.release_id}`,
          markets: def.markets, importance: def.importance, series: def.series || null, transform: def.transform || null,
          previous: null, consensus: null, actual: null,
        });
      }
      sources.push({ name: 'FRED release dates API', ok: true, stale: r.stale });
    } catch (e) { sources.push({ name: 'FRED release dates API', ok: false, error: e.message }); }
  } else {
    sources.push({ name: 'FRED release dates API', ok: false, error: 'FRED_API_KEY not configured: data-release schedule (CPI, NFP, GDP, PCE, claims) unavailable' });
  }

  // Attach "actual" only to the MOST RECENT past release of each series (the latest FRED
  // observation is only attributable to that release), and "previous" to the next upcoming one.
  const today = new Date().toISOString().slice(0, 10);
  const pick = new Set();
  const bySeries = {};
  for (const e of events.filter((x) => x.series)) (bySeries[e.series] ||= []).push(e);
  for (const list of Object.values(bySeries)) {
    const past = list.filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date));
    const next = list.filter((e) => e.date > today).sort((a, b) => a.date.localeCompare(b.date));
    if (past[0]) pick.add(past[0]);
    if (next[0]) pick.add(next[0]);
  }
  await Promise.all([...pick].map(async (e) => {
    try {
      const s = await series(env, e.series);
      const t = transformPoints(s.points, e.transform);
      const pts = t.points;
      if (e.date <= today) {
        // We do not know the vintage history without ALFRED; label the attached value accordingly.
        e.actual = pts.at(-1) ? { ...pts.at(-1), unit: t.unit || s.catalog.unit, note: 'latest observation currently in FRED (may include revisions)' } : null;
        e.previous = pts.at(-2) ? { ...pts.at(-2), unit: t.unit || s.catalog.unit } : null;
      } else {
        e.previous = pts.at(-1) ? { ...pts.at(-1), unit: t.unit || s.catalog.unit } : null;
      }
    } catch { /* leave nulls: unavailable is shown explicitly in the UI */ }
  }));

  events.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return { events, sources, range: { from: fromD, to: toD }, consensusAvailable: false };
}
