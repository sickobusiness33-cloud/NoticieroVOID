// Newspaper front page and article page.
// Copyright: we show the publisher's headline, its feed thumbnail (credited), a short
// excerpt (≤240 chars) and a prominent link to the full story at the publisher. Everything
// else on the article page (VOID Report written by AI from those facts, market data, scenarios,
// AI analysis) is original to VOID.
import { t, tr, getLang } from './i18n.js';
import { h, api, async, metaLine, statusBadge, fmtNum, fmtPct, fmtTime, ago, signClass, store, persist } from './ui.js';
import { adSlot } from './ads.js';
import { UNIVERSE } from './shared/impact.js';
import { SECTIONS, inSection, articlePath, sectionPath } from './shared/seo.js';

const CAT_LABEL = {
  'central-banks': ['Central banks', 'Bancos centrales'], inflation: ['Inflation', 'Inflación'], labor: ['Jobs', 'Empleo'], growth: ['Growth', 'Crecimiento'],
  'rates-bonds': ['Bonds', 'Bonos'], 'fx-dollar': ['Currencies', 'Divisas'], geopolitics: ['Geopolitics', 'Geopolítica'], regulation: ['Regulation', 'Regulación'],
  'etf-flows': ['ETFs', 'ETF'], defi: ['DeFi', 'DeFi'], stablecoins: ['Stablecoins', 'Stablecoins'], memecoins: ['Memecoins', 'Memecoins'],
  commodities: ['Commodities', 'Materias primas'], markets: ['Markets', 'Mercados'], general: ['News', 'Noticias'],
};
const kicker = (it) => tr(...(CAT_LABEL[it.categories?.find((c) => c !== 'general') || 'general'] || CAT_LABEL.general));
const href = (it) => articlePath(it);

// Publisher thumbnail, or original VOID artwork when the feed carries no image.
// The lead image is the page's largest paint: load it eagerly at high priority.
function photo(it, cls = '', eager = false) {
  const art = h('div', { class: `ph ph-${(it.categories?.[0] || 'general')} ${cls}`, 'aria-hidden': 'true' }, h('span', null, kicker(it)));
  if (!it.image) return art;
  const img = h('img', { src: it.image, alt: cls === 'art-pic' ? it.title : '', loading: eager ? 'eager' : 'lazy', fetchpriority: eager ? 'high' : null, decoding: 'async', referrerpolicy: 'no-referrer', class: cls });
  img.addEventListener('error', () => img.replaceWith(art));
  return h('figure', { class: `pic ${cls}` }, img, h('figcaption', null, `${tr('Image', 'Imagen')}: ${it.source}`));
}

function byline(it) {
  return h('div', { class: 'np-by' },
    it.breaking ? h('span', { class: 'tag hot' }, t('breaking')) : null,
    h('b', null, it.source), h('span', { title: it.publishedAt }, ago(it.publishedAt)),
    it.alsoReportedBy?.length ? h('span', { class: 'muted' }, `+${it.alsoReportedBy.length} ${tr('sources', 'fuentes')}`) : null);
}

function card(it, size = 'm') {
  // Small/medium cards without a photo are text-only (like a newspaper brief) instead of
  // repeating placeholder artwork; large slots always get a visual.
  const media = it.image || size === 'xl' || size === 'l' ? h('a', { href: href(it), class: 'np-link', 'aria-label': it.title }, photo(it, '', size === 'xl')) : null;
  return h('article', { class: `np-card np-${size}${media ? '' : ' np-text'}` },
    media,
    h('div', { class: 'np-body' },
      h('span', { class: 'np-kicker' }, kicker(it)),
      h(size === 'xl' ? 'h2' : 'h3', null, h('a', { href: href(it) }, it.title)),
      size !== 's' && it.excerpt ? h('p', null, it.excerpt) : null,
      byline(it)));
}

function headline(it) {
  return h('li', null, h('time', { datetime: it.publishedAt }, it.publishedAt ? new Date(it.publishedAt).toLocaleTimeString(getLang() === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : ''),
    h('a', { href: href(it) }, it.title), h('small', null, it.source));
}

// ================= FRONT PAGE =================
export async function front() {
  const lang = getLang();
  const root = h('div', { class: 'paper' });
  const now = new Date();
  root.append(h('header', { class: 'masthead' },
    h('div', { class: 'mh-line' }, h('span', null, now.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })),
      h('span', null, lang === 'es' ? 'Edición en español' : 'English edition'), h('span', null, t('tagline'))),
    h('h1', { class: 'mh-title' }, 'Noticiero VOID'),
    h('nav', { class: 'mh-sections' }, SECTIONS.map((s) => h('a', { href: `#sec-${s.key}`, onclick: (e) => { e.preventDefault(); root.querySelector(`#sec-${s.key}`)?.scrollIntoView({ behavior: 'smooth' }); } }, tr(s.en, s.es))),
      h('a', { href: '/news' }, tr('All news', 'Todas las noticias')))));
  const body = h('div');
  root.append(body);
  async(body, async () => {
    const [byRel, byTime] = await Promise.all([api(`/api/news?lang=${lang}&limit=200`), api(`/api/news?lang=${lang}&limit=200&sort=time`)]);
    const items = byRel.items;
    if (!items.length) return h('div', { class: 'notice' }, t('no_data'));
    const used = new Set();
    const take = (list, n, pred = () => true) => {
      const per = {};
      const out = [];
      for (const it of list) {
        if (out.length >= n) break;
        if (used.has(it.id) || !pred(it)) continue;
        // Max two stories per publisher in any block keeps the page varied.
        if ((per[it.source] = (per[it.source] || 0) + 1) > 2) continue;
        used.add(it.id); out.push(it);
      }
      return out;
    };
    const withImg = (it) => !!it.image;
    const [lead] = take(items, 1, withImg).length ? [items.find((i) => used.has(i.id))] : take(items, 1);
    const seconds = take(items, 2, withImg);
    const latest = byTime.items.slice(0, 14);
    const breaking = items.filter((i) => i.breaking).slice(0, 6);

    const sections = SECTIONS.map((s) => {
      const pred = (it) => inSection(s, it);
      const main = take(items, 1, (it) => pred(it) && withImg(it));
      const rest = take(items, 4, pred);
      const list = [...main, ...rest];
      if (!list.length) return null;
      return h('section', { class: 'np-section', id: `sec-${s.key}` },
        h('h2', { class: 'np-sec-title' }, h('a', { href: sectionPath(s.key) }, h('span', null, tr(s.en, s.es)))),
        h('div', { class: 'np-sec-grid' }, card(list[0], 'l'), h('div', { class: 'np-sec-side' }, list.slice(1).map((i) => card(i, 's')))));
    }).filter(Boolean);
    const remaining = items.filter((i) => !used.has(i.id));
    const more = remaining.map((i) => card(i, 'm'));
    for (let k = 9; k < more.length; k += 10) more.splice(k, 0, h('div', { class: 'np-ad-cell' }, adSlot('rectangle')));

    return [
      breaking.length ? h('div', { class: 'np-breaking', role: 'marquee' }, h('b', null, t('breaking')), breaking.map((i) => h('a', { href: href(i) }, i.title))) : null,
      h('div', { class: 'np-front' },
        h('div', { class: 'np-lead' }, card(lead, 'xl')),
        h('div', { class: 'np-second' }, seconds.map((i) => card(i, 'm'))),
        h('aside', { class: 'np-latest' }, h('h2', { class: 'np-sec-title' }, h('span', null, t('latest_news'))), h('ol', null, latest.map(headline)), adSlot('rectangle'))),
      adSlot('leaderboard'),
      ...sections.flatMap((s, i) => (i === 2 ? [s, adSlot('leaderboard')] : [s])),
      h('section', { class: 'np-section' }, h('h2', { class: 'np-sec-title' }, h('span', null, tr('More news', 'Más noticias'))), h('div', { class: 'np-grid' }, more)),
      metaLine({ ...byRel.meta, note: tr(`${items.length} stories from ${byRel.feeds.filter((f) => f.ok).length} sources. Headlines and short excerpts link to the original publishers.`, `${items.length} noticias de ${byRel.feeds.filter((f) => f.ok).length} fuentes. Titulares y extractos breves con enlace al medio original.`) }),
    ];
  });
  return root;
}

// ================= SECTION PAGE =================
export async function section({ params }) {
  const s = SECTIONS.find((x) => x.key === params[0]);
  if (!s) return h('div', { class: 'error-box' }, h('h1', null, t('not_found')), h('a', { href: '/' }, tr('Front page', 'Portada')));
  document.title = `${tr(s.en, s.es)} · Noticiero VOID`;
  const root = h('div', { class: 'paper' });
  root.append(h('nav', { class: 'crumbs small' }, h('a', { href: '/' }, tr('Front page', 'Portada'))),
    h('header', { class: 'masthead' }, h('h1', { class: 'mh-title' }, tr(s.en, s.es)), h('p', { class: 'muted' }, tr(...s.desc))));
  const body = h('div');
  root.append(body);
  async(body, async () => {
    const d = await api(`/api/news?lang=${getLang()}&limit=200`);
    const items = d.items.filter((it) => inSection(s, it));
    if (!items.length) return h('div', { class: 'notice' }, t('no_data'));
    const cards = items.map((i, k) => card(i, k === 0 ? 'xl' : 'm'));
    for (let k = 7; k < cards.length; k += 8) cards.splice(k, 0, h('div', { class: 'np-ad-cell' }, adSlot('rectangle')));
    return [h('div', { class: 'np-grid' }, cards), metaLine(d.meta)];
  });
  return root;
}

// ================= ARTICLE PAGE =================
const ARROW = { 1: '▲', [-1]: '▼' };
export async function article({ params }) {
  const id = params[0];
  const root = h('div', { class: 'paper' });
  async(root, async () => {
    // The VOID Report is requested in parallel with the article so a stored report renders in the
    // first paint (no layout shift); asset volatility data is optional and must not delay the page.
    const storyRes = api(`/api/news/story?id=${encodeURIComponent(id)}&lang=${getLang() === 'es' ? 'es' : 'en'}`).then((s) => ({ s }), (e) => ({ e }));
    const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
    const [d, uni, early] = await Promise.all([api(`/api/news/item?id=${encodeURIComponent(id)}`),
      Promise.race([api('/api/assets/universe'), later(2500, { assets: {} })]).catch((e) => ({ error: e.message, assets: {} })),
      Promise.race([storyRes, later(1500, null)])]);
    const it = d.item;
    document.title = `${it.title} · Noticiero VOID`;
    const A = uni.assets || {};
    const meta = Object.fromEntries(UNIVERSE.map((a) => [a.id, a]));
    const name = (id2) => tr(meta[id2].en, meta[id2].es);
    const moveTxt = (x) => (x?.move ? `±${fmtNum(x.move.sigma, 2)}${x.move.unit === 'bp' ? ' pb' : '%'}` : '—');
    const imp = d.impact;
    const saved = store('saved', []);
    const isSaved = saved.some((x) => x.url === it.url);
    const saveBtn = h('button', { class: 'btn', onclick: () => {
      const list = store('saved', []);
      const i = list.findIndex((x) => x.url === it.url);
      if (i >= 0) list.splice(i, 1); else list.unshift({ id: it.id, url: it.url, title: it.title, source: it.source, publishedAt: it.publishedAt, lang: it.lang, savedAt: new Date().toISOString() });
      persist('saved', list.slice(0, 300));
      saveBtn.textContent = i >= 0 ? t('save') : t('saved_ok');
    } }, isSaved ? t('saved_ok') : t('save'));
    const aiBox = h('div');
    // Official releases (Fed, BEA: public domain; ECB, BoE: reuse allowed with attribution) are shown in full.
    const officialBox = h('div', { class: 'art-official' });
    if (it.official) {
      officialBox.append(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Loading official text…', 'Cargando texto oficial…')));
      api(`/api/news/official?id=${it.id}`).then((o) => officialBox.replaceChildren(
        h('div', { class: 'art-body' }, o.paragraphs.map((p) => h('p', null, p))),
        h('p', { class: 'small muted' }, `${tr('Full text of the official release', 'Texto íntegro del comunicado oficial')} · ${o.license} · `, h('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.source))))
        .catch(() => officialBox.replaceChildren());
    }
    // VOID Report: original story written by AI from the published facts (never the publisher's text).
    const storyBox = h('div', { class: 'art-story' });
    const fillStory = ({ s, e }) => {
      if (e) {
        storyBox.replaceChildren(h('p', { class: 'small muted' }, e.status === 429
          ? tr('Today’s free AI quota is used up; the story will be written after 00:00 UTC.', 'El cupo gratuito de IA de hoy se ha agotado; la noticia se redactará después de las 00:00 UTC.')
          : tr('The AI story is not available right now.', 'La noticia redactada por IA no está disponible ahora mismo.')));
        return;
      }
      if (s.status !== 'ok' || !s.paragraphs.length) {
        storyBox.replaceChildren(h('p', { class: 'small muted' }, tr('The AI story for this item did not pass our accuracy checks, so it is not shown.', 'La noticia redactada por IA no superó nuestros controles de exactitud, así que no se muestra.')));
        return;
      }
      const n = s.sources.length;
      storyBox.replaceChildren(
        h('div', { class: 'art-story-head' }, h('span', { class: 'label-rule' }, tr('VOID REPORT', 'INFORME VOID')), h('span', { class: 'tag vio' }, tr('Written with AI', 'Redactado con IA'))),
        s.headline ? h('h2', { class: 'art-story-title' }, s.headline) : null,
        h('div', { class: 'art-body' }, s.paragraphs.map((p) => h('p', null, p))),
        h('p', { class: 'small muted' }, tr(
          `Written by Noticiero VOID with AI using only the facts reported by ${s.sources[0].source}${n > 1 ? ` and ${n - 1} other outlet(s)` : ''}. It may contain errors; check the original source below.`,
          `Redactado por Noticiero VOID con IA usando solo los hechos publicados por ${s.sources[0].source}${n > 1 ? ` y ${n - 1} medio(s) más` : ''}. Puede contener errores; consulta la fuente original abajo.`)));
    };
    if (!it.official) {
      if (early) fillStory(early);
      else {
        storyBox.append(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Our newsroom AI is writing the story…', 'Nuestra redacción IA está escribiendo la noticia…')));
        storyRes.then(fillStory);
      }
    }
    const aiBtn = h('button', { class: 'btn', onclick: () => import('./views.js').then((m) => m.analyzeInto(it, aiBox, aiBtn)) }, t('analyze'));

    const scen = imp.scenarios;

    return [
      h('nav', { class: 'crumbs small' }, h('a', { href: '/' }, tr('Front page', 'Portada')), ' › ', kicker(it)),
      h('div', { class: 'art-grid' },
        h('article', { class: 'art' },
          h('span', { class: 'np-kicker' }, kicker(it)),
          h('h1', { class: 'art-title' }, it.title),
          it.excerpt ? h('p', { class: 'art-dek' }, it.excerpt) : null,
          h('div', { class: 'np-by' }, h('b', null, it.source), h('span', null, fmtTime(it.publishedAt)), h('span', { class: 'tag' }, it.lang.toUpperCase()), it.official ? h('span', { class: 'tag vio' }, tr('OFFICIAL', 'OFICIAL')) : null),
          adSlot('leaderboard'),
          photo(it, 'art-pic', true),
          h('div', { class: 'controls art-actions' }, saveBtn, aiBtn, h('button', { class: 'btn', onclick: (e) => { navigator.clipboard?.writeText(location.href); e.currentTarget.textContent = tr('Link copied', 'Enlace copiado'); } }, tr('Copy link', 'Copiar enlace'))),
          it.official ? officialBox : storyBox,
          it.alsoReportedBy?.length ? h('div', { class: 'art-also' }, h('b', { class: 'small' }, `${tr('Also covered by', 'También lo cubren')}: `),
            it.alsoReportedBy.map((r) => h('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'tag' }, `${r.source} ↗`))) : null,
          aiBox,

          h('h2', { class: 'np-sec-title' }, h('span', null, tr('Possible market impact', 'Posible impacto en los mercados'))),
          h('p', { class: 'notice' }, h('span', { class: 'label-rule' }, tr('CONDITIONAL SCENARIOS', 'ESCENARIOS CONDICIONALES')), ' ',
            tr('Each scenario lists the direction in which assets have typically reacted to this type of news through standard transmission channels. These are not predictions: the actual reaction depends on how the news compares with expectations, and correlations change over time. "Typical 1d move" is one standard deviation of each asset’s recent daily changes, measured from real data.',
              'Cada escenario indica la dirección en la que los activos suelen reaccionar ante este tipo de noticia según los canales de transmisión habituales. No son predicciones: la reacción real depende de cómo se compare la noticia con lo esperado, y las correlaciones cambian con el tiempo. «Mov. típico 1d» es una desviación estándar de los cambios diarios recientes de cada activo, medida con datos reales.')),
          imp.mentioned.length ? h('p', null, h('b', null, tr('Assets mentioned: ', 'Activos mencionados: ')), imp.mentioned.map((x) => h('span', { class: 'tag vio' }, name(x)))) : null,
          h('div', { class: 'scen-grid' }, scen.map((s, i) => h('div', { class: 'scen' },
            h('h3', null, `${tr('Scenario', 'Escenario')} ${String.fromCharCode(65 + i)}`), h('p', null, tr(s.label.en, s.label.es)),
            h('ul', null, Object.entries(s.moves).sort((a, b) => imp.assets.indexOf(a[0]) - imp.assets.indexOf(b[0])).slice(0, 10).map(([x, dir]) => h('li', null,
              h('span', { class: dir > 0 ? 'up' : 'down' }, `${ARROW[dir]} `), name(x), h('span', { class: 'small muted' }, ` · ${tr('typical 1d', 'típico 1d')} ${moveTxt(A[x])}`))))))),
          adSlot('leaderboard'),
          h('div', { class: 'art-source' },
            h('p', null, tr(`This is a short excerpt. The full story is published by ${it.source}.`, `Esto es un extracto breve. La noticia completa está publicada por ${it.source}.`)),
            h('a', { class: 'btn sm', href: it.url, target: '_blank', rel: 'noopener', style: 'margin:0' }, `${tr('Read the full story at', 'Leer la noticia completa en')} ${it.source} ↗`))),
        h('aside', { class: 'art-side' }, adSlot('rectangle'),
          h('h2', { class: 'np-sec-title' }, h('span', null, tr('Related', 'Relacionadas'))),
          d.related.map((r) => card(r, 's')),
          adSlot('rectangle'))),
    ];
  });
  return root;
}
