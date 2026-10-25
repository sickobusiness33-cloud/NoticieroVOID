// News sources (public RSS/Atom feeds, verified reachable 2026-10-22) and
// scheduled-event sources. We store headline, short excerpt, timestamp and link only.

import { upstream } from '../lib/core.js';

export const FEEDS = [
  // Official / institutional (English)
  { id: 'fed-press', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', lang: 'en', official: true },
  { id: 'fed-speeches', source: 'Federal Reserve (speeches)', url: 'https://www.federalreserve.gov/feeds/speeches.xml', lang: 'en', official: true },
  { id: 'ecb-press', source: 'European Central Bank', url: 'https://www.ecb.europa.eu/rss/press.html', lang: 'en', official: true },
  { id: 'ecb-blog', source: 'ECB Blog', url: 'https://www.ecb.europa.eu/rss/blog.html', lang: 'en', official: true },
  { id: 'boe', source: 'Bank of England', url: 'https://www.bankofengland.co.uk/rss/news', lang: 'en', official: true },
  { id: 'bea', source: 'U.S. BEA', url: 'https://www.bea.gov/rss/rss.xml', lang: 'en', official: true },
  // Markets, macro, commodities, FX (English)
  { id: 'marketwatch', source: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', lang: 'en' },
  { id: 'investing', source: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', lang: 'en' },
  { id: 'investing-commod', source: 'Investing.com (commodities)', url: 'https://www.investing.com/rss/news_11.rss', lang: 'en' },
  { id: 'economist', source: 'The Economist', url: 'https://www.economist.com/finance-and-economics/rss.xml', lang: 'en' },
  { id: 'forexlive', source: 'ForexLive', url: 'https://www.forexlive.com/feed/news', lang: 'en' },
  { id: 'oilprice', source: 'OilPrice.com', url: 'https://oilprice.com/rss/main', lang: 'en' },
  { id: 'mining', source: 'MINING.COM', url: 'https://www.mining.com/feed/', lang: 'en' },
  { id: 'bbc-business', source: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', lang: 'en' },
  // Crypto (English)
  { id: 'coindesk', source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', lang: 'en' },
  { id: 'cointelegraph', source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', lang: 'en' },
  { id: 'decrypt', source: 'Decrypt', url: 'https://decrypt.co/feed', lang: 'en' },
  { id: 'theblock', source: 'The Block', url: 'https://www.theblock.co/rss.xml', lang: 'en' },
  { id: 'cryptobriefing', source: 'Crypto Briefing', url: 'https://cryptobriefing.com/feed/', lang: 'en' },
  { id: 'cryptoslate', source: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', lang: 'en' },
  { id: 'bitcoinmagazine', source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/', lang: 'en' },
  { id: 'newsbtc', source: 'NewsBTC', url: 'https://www.newsbtc.com/feed/', lang: 'en' },
  // AI, technology, Web3 and stocks (English). `topics` are added to every item of the feed.
  { id: 'techcrunch-ai', source: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', lang: 'en', topics: ['ai', 'technology'] },
  { id: 'verge-ai', source: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', lang: 'en', topics: ['ai'] },
  { id: 'mit-tr', source: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', lang: 'en', topics: ['technology'] },
  { id: 'arstechnica', source: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en', topics: ['technology'] },
  { id: 'verge', source: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', topics: ['technology'] },
  { id: 'blockworks', source: 'Blockworks', url: 'https://blockworks.co/feed', lang: 'en', topics: ['web3'] },
  { id: 'thedefiant', source: 'The Defiant', url: 'https://thedefiant.io/api/feed', lang: 'en', topics: ['web3'] },
  { id: 'seekingalpha', source: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml', lang: 'en', topics: ['stocks'] },
  // Major international outlets (English/Spanish editions). tier: 1 = extra weight in ranking.
  // Germany
  { id: 'dw-en', source: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all', lang: 'en', tier: 1, country: 'DE' },
  { id: 'dw-es', source: 'DW Español', url: 'https://rss.dw.com/rdf/rss-sp-all', lang: 'es', tier: 1, country: 'DE' },
  { id: 'spiegel-intl', source: 'Der Spiegel', url: 'https://www.spiegel.de/international/index.rss', lang: 'en', tier: 1, country: 'DE' },
  // United States
  { id: 'nyt-business', source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', lang: 'en', tier: 1, country: 'US' },
  { id: 'wsj-markets', source: 'The Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', lang: 'en', tier: 1, country: 'US' },
  { id: 'npr-business', source: 'NPR', url: 'https://feeds.npr.org/1006/rss.xml', lang: 'en', tier: 1, country: 'US' },
  // China (CGTN is state media and is labelled as such on the page)
  { id: 'cgtn-business', source: 'CGTN', url: 'https://www.cgtn.com/subscribe/rss/section/business.xml', lang: 'en', tier: 1, country: 'CN' },
  { id: 'scmp-china', source: 'South China Morning Post', url: 'https://www.scmp.com/rss/4/feed/', lang: 'en', tier: 1, country: 'CN' },
  { id: 'scmp-business', source: 'South China Morning Post', url: 'https://www.scmp.com/rss/92/feed/', lang: 'en', tier: 1, country: 'CN' },
  // North Korea (KCNA and Rodong Sinmun are not reachable from outside the country)
  { id: 'yonhap-nk', source: 'Yonhap', url: 'https://en.yna.co.kr/RSS/nk.xml', lang: 'en', tier: 1, country: 'KP', topics: ['geopolitics'] },
  { id: 'nknews', source: 'NK News', url: 'https://www.nknews.org/feed/', lang: 'en', tier: 1, country: 'KP', topics: ['geopolitics'] },
  // Central and Western Europe
  { id: 'france24-en', source: 'France 24', url: 'https://www.france24.com/en/business/rss', lang: 'en', tier: 1, country: 'EU' },
  { id: 'france24-es', source: 'France 24', url: 'https://www.france24.com/es/econom%C3%ADa/rss', lang: 'es', tier: 1, country: 'EU' },
  { id: 'euronews-en', source: 'Euronews', url: 'https://www.euronews.com/rss?level=vertical&name=business', lang: 'en', tier: 1, country: 'EU' },
  { id: 'euronews-es', source: 'Euronews', url: 'https://es.euronews.com/rss?level=theme&name=business', lang: 'es', tier: 1, country: 'EU' },
  { id: 'lemonde-en', source: 'Le Monde', url: 'https://www.lemonde.fr/en/economy/rss_full.xml', lang: 'en', tier: 1, country: 'EU' },
  { id: 'elpais-economia', source: 'El País', url: 'https://elpais.com/rss/economia/portada.xml', lang: 'es', tier: 1, country: 'EU' },
  // Spanish
  { id: 'xataka', source: 'Xataka', url: 'https://www.xataka.com/feedburner.xml', lang: 'es', topics: ['technology'] },
  { id: 'genbeta', source: 'Genbeta', url: 'https://www.genbeta.com/feedburner.xml', lang: 'es', topics: ['technology'] },
  { id: 'investing-es', source: 'Investing.com España', url: 'https://es.investing.com/rss/news.rss', lang: 'es' },
  { id: 'investing-es-mkts', source: 'Investing.com España (mercados)', url: 'https://es.investing.com/rss/news_1.rss', lang: 'es' },
  { id: 'expansion', source: 'Expansión', url: 'https://e00-expansion.uecdn.es/rss/mercados.xml', lang: 'es' },
  { id: 'europapress', source: 'Europa Press', url: 'https://www.europapress.es/rss/rss.aspx?ch=00136', lang: 'es' },
  { id: 'elfinanciero', source: 'El Financiero', url: 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml', lang: 'es' },
  { id: 'ambito', source: 'Ámbito', url: 'https://www.ambito.com/rss/pages/economia.xml', lang: 'es' },
  { id: 'infobae', source: 'Infobae Economía', url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/economia/', lang: 'es' },
  { id: 'criptonoticias', source: 'CriptoNoticias', url: 'https://www.criptonoticias.com/feed/', lang: 'es' },
  { id: 'beincrypto-es', source: 'BeInCrypto (ES)', url: 'https://es.beincrypto.com/feed/', lang: 'es' },
];

// Image CDNs that refuse hot-linked requests (verified HTTP 403): drop their thumbnails
// so the page falls back cleanly instead of showing broken images.
export const NO_HOTLINK_IMAGES = /(^|\.)content-media\.investing\.com$/i;

// Some publishers reject bot-only user agents; this identifies us while staying browser-compatible.
const FEED_UA = 'Mozilla/5.0 (compatible; NoticieroVOID/1.0; +https://github.com/sickobusiness33-cloud/NoticieroVOID)';

export async function fetchFeed(feed) {
  return upstream(`rss:${feed.id}`, feed.url, { as: 'text', timeoutMs: 10000, retries: 1, init: { headers: { 'user-agent': FEED_UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } } });
}

// Central bank meeting dates, copied from the official calendars on 2026-10-22:
//   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
//   https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
// Second day of each meeting (decision day). Refresh this list when calendars change.
export const CB_MEETINGS = [
  ...['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
    '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08']
    .map((date) => ({ date, time: '14:00', tz: 'America/New_York', region: 'US', event: 'FOMC rate decision', eventEs: 'Decisión de tipos del FOMC', source: 'Federal Reserve', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', markets: ['UST', 'USD', 'SPX', 'BTC'], importance: 'high' })),
  ...['2026-10-29', '2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-10', '2027-07-22', '2027-09-09', '2027-10-28', '2027-12-16']
    .map((date) => ({ date, time: '14:15', tz: 'Europe/Berlin', region: 'EU', event: 'ECB monetary policy decision', eventEs: 'Decisión de política monetaria del BCE', source: 'European Central Bank', sourceUrl: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html', markets: ['EUR', 'Bunds', 'USD'], importance: 'high' })),
];

// U.S. Treasury upcoming auctions (FiscalData, public).
export async function treasuryAuctions() {
  const u = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions?sort=-record_date&page[size]=60';
  const body = await upstream('treasury', u, { timeoutMs: 12000 });
  const rows = body.data || [];
  const latest = rows[0]?.record_date;
  return rows.filter((r) => r.record_date === latest).map((r) => ({
    date: r.auction_date, time: '11:30/13:00', tz: 'America/New_York', region: 'US',
    event: `Treasury auction: ${r.security_term} ${r.security_type}${r.reopening === 'Yes' ? ' (reopening)' : ''}`,
    eventEs: `Subasta del Tesoro: ${r.security_term} ${r.security_type}${r.reopening === 'Yes' ? ' (reapertura)' : ''}`,
    offeringUsd: Number(r.offering_amt) || null, source: 'U.S. Treasury (FiscalData)',
    sourceUrl: 'https://fiscaldata.treasury.gov/datasets/upcoming-auctions/', markets: ['UST'], importance: r.security_type === 'Bill' ? 'low' : 'medium',
    note: 'Auction close times vary by security; see TreasuryDirect announcement.',
  }));
}

// FRED releases we surface on the calendar. Matched by the official release *name*
// returned by the API (not by numeric id), mapped to the series used for "actual".
export const KEY_RELEASES = [
  { match: /^Consumer Price Index$/i, event: 'CPI (Consumer Price Index)', eventEs: 'IPC (Índice de Precios al Consumidor)', series: 'CPIAUCSL', transform: 'yoy', markets: ['UST', 'USD', 'SPX', 'BTC'], importance: 'high', time: '08:30' },
  { match: /^Employment Situation$/i, event: 'Employment Situation (payrolls)', eventEs: 'Situación del empleo (nóminas)', series: 'PAYEMS', transform: 'diff', markets: ['UST', 'USD', 'SPX', 'BTC'], importance: 'high', time: '08:30' },
  { match: /^Gross Domestic Product$/i, event: 'GDP (BEA)', eventEs: 'PIB (BEA)', series: 'A191RL1Q225SBEA', markets: ['UST', 'USD', 'SPX'], importance: 'high', time: '08:30' },
  { match: /^Personal Income and Outlays$/i, event: 'Personal Income & Outlays (PCE)', eventEs: 'Ingresos y gastos personales (PCE)', series: 'PCEPILFE', transform: 'yoy', markets: ['UST', 'USD'], importance: 'high', time: '08:30' },
  { match: /Unemployment Insurance Weekly Claims/i, event: 'Initial jobless claims', eventEs: 'Solicitudes semanales de desempleo', series: 'ICSA', markets: ['UST', 'USD'], importance: 'medium', time: '08:30' },
  { match: /^Producer Price Index$/i, event: 'Producer Price Index', eventEs: 'Índice de Precios al Productor', markets: ['UST', 'USD'], importance: 'medium', time: '08:30' },
  { match: /^Advance Monthly Sales for Retail and Food Services$/i, event: 'Retail sales', eventEs: 'Ventas minoristas', markets: ['USD', 'SPX'], importance: 'medium', time: '08:30' },
  { match: /^FOMC Press Release$/i, skip: true },
];
