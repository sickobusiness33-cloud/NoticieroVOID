import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, parseIcsDate, classifyBea, expiries, statusFor, horizonLabel, TYPE_TO_TRANSMISSION } from '../public/js/shared/calendarx.js';
import { TRANSMISSION } from '../public/js/shared/impact.js';

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Gross Domestic Product\\, 3rd Quarter 2026 (Advance Estima\r\n te)\r\nDTSTART;VALUE=DATE-TIME:20261029T123000Z\r\nUID:abc-1\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Personal Income and Outlays\\, September 2026\r\nDTSTART:20261030T123000Z\r\nUID:abc-2\r\nEND:VEVENT\r\nEND:VCALENDAR';

test('ICS parser unfolds lines, unescapes commas and reads UTC times', () => {
  const ev = parseIcs(ICS);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].summary, 'Gross Domestic Product, 3rd Quarter 2026 (Advance Estimate)');
  assert.equal(ev[0].start, '2026-10-29T12:30:00Z');
  assert.equal(ev[1].uid, 'abc-2');
  assert.equal(parseIcsDate('20261029'), '2026-10-29T00:00:00Z');
});

test('BEA titles are classified', () => {
  assert.deepEqual(classifyBea('Gross Domestic Product, 3rd Quarter 2026 (Advance Estimate)'), { type: 'gdp', category: 'macro', importance: 'high' });
  assert.equal(classifyBea('Personal Income and Outlays, September 2026').type, 'pce');
});

test('expiry rules: third Friday and last Friday, quarterly flagged high-risk', () => {
  const e = expiries(2026);
  const mar = e.find((x) => x.id === 'opex:2026-03-20');
  assert.ok(mar, 'third Friday of March 2026 is the 20th');
  assert.equal(mar.type, 'quad-witching'); assert.ok(mar.categories.includes('risk'));
  assert.ok(e.find((x) => x.id === 'opex:2026-10-16'), 'third Friday of October 2026 is the 16th');
  assert.ok(e.find((x) => x.id === 'deribit:2026-10-30'), 'last Friday of October 2026 is the 30th');
  assert.ok(e.every((x) => x.confirmation === 'rule-based'));
});

test('status follows time and reschedules', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(statusFor({ type: 'gdp', date: '2026-10-29', datetimeUtc: '2026-10-29T12:30:00Z' }, now), 'scheduled');
  assert.equal(statusFor({ type: 'gdp', date: '2026-10-29', datetimeUtc: '2026-10-29T12:30:00Z', previousDate: '2026-10-28' }, now), 'rescheduled');
  assert.equal(statusFor({ type: 'gdp', date: '2026-10-20', datetimeUtc: '2026-10-20T12:30:00Z' }, now), 'published');
  assert.equal(statusFor({ type: 'fomc', date: '2026-10-24', datetimeUtc: '2026-10-24T11:30:00Z', durationMin: 60 }, now), 'in-progress');
  assert.equal(statusFor({ type: 'x' }, now), 'tbc');
});

test('every mapped event type has transmission scenarios', () => {
  for (const [t, cat] of Object.entries(TYPE_TO_TRANSMISSION)) assert.ok(TRANSMISSION[cat], `${t} → ${cat}`);
});

test('horizon labels', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(horizonLabel('2026-10-24', now).kind, 'today');
  assert.equal(horizonLabel('2027-08-24', now).kind, 'far');
  assert.equal(horizonLabel('2026-10-01', now).kind, 'past');
});
