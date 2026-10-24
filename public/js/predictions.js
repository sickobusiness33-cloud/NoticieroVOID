// Prediction Markets (Polymarket prices + related news) and Newsletter (VOID Reports + RSS).
import { t, tr, getLang } from './i18n.js';
import { h, api, async, metaLine, fmtTime } from './ui.js';
import { adSlot } from './ads.js';
import { articlePath } from './shared/seo.js';

const fmtVol = (v) => (Number.isFinite(v) ? `$${v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0)}` : '—');
// Polymarket shares settle at $1: a price of 0.42 is 42¢ per share.
const cents = (p) => (Number.isFinite(p) ? `${(p * 100).toFixed(p < 0.01 ? 1 : 0)}¢` : '—');
const TAGS = { economy: ['Economy', 'Economía'], fed: ['Fed', 'Fed'], crypto: ['Crypto', 'Cripto'], stocks: ['Stocks', 'Bolsa'], finance: ['Finance', 'Finanzas'], ai: ['AI', 'IA'], tech: ['Tech', 'Tecnología'] };

export async function predictionMarkets() {
  document.title = `${tr('Prediction Markets', 'Mercados de predicción')} · Noticiero VOID`;
  const marketsBox = h('div'), newsBox = h('div');
  const root = h('div', { class: 'paper' },
    h('header', { class: 'masthead' }, h('h1', { class: 'mh-title' }, tr('Prediction Markets', 'Mercados de predicción')),
      h('p', { class: 'muted' }, tr('What traders are pricing on Polymarket for the economy, the Fed, crypto, AI and stocks.', 'Lo que cotizan los traders en Polymarket sobre economía, la Fed, cripto, IA y bolsa.'))),
    h('p', { class: 'notice' }, h('span', { class: 'label-rule' }, tr('MARKET PRICES', 'PRECIOS DE MERCADO')), ' ',
      tr('Each price is what a "Yes" share trades for on Polymarket (a share pays $1 if the event happens). These are traded prices, not VOID forecasts or calibrated probabilities, and thin markets can be volatile.',
        'Cada precio es lo que cotiza una participación "Sí" en Polymarket (paga 1 $ si el evento ocurre). Son precios negociados, no previsiones de VOID ni probabilidades calibradas, y los mercados con poca liquidez pueden ser volátiles.')),
    marketsBox, adSlot('leaderboard'),
    h('h2', { class: 'np-sec-title' }, h('span', null, tr('Prediction-market news', 'Noticias de mercados de predicción'))), newsBox);

  async(marketsBox, async () => {
    const d = await api('/api/prediction-markets');
    return [h('div', { class: 'pm-grid' }, d.events.slice(0, 24).map((e) => h('article', { class: 'pm-card' },
      h('div', { class: 'pm-top' }, h('span', { class: 'np-kicker' }, tr(...(TAGS[e.tag] || [e.tag, e.tag]))), h('span', { class: 'small muted' }, `${tr('24h vol.', 'Vol. 24h')} ${fmtVol(e.volume24h)}`)),
      h('h3', null, h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.title)),
      h('ul', { class: 'pm-list' }, e.markets.map((m) => h('li', null, h('span', null, m.label),
        m.price !== null ? h('b', null, cents(m.price)) : h('b', null, m.outcomes.map((o) => `${o.name} ${cents(o.price)}`).join(' · '))))),
      h('div', { class: 'pm-foot small muted' }, e.endDate ? `${tr('Ends', 'Cierra')} ${fmtTime(e.endDate)}` : '', e.marketCount > e.markets.length ? ` · +${e.marketCount - e.markets.length} ${tr('more', 'más')}` : '',
        ' · ', h('a', { href: e.url, target: '_blank', rel: 'noopener' }, 'Polymarket ↗'))))),
    metaLine(d.meta)];
  });
  async(newsBox, async () => {
    const d = await api(`/api/news?category=prediction-markets&lang=${getLang()}&limit=20&sort=time`);
    if (!d.items.length) return h('p', { class: 'muted' }, t('no_data'));
    return [h('ul', { class: 'ssr-list' }, d.items.map((it) => h('li', null, h('a', { href: articlePath(it) }, it.title), ' ', h('small', { class: 'muted' }, `${it.source} · ${fmtTime(it.publishedAt)}`)))), metaLine(d.meta)];
  });
  return root;
}

export async function newsletter() {
  document.title = `Newsletter · Noticiero VOID`;
  const list = h('div');
  const root = h('div', { class: 'paper static-page' },
    h('h1', null, tr('Newsletter and VOID Reports', 'Newsletter e Informes VOID')),
    h('p', null, tr('VOID Reports are short original stories written by our AI newsroom from published facts, each linked to its sources (see our editorial policy).',
      'Los Informes VOID son noticias breves y originales que redacta nuestra redacción IA a partir de hechos publicados, siempre enlazadas a sus fuentes (ver política editorial).')),
    h('div', { class: 'nl-box' },
      h('h2', null, tr('How to follow', 'Cómo seguirnos')),
      h('p', null, tr('RSS: add ', 'RSS: añade '), h('a', { href: '/rss.xml' }, `${location.origin}/rss.xml`), tr(' to your reader to get every new VOID Report.', ' a tu lector para recibir cada nuevo Informe VOID.')),
      h('p', { class: 'muted' }, tr('Email newsletter: not available yet. It needs an email delivery service, which is not configured; we will not collect addresses until it works.',
        'Newsletter por email: aún no disponible. Necesita un servicio de envío de email que no está configurado; no recogeremos direcciones hasta que funcione.'))),
    h('h2', { class: 'np-sec-title' }, h('span', null, tr('Latest VOID Reports', 'Últimos Informes VOID'))), list);
  async(list, async () => {
    const d = await api('/api/news/reports');
    if (!d.items.length) return h('p', { class: 'muted' }, t('no_data'));
    return d.items.map((r) => h('article', { class: 'nl-item' },
      h('h3', null, h('a', { href: articlePath(r) }, r.title)),
      r.lead ? h('p', null, r.lead) : null,
      h('p', { class: 'small muted' }, `${tr('Based on', 'Basado en')} ${r.source} · ${fmtTime(r.createdAt)} · ${r.lang.toUpperCase()}`)));
  });
  return root;
}
