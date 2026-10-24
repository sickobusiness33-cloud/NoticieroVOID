// Shared SEO model: canonical URLs, sections, per-route metadata, JSON-LD and sitemap XML.
// Used by the Worker (server-rendered HTML for crawlers) and by the SPA (links), so both
// always agree on the canonical URL of every page.

export const SITE_NAME = 'Noticiero VOID';
export const CONTACT_URL = 'https://github.com/sickobusiness33-cloud/NoticieroVOID/issues';
export const ID_RE = /^[a-f0-9]{20}$/;

export function slugify(s, max = 80) {
  const slug = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (slug.length > max ? slug.slice(0, max + 1).replace(/-[^-]*$/, '').slice(0, max) : slug) || 'story';
}

export const articlePath = (it) => `/news/${it.id}/${slugify(it.title)}`;
export const sectionPath = (key) => `/section/${key}`;

export const SECTIONS = [
  { key: 'macro', en: 'Economy & Central Banks', es: 'Economía y bancos centrales', cats: ['central-banks', 'inflation', 'labor', 'growth', 'geopolitics'],
    desc: ['Central bank decisions, inflation, jobs, growth data and geopolitics, with links to every original report.', 'Bancos centrales, inflación, empleo, crecimiento y geopolítica, con enlace a cada informe original.'] },
  { key: 'ai', en: 'AI', es: 'Inteligencia artificial', cats: ['ai'],
    desc: ['Artificial intelligence news: models, agents, AI companies, chips and automation, linked to each source.', 'Noticias de inteligencia artificial: modelos, agentes, empresas de IA, chips y automatización, con enlace a cada fuente.'] },
  { key: 'markets', en: 'Markets', es: 'Mercados', cats: ['rates-bonds', 'markets'], notCrypto: true,
    desc: ['Stocks, bonds and rates: the latest market headlines from major financial publishers.', 'Bolsa, bonos y tipos: los últimos titulares de mercado de los principales medios financieros.'] },
  { key: 'crypto', en: 'Crypto', es: 'Cripto', cats: ['etf-flows', 'regulation', 'defi', 'stablecoins', 'memecoins'], assets: ['BTC', 'ETH', 'SOL', 'XRP'],
    desc: ['Bitcoin, Ethereum, Solana, ETFs, regulation, DeFi and stablecoins news.', 'Noticias de Bitcoin, Ethereum, Solana, ETF, regulación, DeFi y stablecoins.'] },
  { key: 'web3', en: 'Web3', es: 'Web3', cats: ['web3', 'defi'],
    desc: ['Web3 news: blockchain protocols, layer 2s, DeFi, tokenization and decentralized infrastructure.', 'Noticias Web3: protocolos blockchain, capas 2, DeFi, tokenización e infraestructura descentralizada.'] },
  { key: 'stocks', en: 'Stocks', es: 'Bolsa', cats: ['stocks'], notCrypto: true,
    desc: ['Stock market news: equities, earnings, IPOs, indices and Wall Street, linked to each publisher.', 'Noticias de bolsa: acciones, resultados, salidas a bolsa, índices y Wall Street, con enlace a cada medio.'] },
  { key: 'technology', en: 'Technology', es: 'Tecnología', cats: ['technology'],
    desc: ['Technology news: software, semiconductors, AI infrastructure, startups and innovation.', 'Noticias de tecnología: software, semiconductores, infraestructura de IA, startups e innovación.'] },
  { key: 'finance', en: 'Finance', es: 'Finanzas', cats: ['rates-bonds', 'fx-dollar', 'commodities', 'etf-flows'], notCrypto: true,
    desc: ['Finance news: bonds and rates, currencies, commodities, funds and investment products.', 'Noticias de finanzas: bonos y tipos, divisas, materias primas, fondos y productos de inversión.'] },
  { key: 'commodities', en: 'Commodities', es: 'Materias primas', cats: ['commodities'],
    desc: ['Oil, gold, metals and agricultural commodities news.', 'Noticias de petróleo, oro, metales y materias primas agrícolas.'] },
  { key: 'fx', en: 'Currencies', es: 'Divisas', cats: ['fx-dollar'],
    desc: ['US dollar, euro, yen and emerging-market currency news.', 'Noticias del dólar, el euro, el yen y las divisas emergentes.'] },
  { key: 'world', en: 'Geopolitics', es: 'Geopolítica', cats: ['geopolitics'],
    desc: ['Geopolitical events that move global markets.', 'Acontecimientos geopolíticos que mueven los mercados globales.'] },
];
const MAJORS = ['BTC', 'ETH', 'SOL', 'XRP'];
export function inSection(s, it) {
  const hit = it.categories?.some((c) => s.cats.includes(c)) || (s.assets && it.assets?.some((a) => s.assets.includes(a)));
  return !!hit && !(s.notCrypto && it.assets?.some((a) => MAJORS.includes(a)));
}

// App routes: [path, en title, es title, en description, indexable]
const D = 'Bilingual financial news and market intelligence: macro, markets and crypto, with sources linked.';
export const PAGES = {
  '/': { en: 'Noticiero VOID — Markets, Macro & Crypto News', es: 'Noticiero VOID — Noticias de mercados, macro y cripto', desc: 'Financial news front page in English and Spanish: central banks, markets, crypto, commodities and currencies, with links to every original publisher.', index: true },
  '/news': { en: 'Latest financial news feed', es: 'Últimas noticias financieras', desc: 'Live feed of financial headlines from 30+ publishers and official sources, filterable by topic, asset and language.', index: true },
  '/terminal': { en: 'Command Center — live market dashboard', es: 'Centro de mando — panel de mercados', desc: 'Live market dashboard: crypto prices, macro indicators, market regime and liquidity, with source and update time on every widget.', index: true },
  '/macro': { en: 'Macro indicators — inflation, rates, jobs, growth', es: 'Indicadores macro — inflación, tipos, empleo, crecimiento', desc: 'US macroeconomic indicators from FRED with history, percentiles and release dates.', index: true },
  '/calendar': { en: 'Economic calendar — central banks, data releases, earnings', es: 'Calendario económico — bancos centrales, datos, resultados', desc: 'Economic and crypto calendar with central bank meetings, official data releases and earnings, sourced from the publishers.', index: true },
  '/liquidity': { en: 'Liquidity Lab — Fed balance sheet and net liquidity', es: 'Laboratorio de liquidez — balance de la Fed', desc: 'Federal Reserve balance sheet, TGA, reverse repo and net liquidity proxy from FRED data.', index: true },
  '/crypto-macro': { en: 'Crypto Macro — Bitcoin vs global markets', es: 'Cripto macro — Bitcoin frente a los mercados', desc: 'How crypto relates to rates, the dollar and risk assets, measured from real market data.', index: true },
  '/memecoins': { en: 'Memecoin terminal — new launches and on-chain activity', es: 'Terminal de memecoins — lanzamientos y actividad on-chain', desc: 'Memecoin market regime, new DEX pools and activity/risk signals from on-chain data. Not investment advice.', index: true },
  '/lab': { en: 'Quantum Lab — whale tracker and backtests', es: 'Laboratorio Cuántico — rastreador de ballenas', desc: 'Search tokens and wallets, view holders and on-chain activity across Ethereum, Base, Arbitrum, Optimism, Polygon and Solana.', index: true },
  '/analyst': { en: 'AI Analyst', es: 'Analista IA', desc: D, index: false },
  '/saved': { en: 'Saved stories', es: 'Noticias guardadas', desc: D, index: false },
  '/status': { en: 'Data status', es: 'Estado de datos', desc: D, index: false },
  '/about': { en: 'About Noticiero VOID', es: 'Sobre Noticiero VOID', desc: 'Who we are, how Noticiero VOID works, where our data comes from and how to contact us.', index: true },
  '/editorial-policy': { en: 'Editorial policy, AI use and corrections', es: 'Política editorial, uso de IA y correcciones', desc: 'How Noticiero VOID selects sources, uses AI, separates news from advertising and handles corrections.', index: true },
  '/prediction-markets': { en: 'Prediction markets — Polymarket prices on Fed, crypto, AI and stocks', es: 'Mercados de predicción — precios de Polymarket', desc: 'Live Polymarket prices for economy, Fed, crypto, AI and stock events, plus prediction-market news. Market prices, not forecasts.', index: true },
  '/newsletter': { en: 'Newsletter and VOID Reports', es: 'Newsletter e Informes VOID', desc: 'The latest VOID Reports from Noticiero VOID and how to follow them by RSS. Email newsletter status and plans.', index: true },
  '/pro': { en: 'VOID PRO — €7.50 per month', es: 'VOID PRO — 7,50 € al mes', desc: 'VOID PRO membership: no VOID-managed ads and saved stories synced to your account. €7.50 per month, cancel anytime.', index: true },
  '/privacy': { en: 'Privacy and cookies', es: 'Privacidad y cookies', desc: 'What data Noticiero VOID and its advertising partner process, and your choices.', index: true },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clip = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`; };

// <head> tags for one page. `site` is the canonical origin (no trailing slash).
export function headTags({ site, path, title, description, index = true, image, type = 'website', lang = 'en', published, modified, verification = {} }) {
  const url = site + path;
  const img = image || `${site}/assets/og-default.png`;
  const t = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta name="robots" content="${index ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow'}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:locale" content="${lang === 'es' ? 'es_ES' : 'en_US'}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="${site}/rss.xml">`,
  ];
  if (published) t.push(`<meta property="article:published_time" content="${esc(published)}">`);
  if (modified) t.push(`<meta property="article:modified_time" content="${esc(modified)}">`);
  if (verification.google) t.push(`<meta name="google-site-verification" content="${esc(verification.google)}">`);
  if (verification.bing) t.push(`<meta name="msvalidate.01" content="${esc(verification.bing)}">`);
  return t.join('\n');
}

export const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

export const organizationLd = (site) => ({
  '@context': 'https://schema.org', '@type': 'NewsMediaOrganization', '@id': `${site}/#org`, name: SITE_NAME, url: `${site}/`,
  logo: { '@type': 'ImageObject', url: `${site}/assets/logo-512.png`, width: 512, height: 512 },
  publishingPrinciples: `${site}/editorial-policy`, correctionsPolicy: `${site}/editorial-policy#corrections`,
  actionableFeedbackPolicy: `${site}/editorial-policy#corrections`, contactPoint: { '@type': 'ContactPoint', contactType: 'editorial', url: CONTACT_URL },
});
export const websiteLd = (site) => ({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${site}/#website`, name: SITE_NAME, url: `${site}/`, inLanguage: ['en', 'es'], publisher: { '@id': `${site}/#org` } });

export function breadcrumbLd(site, crumbs) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: site + path })) };
}

// NewsArticle for a VOID Report page: the article body is VOID's own AI-written story,
// based on (and linking to) the publisher's original report.
export function newsArticleLd(site, { item, story, section }) {
  return {
    '@context': 'https://schema.org', '@type': 'NewsArticle', mainEntityOfPage: site + articlePath(item),
    headline: clip(item.title, 110), description: clip(item.excerpt || story.paragraphs[0], 200),
    image: [item.image || `${site}/assets/og-default.png`], inLanguage: item.lang,
    datePublished: story.generatedAt, dateModified: story.generatedAt,
    author: { '@type': 'Organization', name: `${SITE_NAME} (AI-assisted newsroom)`, url: `${site}/editorial-policy#ai` },
    publisher: { '@id': `${site}/#org`, '@type': 'NewsMediaOrganization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${site}/assets/logo-512.png` } },
    articleSection: section || undefined, isBasedOn: story.sources.map((s) => s.url), citation: story.sources.map((s) => s.url),
  };
}

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function urlsetXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `<url><loc>${xmlEsc(e.loc)}</loc>${e.lastmod ? `<lastmod>${xmlEsc(e.lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}
export function sitemapIndexXml(locs) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map((l) => `<sitemap><loc>${xmlEsc(l)}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`;
}
// Google News sitemap: articles published in the last 2 days, max 1000.
export function newsSitemapXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${entries.slice(0, 1000).map((e) => `<url><loc>${xmlEsc(e.loc)}</loc><news:news><news:publication><news:name>${SITE_NAME}</news:name><news:language>${e.lang}</news:language></news:publication><news:publication_date>${xmlEsc(e.published)}</news:publication_date><news:title>${xmlEsc(e.title)}</news:title></news:news></url>`).join('\n')}\n</urlset>\n`;
}
export function rssXml(site, entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${SITE_NAME}</title><link>${site}/</link><description>${xmlEsc(PAGES['/'].desc)}</description><atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml"/>\n${entries.map((e) => `<item><title>${xmlEsc(e.title)}</title><link>${xmlEsc(e.loc)}</link><guid isPermaLink="true">${xmlEsc(e.loc)}</guid><pubDate>${new Date(e.published).toUTCString()}</pubDate><description>${xmlEsc(e.description)}</description></item>`).join('\n')}\n</channel></rss>\n`;
}
