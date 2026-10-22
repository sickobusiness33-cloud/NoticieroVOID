// News sources (public RSS/Atom feeds, verified reachable 2026-10-22) and
// scheduled-event sources. We store headline, short excerpt, timestamp and link only.

import { upstream } from '../lib/core.js';

export const FEEDS = [
  // Official / institutional (English)
  { id: 'fed-press', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', lang: 'en', official: true },
  { id: 'fed-speeches', source: 'Federal Reserve (speeches)', url: 'https://www.federalreserve.gov/feeds/speeches.xml', lang: 'en', official: true },
  { id: 'ecb-press', source: 'European Central Bank', url: 'https://www.ecb.europa.eu/rss/press.html', lang: 'en', official: true },
  { id: 'bea', source: 'U.S. BEA', url: 'https://www.bea.gov/rss/rss.xml', lang: 'en', official: true },
  // Markets & crypto (English)
  { id: 'coindesk', source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', lang: 'en' },
  { id: 'cointelegraph', source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', lang: 'en' },
  { id: 'decrypt', source: 'Decrypt', url: 'https://decrypt.co/feed', lang: 'en' },
  { id: 'theblock', source: 'The Block', url: 'https://www.theblock.co/rss.xml', lang: 'en' },
  { id: 'cryptobriefing', source: 'Crypto Briefing', url: 'https://cryptobriefing.com/feed/', lang: 'en' },
  { id: 'bbc-business', source: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', lang: 'en' },
  // Spanish
  { id: 'criptonoticias', source: 'CriptoNoticias', url: 'https://www.criptonoticias.com/feed/', lang: 'es' },
  { id: 'beincrypto-es', source: 'BeInCrypto (ES)', url: 'https://es.beincrypto.com/feed/', lang: 'es' },
];

export async function fetchFeed(feed) {
  return upstream(`rss:${feed.id}`, feed.url, { as: 'text', timeoutMs: 10000, retries: 1, init: { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } } });
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
    .map((date) => ({ date, time: '14:15', tz: 'Europe/Frankfurt', region: 'EU', event: 'ECB monetary policy decision', eventEs: 'Decisión de política monetaria del BCE', source: 'European Central Bank', sourceUrl: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html', markets: ['EUR', 'Bunds', 'USD'], importance: 'high' })),
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
