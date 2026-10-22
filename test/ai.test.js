import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidence, validateBriefing } from '../src/services/ai.js';
import { parseFredCsv } from '../src/adapters/fred.js';
import { mergeRules } from '../src/services/meme.js';

test('evidence pack numbers every item and keeps source links', () => {
  const ev = buildEvidence({
    indicators: [{ id: 'DGS10', name: '10Y', unit: '%', latest: { date: '2026-10-21', value: 4.1 }, previous: { date: '2026-10-20', value: 4.0 }, context: { percentile5y: 0.7 }, meta: { sourceUrl: 'https://fred.stlouisfed.org/series/DGS10' } }],
    news: [{ source: 'Fed', publishedAt: '2026-10-21T00:00:00Z', title: 'Statement', url: 'https://www.federalreserve.gov/x' }],
  });
  assert.deepEqual(ev.map((e) => e.id), ['E1', 'E2']);
  assert.equal(ev[0].ref, 'https://fred.stlouisfed.org/series/DGS10');
  assert.match(ev[0].text, /2026-10-21/);
});

test('briefing validation rejects citations to evidence that does not exist', () => {
  const evidence = [{ id: 'E1' }, { id: 'E2' }];
  const ok = { executiveSummary: { regime: 'x [E1]' }, scenarios: [{ thesis: 'y [E2]' }] };
  assert.equal(validateBriefing(ok, evidence), true);
  const bad = { executiveSummary: { regime: 'x [E9]' }, scenarios: [] };
  assert.throws(() => validateBriefing(bad, evidence), /unknown evidence: E9/);
  assert.throws(() => validateBriefing({}, evidence), /unexpected structure/);
});

test('FRED CSV parser skips missing values', () => {
  const pts = parseFredCsv('observation_date,DGS10\n2026-10-20,4.01\n2026-10-21,.\n2026-10-22,\n2026-10-23,4.05\n');
  assert.deepEqual(pts, [{ date: '2026-10-20', value: 4.01 }, { date: '2026-10-23', value: 4.05 }]);
});

test('meme rule overrides accept only numeric thresholds for known keys', () => {
  const r = mergeRules({ solChange7d: { good: '7', bad: 'abc' }, unknown: { good: 1 }, hardStops: { solChange7d: 0 } });
  assert.equal(r.solChange7d.good, 7);
  assert.equal(r.solChange7d.bad, -8);
  assert.equal(r.unknown, undefined);
  assert.equal(r.hardStops.solChange7d, -15);
});
