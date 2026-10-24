// VOID Intelligence Calendar — year (default) / month / week / day views.
// Events: /api/cal/range (official calendars, BEA, Treasury, rules, optional FRED/Finnhub).
// Impact: /api/cal/impact (transmission scenarios + historical comparables, no probabilities).
import { articlePath } from './shared/seo.js';
import { tr, getLang } from './i18n.js';
import { h, api, store, persist, fmtNum } from './ui.js';
import { adSlot } from './ads.js';

const CAT_ORDER = ['risk', 'cb', 'macro', 'crypto', 'corporate', 'past'];
const CAT_LABEL = {
  macro: ['Macroeconomics', 'Macroeconomía'], cb: ['Central banks & rates', 'Bancos centrales y tipos'], crypto: ['Crypto & on-chain', 'Cripto y on-chain'],
  corporate: ['Corporate & markets', 'Corporativo y mercados'], risk: ['High-risk', 'Alto riesgo'], past: ['Past', 'Pasado'], news: ['News', 'Noticias'],
};
const STATUS = { scheduled: ['Scheduled', 'Programado'], 'in-progress': ['In progress', 'En curso'], published: ['Published', 'Publicado'], finished: ['Finished', 'Finalizado'], cancelled: ['Cancelled', 'Cancelado'], tbc: ['Date TBC', 'Fecha por confirmar'], rescheduled: ['Rescheduled', 'Reprogramado'] };
const CONF = { official: ['Official calendar', 'Calendario oficial'], 'rule-based': ['Rule-based', 'Según regla'], provider: ['Data provider', 'Proveedor de datos'] };
const IMPACT_ASSETS = ['BTC', 'ETH', 'SOL', 'SPX', 'NDX', 'DJI', 'UST2Y', 'UST10Y', 'DXY', 'EURUSD', 'WTI', 'VIX'];
const T = (pair) => (pair ? tr(pair[0], pair[1]) : '');
const L = (o) => (o ? o[getLang()] || o.en : '');
const iso = (d) => d.toISOString().slice(0, 10);
const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
const parse = (s) => new Date(`${s}T12:00:00Z`);
const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * 86400000));
const monthName = (m, style = 'long') => new Date(Date.UTC(2026, m, 1)).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US', { month: style, timeZone: 'UTC' });
const weekdayNames = () => [...Array(7)].map((_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US', { weekday: 'narrow', timeZone: 'UTC' }));
const localTime = (e) => (e.datetimeUtc ? new Date(e.datetimeUtc).toLocaleTimeString(getLang() === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : tr('All day', 'Todo el día'));
const mainCat = (e) => CAT_ORDER.find((c) => e.categories.includes(c) && c !== 'past') || 'macro';

export async function calendarIntel() {
  const prefs = store('calPrefs', { startView: 'year', cats: CAT_ORDER.concat('news'), assets: ['BTC', 'SPX', 'UST10Y', 'DXY'] });
  const st = { view: prefs.startView || 'year', date: todayIso(), cache: new Map() };
  const root = h('div', { class: 'vc' });
  const bar = h('div', { class: 'vc-bar' });
  const legend = h('div', { class: 'vc-legend' });
  const body = h('div', { class: 'vc-body' });
  const side = h('aside', { class: 'vc-side' });
  const foot = h('div', { class: 'vc-foot' });
  root.append(bar, legend, h('div', { class: 'vc-grid' }, body, side), foot, adSlot('leaderboard'));

  // ---------------- data ----------------
  const span = () => {
    const d = parse(st.date);
    if (st.view === 'year') return [`${d.getUTCFullYear()}-01-01`, `${d.getUTCFullYear()}-12-31`];
    if (st.view === 'month') { const y = d.getUTCFullYear(), m = d.getUTCMonth(); return [iso(new Date(Date.UTC(y, m, 1))), iso(new Date(Date.UTC(y, m + 1, 0)))]; }
    if (st.view === 'week') { const s = weekStart(st.date); return [s, addDays(s, 6)]; }
    return [st.date, st.date];
  };
  const weekStart = (s) => { const d = parse(s); const dow = (d.getUTCDay() + 6) % 7; return addDays(s, -dow); };
  async function load() {
    const [from, to] = span();
    const key = `${from}:${to}`;
    if (!st.cache.has(key)) st.cache.set(key, api(`/api/cal/range?from=${from}&to=${to}`));
    try { return await st.cache.get(key); } catch (e) { st.cache.delete(key); throw e; }
  }
  const visible = (e) => e.categories.some((c) => prefs.cats.includes(c));
  const byDay = (events) => { const m = {}; for (const e of events) if (visible(e)) (m[e.date] ||= []).push(e); return m; };

  // ---------------- toolbar ----------------
  function renderBar() {
    const views = [['year', tr('Year', 'Año')], ['month', tr('Month', 'Mes')], ['week', tr('Week', 'Semana')], ['day', tr('Day', 'Día')]];
    const d = parse(st.date);
    const title = st.view === 'year' ? `${d.getUTCFullYear()}`
      : st.view === 'month' ? `${monthName(d.getUTCMonth())} ${d.getUTCFullYear()}`
        : st.view === 'week' ? `${tr('Week of', 'Semana del')} ${parse(weekStart(st.date)).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
          : d.toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const step = (dir) => {
      const x = parse(st.date);
      if (st.view === 'year') x.setUTCFullYear(x.getUTCFullYear() + dir);
      else if (st.view === 'month') x.setUTCMonth(x.getUTCMonth() + dir, 1);
      else x.setUTCDate(x.getUTCDate() + dir * (st.view === 'week' ? 7 : 1));
      st.date = iso(x); render();
    };
    const yearSel = h('select', { class: 'input', 'aria-label': tr('Year', 'Año'), onchange: (e) => { st.date = `${e.target.value}${st.date.slice(4)}`; render(); } },
      [2025, 2026, 2027].map((y) => h('option', { value: y, selected: y === d.getUTCFullYear() ? true : null }, y)));
    const jump = h('input', { class: 'input', type: 'date', value: st.date, min: '2025-01-01', max: '2027-12-31', 'aria-label': tr('Go to date', 'Ir a fecha'), onchange: (e) => { if (e.target.value) { st.date = e.target.value; st.view = 'day'; render(); } } });
    const startPref = h('select', { class: 'input', title: tr('Start view', 'Vista inicial'), onchange: (e) => { prefs.startView = e.target.value; persist('calPrefs', prefs); } },
      views.map(([v, l]) => h('option', { value: v, selected: v === (prefs.startView || 'year') ? true : null }, `${tr('Start:', 'Inicio:')} ${l}`)));
    bar.replaceChildren(
      h('div', { class: 'vc-title' }, h('button', { class: 'iconbtn big', 'aria-label': tr('Previous', 'Anterior'), onclick: () => step(-1) }, '‹'), h('h1', null, title), h('button', { class: 'iconbtn big', 'aria-label': tr('Next', 'Siguiente'), onclick: () => step(1) }, '›')),
      h('div', { class: 'controls' },
        h('div', { class: 'seg', role: 'tablist' }, views.map(([v, l]) => h('button', { class: st.view === v ? 'on' : '', role: 'tab', 'aria-selected': String(st.view === v), onclick: () => { st.view = v; render(); } }, l))),
        h('button', { class: 'btn sm', onclick: () => { st.date = todayIso(); if (st.view === 'year') st.view = 'year'; render(); } }, tr('Today', 'Hoy')),
        yearSel, jump, startPref));
    legend.replaceChildren(...[...CAT_ORDER, 'news'].map((c) => h('label', { class: `vc-chip c-${c}` }, h('input', { type: 'checkbox', checked: prefs.cats.includes(c) ? true : null, onchange: (e) => {
      prefs.cats = e.target.checked ? [...new Set([...prefs.cats, c])] : prefs.cats.filter((x) => x !== c); persist('calPrefs', prefs); render();
    } }), h('i'), T(CAT_LABEL[c]))),
    h('span', { class: 'small muted' }, tr('Colours classify the type of event — they are not bullish/bearish signals.', 'Los colores clasifican el tipo de evento; no son señales alcistas ni bajistas.')));
  }

  // ---------------- views ----------------
  async function render() {
    renderBar();
    body.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Loading calendar…', 'Cargando calendario…')));
    try {
      const d = await load();
      const days = byDay(d.events);
      body.replaceChildren(st.view === 'year' ? yearView(d, days) : st.view === 'month' ? monthView(d, days) : st.view === 'week' ? weekView(d, days) : dayView(d, days));
      renderFoot(d);
      if (st.view === 'day') renderSide(st.date); else renderSidePreview(d, days);
    } catch (e) { body.replaceChildren(h('div', { class: 'error-box' }, e.message, h('button', { class: 'btn sm', onclick: render }, tr('Retry', 'Reintentar')))); }
  }

  function dots(evs, news) {
    const cats = new Set();
    for (const e of evs || []) for (const c of e.categories) if (prefs.cats.includes(c)) cats.add(c);
    if (news && prefs.cats.includes('news')) cats.add('news');
    const order = [...CAT_ORDER, 'news'].filter((c) => cats.has(c) && !(c === 'past' && cats.size > 1));
    return h('span', { class: 'vc-dots' }, order.slice(0, 4).map((c) => h('i', { class: `c-${c}` })));
  }

  function monthGrid(y, m, days, news, { mini }) {
    const first = new Date(Date.UTC(y, m, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const today = todayIso();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'vc-d empty' }));
    for (let d = 1; d <= n; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const evs = days[ds] || [];
      const nw = news[ds]?.total || 0;
      const cls = `vc-d ${ds === today ? 'today' : ''} ${ds < today ? 'past' : ''} ${evs.some((e) => e.importance === 'high') ? 'hi' : ''}`;
      if (mini) {
        cells.push(h('button', { class: cls, title: `${ds}: ${evs.length} ${tr('events', 'eventos')}${nw ? ` · ${nw} ${tr('news', 'noticias')}` : ''}`, onclick: (e) => { e.stopPropagation(); st.date = ds; st.view = 'day'; render(); } },
          h('span', { class: 'n' }, d), dots(evs, nw)));
      } else {
        cells.push(h('div', { class: cls, role: 'button', tabindex: '0', onclick: () => { st.date = ds; st.view = 'day'; render(); }, onkeydown: (e) => { if (e.key === 'Enter') { st.date = ds; st.view = 'day'; render(); } } },
          h('span', { class: 'n' }, d),
          ...evs.slice(0, 3).map((e) => h('span', { class: `vc-ev c-${mainCat(e)} ${e.importance === 'high' ? 'hi' : ''}` }, (getLang() === 'es' ? e.titleEs : e.title) || e.title)),
          evs.length > 3 ? h('span', { class: 'vc-more' }, `+${evs.length - 3}`) : null,
          nw && prefs.cats.includes('news') ? h('span', { class: 'vc-news' }, `${nw} ${tr('news', 'noticias')}`) : null));
      }
    }
    return h('div', { class: `vc-month ${mini ? 'mini' : 'full'}` },
      h('div', { class: 'vc-wd' }, weekdayNames().map((w) => h('span', null, w))),
      h('div', { class: 'vc-days' }, cells));
  }

  function yearView(d, days) {
    const y = parse(st.date).getUTCFullYear();
    return h('div', { class: 'vc-year' }, [...Array(12)].map((_, m) => {
      const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
      const count = Object.entries(days).filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v.length, 0);
      return h('section', { class: 'vc-ym' },
        h('button', { class: 'vc-mname', onclick: () => { st.date = `${prefix}-01`; st.view = 'month'; render(); } }, monthName(m), h('span', { class: 'small muted' }, ` ${count}`)),
        monthGrid(y, m, days, d.news, { mini: true }));
    }));
  }

  function monthView(d, days) {
    const x = parse(st.date);
    return monthGrid(x.getUTCFullYear(), x.getUTCMonth(), days, d.news, { mini: false });
  }

  function weekView(d, days) {
    const s = weekStart(st.date);
    const today = todayIso();
    return h('div', { class: 'vc-week' }, [...Array(7)].map((_, i) => {
      const ds = addDays(s, i);
      const evs = (days[ds] || []).slice().sort((a, b) => (a.datetimeUtc || 'z').localeCompare(b.datetimeUtc || 'z'));
      const dd = parse(ds);
      return h('div', { class: `vc-wcol ${ds === today ? 'today' : ''}` },
        h('button', { class: 'vc-whead', onclick: () => { st.date = ds; st.view = 'day'; render(); } },
          h('span', null, dd.toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US', { weekday: 'short', timeZone: 'UTC' })), h('b', null, dd.getUTCDate())),
        h('div', { class: 'vc-wbody' }, evs.length ? evs.map((e) => h('button', { class: `vc-wev c-${mainCat(e)} ${e.importance === 'high' ? 'hi' : ''}`, onclick: () => { st.date = ds; st.view = 'day'; render(); } },
          h('span', { class: 'mono small' }, localTime(e)), h('span', null, (getLang() === 'es' ? e.titleEs : e.title) || e.title)))
          : h('span', { class: 'small muted' }, '—')),
        d.news[ds]?.total && prefs.cats.includes('news') ? h('span', { class: 'vc-news' }, `${d.news[ds].total} ${tr('news', 'noticias')}`) : null);
    }));
  }

  function eventCard(e) {
    const data = e.data || {};
    const dataBits = [
      data.offeringUsd ? `${tr('Offering', 'Oferta')}: $${fmtNum(data.offeringUsd / 1e9, 0)}B` : null,
      data.highYield != null ? `${tr('High yield', 'Rendimiento adjudicado')}: ${data.highYield}%` : null,
      data.bidToCover != null ? `${tr('Bid-to-cover', 'Cobertura')}: ${data.bidToCover}` : null,
      data.epsEstimate != null ? `EPS est. ${data.epsEstimate}` : null, data.epsActual != null ? `EPS ${tr('actual', 'real')} ${data.epsActual}` : null,
    ].filter(Boolean);
    return h('article', { class: `vc-card c-${mainCat(e)}` },
      h('div', { class: 'vc-card-top' }, h('span', { class: 'mono' }, localTime(e)), h('span', { class: `vc-st st-${e.status}` }, T(STATUS[e.status])), h('span', { class: `vc-imp imp-${e.importance}` }, e.importance)),
      h('b', null, (getLang() === 'es' ? e.titleEs : e.title) || e.title),
      h('div', { class: 'small' }, e.categories.filter((c) => c !== 'past').map((c) => h('span', { class: `vc-tag c-${c}` }, T(CAT_LABEL[c]))), ' ', h('span', { class: 'muted' }, `${e.region || ''}${e.tz ? ` · ${e.tz}` : ''}`)),
      e.previousDate ? h('div', { class: 'small warn-text' }, `${tr('Moved from', 'Movido desde')} ${e.previousDate}`) : null,
      dataBits.length ? h('div', { class: 'small' }, dataBits.join(' · ')) : null,
      h('div', { class: 'small muted' }, `${T(CONF[e.confirmation])} · `, h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source)));
  }

  function dayView(d, days) {
    const evs = (days[st.date] || []).slice().sort((a, b) => (a.datetimeUtc || 'z').localeCompare(b.datetimeUtc || 'z'));
    const newsBox = h('div');
    if (prefs.cats.includes('news')) loadDayNews(st.date, newsBox);
    return h('div', { class: 'vc-day' },
      evs.length ? evs.map(eventCard) : h('div', { class: 'notice' }, tr('No confirmed events on this date in the integrated calendars.', 'No hay eventos confirmados en esta fecha en los calendarios integrados.')),
      h('h3', { class: 'wt-h3' }, tr('News published that day', 'Noticias publicadas ese día')), newsBox);
  }

  async function loadDayNews(date, box) {
    box.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), '…'));
    try {
      const d = await api(`/api/cal/news?date=${date}`);
      box.replaceChildren(d.items.length ? h('ul', { class: 'vc-newslist' }, d.items.slice(0, 15).map((n) => h('li', null, h('a', { href: n.id ? articlePath(n) : n.url, target: n.id ? null : '_blank', rel: 'noopener' }, n.title), h('span', { class: 'small muted' }, ` · ${n.source}`))))
        : h('p', { class: 'small muted' }, date > todayIso() ? tr('Future date: no news yet.', 'Fecha futura: aún no hay noticias.') : tr('No archived headlines for this date (the archive grows from deployment onwards).', 'No hay titulares archivados para esta fecha (el archivo crece desde el despliegue).')));
    } catch (e) { box.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  // ---------------- side panel: impact analysis ----------------
  function assetPicker(onChange) {
    return h('div', { class: 'vc-assets' }, IMPACT_ASSETS.map((a) => h('label', { class: 'vc-achip' }, h('input', { type: 'checkbox', checked: prefs.assets.includes(a) ? true : null, onchange: (e) => {
      prefs.assets = e.target.checked ? [...new Set([...prefs.assets, a])].slice(0, 6) : prefs.assets.filter((x) => x !== a); persist('calPrefs', prefs); onChange();
    } }), a)));
  }

  async function renderSide(date) {
    const box = h('div');
    const draw = async () => {
      box.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Analysing…', 'Analizando…')));
      try {
        const d = await api(`/api/cal/impact?date=${date}&assets=${prefs.assets.join(',')}`);
        box.replaceChildren(...impactNodes(d));
      } catch (e) { box.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
    };
    side.replaceChildren(h('h2', { class: 'mt-h' }, tr('Impact intelligence', 'Inteligencia de impacto')), assetPicker(draw), box, adSlot('rectangle'));
    draw();
  }

  function impactNodes(d) {
    const out = [];
    out.push(h('p', { class: 'small muted' }, `${tr('Generated', 'Generado')} ${new Date(d.generatedAt).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US')} · ${d.horizon.days >= 0 ? `${tr('in', 'dentro de')} ${d.horizon.days} ${tr('days', 'días')}` : tr('past date', 'fecha pasada')}`));
    if (d.evidenceNote) out.push(h('div', { class: 'notice warn small' }, L(d.evidenceNote)));
    if (!d.analyses.length) out.push(h('p', { class: 'small' }, tr('No scheduled events with known transmission channels on this date.', 'No hay eventos programados con canales de transmisión conocidos en esta fecha.')));
    for (const a of d.analyses) {
      const assets = [...new Set((a.scenarios || []).flatMap((s) => Object.keys(s.moves)))];
      out.push(h('div', { class: 'vc-imp-card' },
        h('b', null, (getLang() === 'es' ? a.titleEs : a.title) || a.title), h('div', { class: 'small muted' }, `${T(STATUS[a.status])} · ${T(CONF[a.confirmation])}`),
        a.scenarios ? [h('div', { class: 'vc-sub' }, h('span', { class: 'label-rule' }, tr('CONDITIONAL SCENARIOS', 'ESCENARIOS CONDICIONALES'))),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl vc-scen' }, h('thead', null, h('tr', null, h('th', null, ''), a.scenarios.map((s, i) => h('th', { title: L(s.label) }, String.fromCharCode(65 + i))))),
            h('tbody', null, assets.map((x) => h('tr', null, h('td', null, x), a.scenarios.map((s) => { const v = s.moves[x]; return h('td', { class: `num ${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}` }, v > 0 ? '▲' : v < 0 ? '▼' : '·'); })))))),
          h('ol', { class: 'small vc-scen-l' }, a.scenarios.map((s) => h('li', null, L(s.label))))] : h('p', { class: 'small muted' }, tr('No standard transmission map for this event type.', 'No hay mapa de transmisión estándar para este tipo de evento.')),
        Object.keys(a.comparables).length ? [h('div', { class: 'vc-sub' }, h('span', { class: 'badge st-historical' }, tr('HISTORICAL COMPARABLES (MEASURED)', 'COMPARABLES HISTÓRICOS (MEDIDOS)'))),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ...[tr('Asset', 'Activo'), 'n', tr('Avg |move|', 'Mov. medio |x|'), tr('Normal day', 'Día normal'), tr('Ratio', 'Ratio'), tr('Up share', '% al alza')].map((x) => h('th', null, x)))),
            h('tbody', null, Object.entries(a.comparables).map(([k, v]) => (v && v.n ? h('tr', null, h('td', null, k), h('td', { class: 'num' }, v.n), h('td', { class: 'num' }, `${fmtNum(v.meanAbsMove, 2)}${v.unit === 'bp' ? ' pb' : '%'}`), h('td', { class: 'num' }, `${fmtNum(v.baselineAbsMove, 2)}${v.unit === 'bp' ? ' pb' : '%'}`),
              h('td', { class: `num ${v.ratioToBaseline > 1.2 ? 'down' : ''}` }, `${fmtNum(v.ratioToBaseline, 2)}×`), h('td', { class: 'num' }, `${Math.round(v.upShare * 100)}%`))
              : h('tr', null, h('td', null, k), h('td', { colspan: 5, class: 'muted small' }, v?.error || tr('no comparable data', 'sin datos comparables')))))))),
          h('p', { class: 'small muted' }, tr(`Event-day move (previous close → event-day close) on ${a.comparableDates.length} past events of this type vs. an average day. Small samples: association, not causation.`, `Movimiento del día del evento (cierre anterior → cierre del día) en ${a.comparableDates.length} eventos pasados de este tipo frente a un día medio. Muestras pequeñas: asociación, no causalidad.`))] : null,
        a.watch ? [h('div', { class: 'vc-sub' }, h('b', { class: 'small' }, tr('What to watch', 'Qué vigilar'))), h('ul', { class: 'small' }, L(a.watch).map((w) => h('li', null, w)))] : null,
        h('p', { class: 'small muted' }, L(a.probabilityNote))));
    }
    if (d.upcomingForAssets?.length) out.push(h('h3', { class: 'wt-h3' }, tr('Next 30 days for your assets', 'Próximos 30 días para tus activos')),
      h('ul', { class: 'small vc-up' }, d.upcomingForAssets.map((u) => h('li', null, h('button', { class: 'linkbtn', onclick: () => { st.date = u.date; st.view = 'day'; render(); } }, u.date), ` ${getLang() === 'es' ? u.titleEs : u.title} `, h('span', { class: 'muted' }, u.assets.join(' '))))));
    return out;
  }

  function renderSidePreview(d, days) {
    const today = todayIso();
    const next = d.events.filter((e) => e.date >= today && visible(e) && e.importance === 'high').slice(0, 8);
    side.replaceChildren(h('h2', { class: 'mt-h' }, tr('Upcoming high-importance', 'Próximos de alta importancia')),
      next.length ? h('ul', { class: 'small vc-up' }, next.map((e) => h('li', null, h('button', { class: 'linkbtn', onclick: () => { st.date = e.date; st.view = 'day'; render(); } }, e.date), ` ${localTime(e)} · ${(getLang() === 'es' ? e.titleEs : e.title) || e.title}`)))
        : h('p', { class: 'small muted' }, tr('None in this range.', 'Ninguno en este rango.')),
      h('p', { class: 'small muted' }, tr('Select a day to see its events, news and the impact analysis for your assets.', 'Selecciona un día para ver sus eventos, noticias y el análisis de impacto para tus activos.')),
      adSlot('rectangle'));
  }

  function renderFoot(d) {
    foot.replaceChildren(h('details', null, h('summary', { class: 'small' }, `${tr('Sources', 'Fuentes')} (${d.sources.filter((s) => s.ok).length}/${d.sources.length}) · ${tr('updated', 'actualizado')} ${new Date(d.generatedAt).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US')}`),
      h('ul', { class: 'small' }, d.sources.map((s) => h('li', { class: s.ok ? '' : 'down' }, `${s.name}: ${s.ok ? `${s.count} ${tr('events in range', 'eventos en el rango')}${s.note ? ` (${s.note})` : ''}` : s.error}`))),
      d.pending.length ? h('div', { class: 'notice small' }, h('b', null, tr('Not yet covered: ', 'Aún no cubierto: ')), d.pending.join(' · ')) : null));
  }

  render();
  return root;
}
