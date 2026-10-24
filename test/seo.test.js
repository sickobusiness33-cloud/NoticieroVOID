import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, articlePath, headTags, urlsetXml, sitemapIndexXml, newsSitemapXml, rssXml, newsArticleLd, breadcrumbLd, organizationLd, SECTIONS, inSection, PAGES } from '../public/js/shared/seo.js';
import { STATIC_PAGES } from '../public/js/shared/pages.js';
import { resolvePage, robots } from '../src/services/site.js';

const SITE = 'https://void.example';
const ITEM = { id: 'a'.repeat(20), url: 'https://pub.example/story', title: 'Fed holds rates at 4.25% as inflation cools', excerpt: 'The Federal Reserve kept rates unchanged.', source: 'Pub', lang: 'en', publishedAt: '2026-10-24T10:00:00.000Z', categories: ['central-banks'], assets: [], countries: [], official: false, image: null };
const STORY_ROW = { headline: 'US central bank pauses', paragraphs: JSON.stringify(['US policymakers left borrowing costs at 4.25%, pointing to easing inflation, according to Pub.', 'Second paragraph.']), sources: JSON.stringify([{ source: 'Pub', url: ITEM.url }]), model: 'm', status: 'ok', createdAt: '2026-10-24T11:00:00.000Z' };

// Minimal D1 fake: answers the three queries the site renderer makes.
function fakeEnv({ item = ITEM, story = STORY_ROW, recent = [] } = {}) {
  const row = item && { ...item, published_at: item.publishedAt, publishedAt: item.publishedAt, categories: item.categories.join(','), assets: '', countries: '', official: item.official ? 1 : 0 };
  return { DB: { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => (/FROM articles WHERE id/.test(sql) ? (item && args[0] === item.id ? row : null) : /FROM stories WHERE id/.test(sql) ? story : null),
    all: async () => ({ results: /FROM articles WHERE published_at/.test(sql) ? recent : [] }),
  }) }) } };
}
const page = (path, env = fakeEnv()) => resolvePage(new URL(SITE + path), env, SITE);

test('slugify produces stable ASCII slugs', () => {
  assert.equal(slugify('Fed holds rates at 4.25% — ¿qué sigue?'), 'fed-holds-rates-at-4-25-que-sigue');
  assert.equal(slugify('!!!'), 'story');
  assert.ok(slugify('word '.repeat(40)).length <= 80);
  assert.equal(articlePath(ITEM), `/news/${ITEM.id}/fed-holds-rates-at-4-25-as-inflation-cools`);
});

test('head tags carry canonical, robots and social metadata', () => {
  const t = headTags({ site: SITE, path: '/news', title: 'T "q"', description: 'D', index: true });
  assert.match(t, /<link rel="canonical" href="https:\/\/void\.example\/news">/);
  assert.match(t, /content="index, follow/);
  assert.match(t, /og:title" content="T &quot;q&quot;"/);
  assert.match(headTags({ site: SITE, path: '/saved', title: 'x', description: 'y', index: false }), /content="noindex, follow"/);
  assert.match(headTags({ site: SITE, path: '/', title: 'x', description: 'y', verification: { google: 'abc' } }), /google-site-verification" content="abc"/);
});

test('sitemaps are well-formed and escape URLs', () => {
  const x = urlsetXml([{ loc: `${SITE}/a?b=1&c=2`, lastmod: '2026-10-24T00:00:00Z' }]);
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(x, /<loc>https:\/\/void\.example\/a\?b=1&amp;c=2<\/loc><lastmod>2026-10-24T00:00:00Z<\/lastmod>/);
  assert.match(sitemapIndexXml([`${SITE}/s1.xml`]), /<sitemapindex[^>]*>\n<sitemap><loc>/);
  const n = newsSitemapXml([{ loc: `${SITE}/n`, lang: 'en', published: '2026-10-24T00:00:00Z', title: 'A & B' }]);
  assert.match(n, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/);
  assert.match(n, /<news:title>A &amp; B<\/news:title>/);
  assert.match(rssXml(SITE, [{ loc: `${SITE}/n`, title: 'T', published: '2026-10-24T00:00:00Z', description: 'D' }]), /<pubDate>Sat, 24 Oct 2026 00:00:00 GMT<\/pubDate>/);
});

test('robots.txt allows crawling and lists sitemaps', () => {
  const r = robots(SITE);
  assert.match(r, /^User-agent: \*\nAllow: \//);
  assert.doesNotMatch(r, /Disallow: \/\n/);
  assert.match(r, /Sitemap: https:\/\/void\.example\/sitemap\.xml/);
  assert.match(r, /Sitemap: https:\/\/void\.example\/news-sitemap\.xml/);
});

test('structured data uses real fields', () => {
  const story = { paragraphs: ['P1'], sources: [{ source: 'Pub', url: ITEM.url }], generatedAt: '2026-10-24T11:00:00Z' };
  const ld = newsArticleLd(SITE, { item: ITEM, story, section: 'Economy' });
  assert.equal(ld['@type'], 'NewsArticle');
  assert.equal(ld.headline, ITEM.title);
  assert.equal(ld.datePublished, story.generatedAt);
  assert.deepEqual(ld.isBasedOn, [ITEM.url]);
  assert.ok(ld.headline.length <= 110);
  assert.equal(breadcrumbLd(SITE, [['Home', '/']]).itemListElement[0].item, `${SITE}/`);
  assert.equal(organizationLd(SITE).publishingPrinciples, `${SITE}/editorial-policy`);
});

test('article with a VOID Report is indexable with NewsArticle', async () => {
  const p = await page(articlePath(ITEM));
  assert.equal(p.status, 200);
  assert.equal(p.index, true);
  assert.ok(p.ld.some((x) => x['@type'] === 'NewsArticle'));
  assert.match(p.body, /<h1[^>]*>Fed holds rates/);
  assert.equal((p.body.match(/<h1/g) || []).length, 1);
  assert.match(p.body, /Read the full story at Pub/);
  assert.match(p.description, /^US policymakers/);
});

test('headline-only and official pages are noindex', async () => {
  assert.equal((await page(articlePath(ITEM), fakeEnv({ story: null }))).index, false);
  const off = { ...ITEM, official: true };
  const p = await page(articlePath(off), fakeEnv({ item: off }));
  assert.equal(p.index, false);
  assert.ok(!p.ld.some((x) => x['@type'] === 'NewsArticle'));
});

test('off-topic (general news) story pages are noindex even with a report', async () => {
  const gen = { ...ITEM, categories: ['general'] };
  const p = await page(articlePath(gen), fakeEnv({ item: gen }));
  assert.equal(p.index, false);
  assert.ok(!p.ld.some((x) => x['@type'] === 'NewsArticle'));
});

test('URL variants redirect to the canonical article URL; unknown ids are 404', async () => {
  assert.equal((await page(`/news/${ITEM.id}`)).redirect, SITE + articlePath(ITEM));
  assert.equal((await page(`/news/${ITEM.id}/wrong-slug`)).redirect, SITE + articlePath(ITEM));
  assert.equal((await page(`/article/${ITEM.id}`)).redirect, SITE + articlePath(ITEM));
  assert.equal((await page(`${articlePath(ITEM)}/`)).redirect, SITE + articlePath(ITEM));
  assert.equal((await page(`/news/${'b'.repeat(20)}/x`)).status, 404);
  assert.equal((await page('/no-such-page')).status, 404);
  assert.equal((await page('/no-such-page')).index, false);
  assert.equal((await page('/section/nope')).status, 404);
});

test('app pages: indexable ones have unique titles; filtered variants are noindex', async () => {
  const titles = new Set();
  for (const [path, meta] of Object.entries(PAGES)) {
    const p = await page(path);
    assert.equal(p.status, 200, path);
    assert.equal(p.index, meta.index, path);
    assert.equal((p.body.match(/<h1/g) || []).length, 1, path);
    assert.ok(!titles.has(p.title), `duplicate title ${p.title}`);
    titles.add(p.title);
    assert.ok(p.description.length >= 50 && p.description.length <= 200, `description length ${path}`);
  }
  assert.equal((await page('/news?category=defi')).index, false);
});

test('server-rendered internal links all resolve (no broken links)', async () => {
  const env = fakeEnv({ recent: [{ ...ITEM, published_at: ITEM.publishedAt, categories: 'central-banks', assets: '', countries: '' }] });
  const paths = ['/', '/news', '/about', '/editorial-policy', '/privacy', articlePath(ITEM), ...SECTIONS.map((s) => `/section/${s.key}`)];
  const links = new Set();
  for (const p of paths) for (const m of (await page(p, env)).body.matchAll(/href="(\/[^"#]*)/g)) links.add(m[1]);
  for (const l of links) {
    const r = await page(l, env);
    assert.ok(r.status === 200 && !r.redirect, `broken internal link ${l}`);
  }
});

test('sections and static pages are complete in both languages', () => {
  assert.ok(inSection(SECTIONS.find((s) => s.key === 'macro'), ITEM));
  assert.ok(!inSection(SECTIONS.find((s) => s.key === 'markets'), { categories: ['markets'], assets: ['BTC'] }));
  for (const [path, p] of Object.entries(STATIC_PAGES)) {
    assert.equal(p.en.length, p.es.length, path);
    assert.ok(PAGES[path].en && PAGES[path].es, path);
  }
});
