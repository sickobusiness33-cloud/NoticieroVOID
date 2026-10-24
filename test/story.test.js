import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardParagraphs, sameStory } from '../src/services/story.js';

const SRC = ['Fed holds rates at 4.25% as inflation cools', 'The Federal Reserve kept its benchmark rate unchanged on Wednesday, citing slower price growth and a softer labour market.'];

test('keeps original paragraphs built from sourced facts', () => {
  const { kept, dropped } = guardParagraphs(['US central bankers left borrowing costs at 4.25%, pointing to easing inflation, according to the report.'], SRC, '2026-10-21T18:00:00Z');
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test('drops paragraphs with numbers not in the sources', () => {
  const { kept, dropped } = guardParagraphs(['Markets now expect the central bank to cut rates by 50 basis points in December, analysts said.'], SRC, '2026-10-21');
  assert.equal(kept.length, 0);
  assert.match(dropped[0].why, /^number_not_in_sources/);
});

test('allows dates from the publication timestamp', () => {
  const { kept } = guardParagraphs(['The decision was announced on 21 October 2026 and left policy unchanged for now.'], SRC, '2026-10-21T18:00:00Z');
  assert.equal(kept.length, 1);
});

test('drops paragraphs that copy eight or more consecutive source words', () => {
  const { dropped } = guardParagraphs(['In a statement, the Federal Reserve kept its benchmark rate unchanged on Wednesday, it said.'], SRC);
  assert.equal(dropped[0].why, 'copies_source_wording');
});

test('drops quotes the sources do not contain', () => {
  const { dropped } = guardParagraphs(['The chair said “we are not in a hurry to move” when asked about the next meeting.'], SRC);
  assert.equal(dropped[0].why, 'unsourced_quote');
});

test('sameStory matches items sharing significant headline words', () => {
  const item = { id: 'a', title: 'Fed holds interest rates steady as inflation cools' };
  const items = [item, { id: 'b', title: 'Federal Reserve: Fed holds rates steady, inflation cools further' }, { id: 'c', title: 'Bitcoin rallies past record' }];
  assert.deepEqual(sameStory(item, items).map((x) => x.id), ['b']);
});
