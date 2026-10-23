import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, dedupe, classify, isBreaking, canonicalUrl, EXCERPT_MAX, stripHtml } from '../public/js/shared/news.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>X</title>
<item><title><![CDATA[Fed holds rates steady as inflation cools]]></title><link>https://ex.com/a?utm_source=rss</link>
<pubDate>Tue, 21 Oct 2026 14:00:00 GMT</pubDate><description><![CDATA[<p>${'Long body text. '.repeat(60)}</p>]]></description><category>Macro</category></item>
<item><title>Bitcoin &amp; Ether rally</title><link>https://ex.com/b</link><pubDate>Tue, 21 Oct 2026 15:00:00 GMT</pubDate></item>
<item><title>No link item</title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>ECB keeps deposit rate</title><link rel="alternate" href="https://ecb.example/p1"/><updated>2026-10-21T12:00:00Z</updated><summary>Short</summary></entry></feed>`;

test('parses RSS, decodes entities, strips html, truncates excerpts', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Fed holds rates steady as inflation cools');
  assert.equal(items[1].title, 'Bitcoin & Ether rally');
  assert.ok(items[0].excerpt.length <= EXCERPT_MAX + 1);
  assert.ok(!items[0].excerpt.includes('<p>'));
  assert.equal(items[0].publishedAt, '2026-10-21T14:00:00.000Z');
});

test('parses Atom', () => {
  const [e] = parseFeed(ATOM);
  assert.equal(e.url, 'https://ecb.example/p1');
  assert.equal(e.title, 'ECB keeps deposit rate');
});

test('canonical url strips tracking params', () => {
  assert.equal(canonicalUrl('https://ex.com/a?utm_source=rss&id=2#x'), 'https://ex.com/a?id=2');
});

test('dedupe clusters near-identical titles per language', () => {
  const items = [
    { title: 'Fed holds interest rates steady in October meeting', url: 'https://a.com/1', publishedAt: '2026-10-21T10:00:00Z', lang: 'en', source: 'A' },
    { title: 'Fed holds interest rates steady at October meeting', url: 'https://b.com/2', publishedAt: '2026-10-21T10:05:00Z', lang: 'en', source: 'B' },
    { title: 'Solana DEX volume jumps', url: 'https://c.com/3', publishedAt: '2026-10-21T10:06:00Z', lang: 'en', source: 'C' },
    { title: 'Fed holds interest rates steady in October meeting', url: 'https://a.com/1?utm_medium=x', publishedAt: '2026-10-21T11:00:00Z', lang: 'en', source: 'A' },
  ];
  const out = dedupe(items);
  assert.equal(out.length, 2);
  assert.equal(out[0].alsoReportedBy.length, 1);
  assert.equal(out[0].alsoReportedBy[0].source, 'B');
});

test('classification tags categories, assets and countries (EN + ES)', () => {
  const c = classify({ title: 'Powell signals rate cut as CPI cools; Bitcoin jumps', excerpt: '' });
  assert.ok(c.categories.includes('central-banks'));
  assert.ok(c.categories.includes('inflation'));
  assert.ok(c.assets.includes('BTC'));
  const es = classify({ title: 'La Reserva Federal recorta los tipos de interés', excerpt: '' });
  assert.ok(es.categories.includes('central-banks'));
});

test('breaking requires recency', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(isBreaking({ title: 'Bitcoin plunges 10%', publishedAt: '2026-10-21T11:00:00Z' }, now), true);
  assert.equal(isBreaking({ title: 'Bitcoin plunges 10%', publishedAt: '2026-10-20T11:00:00Z' }, now), false);
});

test('stripHtml removes scripts', () => {
  assert.equal(stripHtml('<script>alert(1)</script><b>hi</b>'), 'hi');
});

test('extracts publisher thumbnails from media tags, enclosures or inline <img>', async () => {
  const { parseFeed: pf } = await import('../public/js/shared/news.js');
  const xml = `<rss><channel>
<item><title>A</title><link>https://x.com/a</link><media:content url="https://img.x.com/a.jpg" medium="image"/></item>
<item><title>B</title><link>https://x.com/b</link><enclosure url="https://img.x.com/b.png" type="image/png"/></item>
<item><title>C</title><link>https://x.com/c</link><description><![CDATA[<p><img src="https://img.x.com/c.webp" /> text</p>]]></description></item>
<item><title>D</title><link>https://x.com/d</link><enclosure url="https://x.com/d.mp3" type="audio/mpeg"/><media:content url="http://insecure.com/d.jpg"/></item>
</channel></rss>`;
  assert.deepEqual(pf(xml).map((i) => i.image), ['https://img.x.com/a.jpg', 'https://img.x.com/b.png', 'https://img.x.com/c.webp', null]);
});

test('strips "read the full story" boilerplate from excerpts', async () => {
  const { parseFeed: pf } = await import('../public/js/shared/news.js');
  const [i] = pf('<rss><item><title>T</title><link>https://x.com/t</link><description>Real summary here. Read the full story on CryptoSlate Understand more</description></item></rss>');
  assert.equal(i.excerpt, 'Real summary here.');
});
