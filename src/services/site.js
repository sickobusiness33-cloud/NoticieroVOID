// Crawlable site layer: real URLs, server-rendered HTML for every public page, robots.txt,
// sitemaps, Google News sitemap and RSS. The SPA (public/js/app.js) takes over in the browser;
// crawlers and no-JS readers get the same headline, text and links in the initial HTML.
// Everything is read from D1 (articles archive + VOID Report stories): no feed fetches here.

import { SITE_NAME, PAGES, SECTIONS, ID_RE, articlePath, sectionPath, inSection, esc, clip, headTags, ldScript,
  organizationLd, websiteLd, breadcrumbLd, newsArticleLd, urlsetXml, sitemapIndexXml, newsSitemapXml, rssXml } from '../../public/js/shared/seo.js';
import { STATIC_PAGES } from '../../public/js/shared/pages.js';
import { CATALOG } from '../adapters/fred.js';
import * as news from './news.js';
import { getStory } from './story.js';
import { log } from '../lib/core.js';

export const siteUrl = (env, url) => (env.SITE_URL || url.origin).replace(/\/+$/, '');

const xml = (body, type = 'application/xml') => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=900' } });
const redirect = (to) => new Response(null, { status: 301, headers: { location: to, 'cache-control': 'public, max-age=3600' } });

// ---------- crawl files ----------
export function robots(site) {
  return `User-agent: *\nAllow: /\nDisallow: /api/admin/\n\nSitemap: ${site}/sitemap.xml\nSitemap: ${site}/news-sitemap.xml\n`;
}

async function storyRows(env, { sinceHours, limit }) {
  if (!env.DB) return [];
  const since = sinceHours ? new Date(Date.now() - sinceHours * 3600e3).toISOString() : '0';
  const { results } = await env.DB.prepare(`SELECT a.id, a.title, a.lang, a.excerpt, s.created_at AS createdAt, s.paragraphs FROM stories s
    JOIN articles a ON a.id = s.id AND a.lang = s.lang WHERE s.status = 'ok' AND a.official = 0 AND s.created_at >= ? ORDER BY s.created_at DESC LIMIT ?`).bind(since, limit).all();
  return results;
}

const indexablePaths = () => [
  ...Object.entries(PAGES).filter(([, p]) => p.index).map(([path]) => path),
  ...SECTIONS.map((s) => sectionPath(s.key)),
  ...Object.keys(CATALOG).map((id) => `/macro/${id}`),
];

export async function crawlFile(path, env, site) {
  if (path === '/robots.txt') return new Response(robots(site), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (path === '/sitemap.xml') return xml(sitemapIndexXml([`${site}/sitemaps/pages.xml`, `${site}/sitemaps/articles.xml`]));
  if (path === '/sitemaps/pages.xml') return xml(urlsetXml(indexablePaths().map((p) => ({ loc: site + p }))));
  if (path === '/sitemaps/articles.xml') {
    const rows = await storyRows(env, { limit: 5000 });
    return xml(urlsetXml(rows.map((r) => ({ loc: site + articlePath(r), lastmod: r.createdAt }))));
  }
  if (path === '/news-sitemap.xml') {
    const rows = await storyRows(env, { sinceHours: 48, limit: 1000 });
    return xml(newsSitemapXml(rows.map((r) => ({ loc: site + articlePath(r), lang: r.lang, published: r.createdAt, title: r.title }))));
  }
  if (path === '/rss.xml') {
    const rows = await storyRows(env, { limit: 50 });
    return xml(rssXml(site, rows.map((r) => ({ loc: site + articlePath(r), title: r.title, published: r.createdAt, description: clip(JSON.parse(r.paragraphs || '[]')[0] || r.excerpt, 300) }))), 'application/rss+xml');
  }
  return null;
}

// ---------- HTML fragments ----------
const fmtDate = (iso, lang) => { try { return new Date(iso).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'; } catch { return ''; } };
const link = (it) => `<a href="${esc(articlePath(it))}">${esc(it.title)}</a>`;
const list = (items) => `<ul class="ssr-list">${items.map((it) => `<li>${link(it)} <small>${esc(it.source)}</small></li>`).join('')}</ul>`;
const sectionOf = (it) => SECTIONS.find((s) => inSection(s, it));
const footerLinks = () => `<nav class="ssr-foot" aria-label="Site">${SECTIONS.map((s) => `<a href="${sectionPath(s.key)}">${esc(s.en)}</a>`).join(' · ')} · <a href="/news">All news</a> · <a href="/about">About</a> · <a href="/editorial-policy">Editorial policy</a> · <a href="/privacy">Privacy</a></nav>`;

function frontBody(items) {
  const blocks = SECTIONS.map((s) => {
    const its = items.filter((it) => inSection(s, it)).slice(0, 6);
    return its.length ? `<section><h2><a href="${sectionPath(s.key)}">${esc(s.en)}</a></h2>${list(its)}</section>` : '';
  }).join('');
  return `<h1>${esc(SITE_NAME)}: markets, macro and crypto news</h1><p>${esc(PAGES['/'].desc)}</p><section><h2>Latest</h2>${list(items.slice(0, 15))}</section>${blocks}${footerLinks()}`;
}

function staticBody(path) {
  const p = PAGES[path];
  return `<h1>${esc(p.en)}</h1>${STATIC_PAGES[path].en.map(([h, ps, id]) => `${h ? `<h2${id ? ` id="${id}"` : ''}>${esc(h)}</h2>` : ''}${ps.map((x) => `<p>${esc(x)}</p>`).join('')}`).join('')}${footerLinks()}`;
}

function articleBody(item, story, related) {
  const sec = sectionOf(item);
  const ok = story?.status === 'ok';
  return `<nav class="crumbs"><a href="/">Front page</a>${sec ? ` › <a href="${sectionPath(sec.key)}">${esc(sec.en)}</a>` : ''}</nav>
<article><h1>${esc(item.title)}</h1>${item.excerpt ? `<p>${esc(item.excerpt)}</p>` : ''}
<p><b>${esc(item.source)}</b> · <time datetime="${esc(item.publishedAt)}">${esc(fmtDate(item.publishedAt, item.lang))}</time></p>
${item.image ? `<figure><img src="${esc(item.image)}" alt="${esc(item.title)}" referrerpolicy="no-referrer" loading="lazy"><figcaption>Image: ${esc(item.source)}</figcaption></figure>` : ''}
${ok ? `<section><h2>${item.lang === 'es' ? 'Informe VOID' : 'VOID Report'}${story.headline ? `: ${esc(story.headline)}` : ''}</h2>${story.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
<p><small>${item.lang === 'es' ? 'Redactado con IA por Noticiero VOID a partir de los hechos publicados por' : 'Written with AI by Noticiero VOID from facts reported by'} ${story.sources.map((s) => esc(s.source)).join(', ')}. <a href="/editorial-policy#ai">${item.lang === 'es' ? 'Cómo lo hacemos' : 'How we do it'}</a> · <time datetime="${esc(story.generatedAt)}">${esc(fmtDate(story.generatedAt, item.lang))}</time></small></p></section>` : ''}
<p><a href="${esc(item.url)}" rel="noopener">${item.lang === 'es' ? 'Leer la noticia completa en' : 'Read the full story at'} ${esc(item.source)}</a></p></article>
${related.length ? `<section><h2>${item.lang === 'es' ? 'Relacionadas' : 'Related'}</h2>${list(related)}</section>` : ''}${footerLinks()}`;
}

// ---------- page resolution ----------
// Returns { status, title, description, index, lang, body, ld[], type, image, published, modified } or { redirect }.
export async function resolvePage(url, env, site) {
  const path = url.pathname;
  if (path !== '/' && path.endsWith('/')) return { redirect: site + path.replace(/\/+$/, '') + url.search };
  const parts = path.split('/').filter(Boolean);

  // /news/:id/:slug is canonical; /news/:id, wrong slugs and legacy /article/:id redirect in one hop.
  if ((parts[0] === 'news' || parts[0] === 'article') && ID_RE.test(parts[1] || '')) {
    const item = env.DB ? await news.getArchived(env, parts[1]) : null;
    if (!item) return notFound();
    const canonical = articlePath(item);
    if (path !== canonical) return { redirect: site + canonical };
    const story = await getStory(env, item.id, item.lang === 'es' ? 'es' : 'en');
    const ok = story?.status === 'ok';
    const sec = sectionOf(item);
    const related = (await news.recentArchived(env, { limit: 120, sinceHours: 72 })).filter((r) => r.id !== item.id && sec && inSection(sec, r)).slice(0, 8);
    const crumbs = [['Noticiero VOID', '/'], ...(sec ? [[sec.en, sectionPath(sec.key)]] : []), [clip(item.title, 80), canonical]];
    return {
      status: 200, lang: item.lang, type: 'article', image: item.image,
      title: `${clip(item.title, 90)} | ${SITE_NAME}`,
      description: clip(ok ? story.paragraphs[0] : item.excerpt || item.title, 160),
      // Only pages with VOID's own report are offered for indexing; headline-only pages and
      // mirrored official releases stay noindex (thin or duplicate of the source).
      index: ok && !item.official,
      published: ok ? story.generatedAt : null, modified: ok ? story.generatedAt : null,
      body: articleBody(item, story, related),
      ld: [breadcrumbLd(site, crumbs), ...(ok && !item.official ? [newsArticleLd(site, { item, story, section: sec?.en })] : [])],
    };
  }

  if (parts[0] === 'section' && parts.length === 2) {
    const sec = SECTIONS.find((s) => s.key === parts[1]);
    if (!sec) return notFound();
    const items = (await news.recentArchived(env, { limit: 300, sinceHours: 72 })).filter((it) => inSection(sec, it)).slice(0, 40);
    return {
      status: 200, lang: 'en', title: `${sec.en} news | ${SITE_NAME}`, description: sec.desc[0], index: true,
      body: `<nav class="crumbs"><a href="/">Front page</a></nav><h1>${esc(sec.en)}</h1><p>${esc(sec.desc[0])}</p>${items.length ? list(items) : '<p>No stories in the last 72 hours.</p>'}${footerLinks()}`,
      ld: [breadcrumbLd(site, [['Noticiero VOID', '/'], [sec.en, sectionPath(sec.key)]])],
    };
  }

  if (parts[0] === 'macro' && parts.length === 2) {
    const ind = CATALOG[parts[1]];
    if (!ind) return notFound();
    return {
      status: 200, lang: 'en', title: `${ind.name} (${parts[1]}) — latest data and history | ${SITE_NAME}`, index: true,
      description: `${ind.name}: latest value, history and percentiles from FRED (St. Louis Fed), ${ind.freq} data.`,
      body: `<nav class="crumbs"><a href="/">Front page</a> › <a href="/macro">Macro</a></nav><h1>${esc(ind.name)} (${esc(parts[1])})</h1><p>Latest value, history and 5-year percentile, sourced from FRED (Federal Reserve Bank of St. Louis). Frequency: ${esc(ind.freq)}. Unit: ${esc(ind.unit)}.</p>${footerLinks()}`,
      ld: [breadcrumbLd(site, [['Noticiero VOID', '/'], ['Macro', '/macro'], [ind.name, path]])],
    };
  }

  const p = PAGES[path];
  if (p) {
    // Filtered/parameterised variants of a page are not separate documents.
    const index = p.index && !url.search;
    let body = `<h1>${esc(p.en)}</h1><p>${esc(p.desc)}</p>${footerLinks()}`;
    let ld = [];
    if (STATIC_PAGES[path]) body = staticBody(path);
    if (path === '/' || path === '/news') {
      const items = await news.recentArchived(env, { limit: 200, sinceHours: 48 });
      body = path === '/' ? frontBody(items) : `<h1>${esc(p.en)}</h1><p>${esc(p.desc)}</p>${list(items.slice(0, 60))}${footerLinks()}`;
      if (path === '/') ld = [organizationLd(site), websiteLd(site)];
    }
    if (path === '/about') ld = [organizationLd(site)];
    return { status: 200, lang: 'en', title: path === '/' ? p.en : `${p.en} | ${SITE_NAME}`, description: p.desc, index, body, ld };
  }
  return notFound();
}

function notFound() {
  return { status: 404, lang: 'en', title: `Page not found | ${SITE_NAME}`, description: 'This page does not exist.', index: false,
    body: `<h1>Page not found</h1><p>The page you requested does not exist or the story has left our archive. <a href="/">Go to the front page</a>.</p>${footerLinks()}`, ld: [] };
}

// Injects the resolved page into the SPA shell (index.html served by the ASSETS binding).
export async function renderPage(request, env, shellResponse) {
  const url = new URL(request.url);
  const site = siteUrl(env, url);
  let page;
  try {
    page = await resolvePage(url, env, site);
  } catch (e) {
    log('error', 'ssr_failed', { path: url.pathname, error: e.message });
    return { response: shellResponse, status: 200 };
  }
  if (page.redirect) return { redirect: redirect(page.redirect) };
  const head = headTags({ site, path: url.pathname, title: page.title, description: page.description, index: page.index,
    image: page.image, type: page.type, lang: page.lang, published: page.published, modified: page.modified,
    verification: { google: env.GOOGLE_SITE_VERIFICATION, bing: env.BING_SITE_VERIFICATION } }) + page.ld.map(ldScript).join('');
  const rewritten = new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('lang', page.lang || 'en'); } })
    .on('title', { element(el) { el.setInnerContent(page.title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', page.description); } })
    .on('head', { element(el) { el.append(head, { html: true }); } })
    .on('main#app', { element(el) { el.setInnerContent(`<div class="ssr">${page.body}</div>`, { html: true }); } })
    .transform(shellResponse);
  return { response: rewritten, status: page.status };
}
