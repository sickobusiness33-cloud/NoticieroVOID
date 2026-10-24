// VOID MEME TERMINAL — live Solana memecoin scanner.
// Data refresh is real polling (every 60 s) of /api/meme/scanner; nothing on this page is
// simulated. Alerts fire only when a signal appears that was not in the previous poll.
import { articlePath } from './shared/seo.js';
import { t, tr, getLang } from './i18n.js';
import { h, api, ago, store, persist } from './ui.js';
import { adSlot } from './ads.js';
import { fmtM } from './shared/memescan.js';
import { meme as regimeView } from './views2.js';

const POLL_MS = 60000;
const TABS = [
  ['all', 'All', 'Todo'], ['hot', 'Exploding (<1h)', 'Explotando (<1h)'], ['signals', 'With signals', 'Con señales'],
  ['trending5m', 'Trending 5m', 'Tendencia 5m'], ['trending1h', 'Trending 1h', 'Tendencia 1h'], ['pumpfun', 'Pump.fun', 'Pump.fun'], ['new', 'New launches', 'Recién lanzados'],
];
const RISK_ES = { EXTREME: 'EXTREMO', HIGH: 'ALTO', ELEVATED: 'ELEVADO', MODERATE: 'MODERADO' };
const riskLabel = (l) => (getLang() === 'es' ? RISK_ES[l] : l);
const L = (o) => (o ? o[getLang()] || o.en : '');
const pct = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1)}%` : '—');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const age = (m) => (m === null || m === undefined ? '—' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);
const price = (p) => (!Number.isFinite(p) ? '—' : p >= 1 ? `$${p.toFixed(3)}` : `$${p.toPrecision(3)}`);

let timer = null;
let beepCtx = null;
function beep() {
  try {
    beepCtx ||= new AudioContext();
    const o = beepCtx.createOscillator(), g = beepCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(beepCtx.destination);
    o.start(); o.stop(beepCtx.currentTime + 0.12);
  } catch { /* audio unavailable */ }
}

export async function memeTerminal() {
  if (timer) clearInterval(timer);
  const prefs = store('memePrefs', { tab: 'hot', minLiq: 5000, hideExtreme: false, sound: false, notify: false });
  const state = { data: null, selected: null, sort: 'score', prevKeys: null, nextAt: 0 };
  const root = h('div', { class: 'mt' });
  const head = h('div', { class: 'mt-head' });
  const stats = h('div', { class: 'mt-stats' });
  const feed = h('div', { class: 'mt-feed' });
  const tableBox = h('div', { class: 'mt-table' });
  const detail = h('div', { class: 'mt-detail' });
  const newsBox = h('div', { class: 'mt-news' });
  const toasts = h('div', { class: 'mt-toasts', 'aria-live': 'polite' });
  const regimeBox = h('div');

  const countdown = h('span', { class: 'mono small' });
  const toggle = (key, label) => h('label', { class: 'mt-toggle' }, h('input', { type: 'checkbox', checked: prefs[key] ? true : null, onchange: async (e) => {
    prefs[key] = e.target.checked; persist('memePrefs', prefs);
    if (key === 'notify' && prefs.notify && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    if (key === 'hideExtreme') renderTable();
  } }), label);
  head.append(
    h('div', null, h('h1', null, h('span', { class: 'mt-dot' }), 'VOID MEME TERMINAL'), h('p', { class: 'muted small' }, tr('Solana · live scanner of new launches, momentum and contract risk', 'Solana · escáner en vivo de lanzamientos, momentum y riesgo de contrato'))),
    h('div', { class: 'controls' }, countdown, toggle('sound', tr('Sound', 'Sonido')), toggle('notify', tr('Browser alerts', 'Alertas del navegador')),
      h('button', { class: 'btn sm', onclick: () => load(true) }, tr('Refresh', 'Actualizar'))));

  root.append(
    head,
    h('div', { class: 'mt-warn' }, h('b', null, tr('Not financial advice.', 'No es asesoramiento financiero.')), ' ',
      tr('Signals describe on-chain activity, not future price. Most new memecoins lose nearly all their value and many are scams (rug pulls, honeypots). Always check the risk flags and never invest what you cannot lose.',
        'Las señales describen actividad on-chain, no el precio futuro. La mayoría de memecoins nuevas pierden casi todo su valor y muchas son estafas (rug pulls, honeypots). Revisa siempre las alertas de riesgo y no inviertas lo que no puedas perder.')),
    stats,
    adSlot('leaderboard'),
    h('div', { class: 'mt-grid' },
      h('aside', { class: 'mt-col' }, h('h2', { class: 'mt-h' }, tr('Live signals', 'Señales en vivo')), feed, adSlot('rectangle')),
      h('section', { class: 'mt-col mt-main' }, tableBox),
      h('aside', { class: 'mt-col' }, detail, adSlot('rectangle'), h('h2', { class: 'mt-h' }, tr('Memecoin news', 'Noticias de memecoins')), newsBox)),
    adSlot('leaderboard'),
    h('h2', { class: 'mt-h', style: 'margin-top:18px' }, tr('Market regime', 'Régimen de mercado')), regimeBox,
    toasts);

  const renderStats = () => {
    const s = state.data.stats;
    const k = (label, v, c = '') => h('div', { class: 'mt-stat' }, h('span', null, label), h('b', { class: c }, v));
    stats.replaceChildren(
      k(tr('Pools scanned', 'Pools analizados'), s.pools), k(tr('Launched last hour', 'Lanzados última hora'), s.launchedLastHour),
      k(tr('>$1M in first hour', '>$1M en su 1ª hora'), s.over1MFirstHour, s.over1MFirstHour ? 'up' : ''), k(tr('Volume 5m', 'Volumen 5m'), `$${fmtM(s.volume5m)}`),
      k(tr('Active signals', 'Señales activas'), state.data.signals.length, 'vio'), k(tr('Extreme-risk tokens', 'Tokens riesgo extremo'), s.extremeRisk, s.extremeRisk ? 'down' : ''),
      k(tr('Updated', 'Actualizado'), ago(state.data.cachedAt)));
  };

  const renderFeed = () => {
    const sig = [...state.data.signals].sort((a, b) => (a.ageMin ?? 1e9) - (b.ageMin ?? 1e9)).slice(0, 30);
    feed.replaceChildren(...(sig.length ? sig.map((s) => h('button', { class: `mt-sig sig-${s.key}`, onclick: () => select(s.pool) },
      h('div', { class: 'mt-sig-top' }, s.image ? h('img', { src: s.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('i', { class: 'mt-noimg' }), h('b', null, s.symbol), h('span', { class: 'mt-tag' }, L(s.label)), h('span', { class: `mt-risk r-${s.risk}` }, riskLabel(s.risk))),
      h('div', { class: 'small' }, L(s.reason)), h('div', { class: 'small muted' }, `${tr('Age', 'Edad')} ${age(s.ageMin)} · ${tr('Value', 'Valor')} $${fmtM(s.value)}`)))
      : [h('p', { class: 'muted small' }, tr('No signals right now. The scanner refreshes every minute.', 'Ahora no hay señales. El escáner se actualiza cada minuto.'))]));
  };

  const filtered = () => {
    let rows = state.data.rows.filter((r) => (r.liquidityUsd ?? 0) >= prefs.minLiq);
    if (prefs.hideExtreme) rows = rows.filter((r) => r.risk.level !== 'EXTREME');
    if (prefs.tab === 'hot') rows = rows.filter((r) => r.ageMin !== null && r.ageMin <= 60);
    else if (prefs.tab === 'signals') rows = rows.filter((r) => r.signals.length);
    else if (prefs.tab !== 'all') rows = rows.filter((r) => r.lists.includes(prefs.tab) || (prefs.tab === 'new' && r.lists.includes('new2')));
    const key = { score: (r) => r.momentum.score, value: (r) => r.marketCapUsd ?? r.fdvUsd ?? 0, vol5: (r) => r.vol.m5 ?? 0, age: (r) => -(r.ageMin ?? 1e9), h1: (r) => r.ch.h1 ?? -1e9, liq: (r) => r.liquidityUsd ?? 0 }[state.sort];
    return rows.sort((a, b) => key(b) - key(a));
  };

  const th = (label, sortKey) => h('th', { class: sortKey ? 'sortable' : '', onclick: sortKey ? () => { state.sort = sortKey; renderTable(); } : null }, label, state.sort === sortKey ? ' ▾' : '');
  const renderTable = () => {
    const rows = filtered();
    const minLiq = h('select', { class: 'input', 'aria-label': tr('Minimum liquidity', 'Liquidez mínima'), onchange: (e) => { prefs.minLiq = Number(e.target.value); persist('memePrefs', prefs); renderTable(); } },
      [0, 5000, 20000, 50000, 100000].map((v) => h('option', { value: v, selected: v === prefs.minLiq ? true : null }, `${tr('Liq ≥', 'Liq ≥')} $${fmtM(v)}`)));
    const tabs = h('div', { class: 'mt-tabs', role: 'tablist' }, TABS.map(([k, en, es]) => h('button', { class: prefs.tab === k ? 'on' : '', role: 'tab', onclick: () => { prefs.tab = k; persist('memePrefs', prefs); renderTable(); } }, tr(en, es))));
    const body = [];
    rows.forEach((r, i) => {
      if (i > 0 && i % 12 === 0) { const ad = adSlot('leaderboard'); if (ad.nodeType === 1) body.push(h('tr', { class: 'mt-adrow' }, h('td', { colspan: 11 }, ad))); }
      body.push(h('tr', { class: `${state.selected === r.pool ? 'sel' : ''} ${state.fresh?.has(r.pool) ? 'fresh' : ''}`, onclick: () => select(r.pool) },
        h('td', null, h('div', { class: 'mt-tok' }, r.image ? h('img', { src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('i', { class: 'mt-noimg' }),
          h('div', null, h('b', null, r.symbol), h('div', { class: 'small muted' }, (r.tokenName || r.name || '').slice(0, 22), r.dex === 'pump-fun' ? h('span', { class: 'mt-pf' }, 'pump') : null)))),
        h('td', { class: 'num' }, age(r.ageMin)),
        h('td', { class: 'num' }, `$${fmtM(r.marketCapUsd ?? r.fdvUsd)}`),
        h('td', { class: 'num' }, `$${fmtM(r.liquidityUsd)}`),
        h('td', { class: 'num' }, `$${fmtM(r.vol.m5)}`),
        h('td', { class: `num ${cls(r.ch.m5)}` }, pct(r.ch.m5)),
        h('td', { class: `num ${cls(r.ch.h1)}` }, pct(r.ch.h1)),
        h('td', { class: 'num' }, `${r.tx.m5.buys ?? 0}/${r.tx.m5.sells ?? 0}`),
        h('td', { class: 'num' }, h('span', { class: 'mt-score', style: `--s:${r.momentum.score}` }, r.momentum.score)),
        h('td', null, r.signals.map((s) => h('span', { class: `mt-tag sig-${s.key}`, title: L(s.reason) }, L(s.label)))),
        h('td', null, h('span', { class: `mt-risk r-${r.risk.level}`, title: r.risk.flags.map((f) => L(f)).join('\n') }, riskLabel(r.risk.level)))));
    });
    tableBox.replaceChildren(
      h('div', { class: 'mt-tablebar' }, tabs, h('div', { class: 'controls' }, minLiq, toggle('hideExtreme', tr('Hide extreme risk', 'Ocultar riesgo extremo')))),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl mt-tbl' },
        h('thead', null, h('tr', null, th(tr('Token', 'Token')), th(tr('Age', 'Edad'), 'age'), th(tr('Value', 'Valor'), 'value'), th(tr('Liquidity', 'Liquidez'), 'liq'), th('Vol 5m', 'vol5'), th('5m'), th('1h', 'h1'), th(tr('Buys/Sells 5m', 'Compras/Ventas 5m')), th('Score', 'score'), th(tr('Signals', 'Señales')), th(tr('Risk', 'Riesgo')))),
        h('tbody', null, body.length ? body : h('tr', null, h('td', { colspan: 11, class: 'muted' }, tr('No tokens match these filters.', 'Ningún token cumple estos filtros.')))))),
      h('p', { class: 'small muted' }, tr('Value = market cap (or fully diluted value when market cap is unavailable). Score 0–100 = 5-min volume (30) + acceleration vs hourly pace (25) + buy pressure (20) + 1h price trend (25). Source: GeckoTerminal, refreshed every ~60 s.',
        'Valor = capitalización (o valor totalmente diluido si no hay capitalización). Score 0–100 = volumen 5 min (30) + aceleración frente al ritmo horario (25) + presión compradora (20) + tendencia de precio 1h (25). Fuente: GeckoTerminal, cada ~60 s.')));
  };

  const select = (pool) => {
    state.selected = pool;
    const r = state.data.rows.find((x) => x.pool === pool);
    if (!r) return;
    renderTable();
    const i = r.info;
    const chk = (ok, en, es) => h('li', { class: ok === true ? 'ok' : ok === false ? 'bad' : 'unk' }, ok === true ? '✓ ' : ok === false ? '✗ ' : '? ', tr(en, es));
    detail.replaceChildren(h('div', { class: 'mt-card' },
      h('div', { class: 'mt-tok big' }, r.image ? h('img', { src: r.image, alt: '', referrerpolicy: 'no-referrer' }) : h('i', { class: 'mt-noimg' }), h('div', null, h('b', null, r.symbol), h('div', { class: 'small muted' }, r.tokenName || r.name))),
      h('div', { class: 'mt-kv' },
        ...[[tr('Price', 'Precio'), price(r.priceUsd)], [tr('Value', 'Valor'), `$${fmtM(r.marketCapUsd ?? r.fdvUsd)}`], [tr('Liquidity', 'Liquidez'), `$${fmtM(r.liquidityUsd)}`], [tr('Age', 'Edad'), age(r.ageMin)],
          ['Vol 5m / 1h', `$${fmtM(r.vol.m5)} / $${fmtM(r.vol.h1)}`], [tr('Buyers 5m', 'Compradores 5m'), r.tx.m5.buyers ?? '—'], ['24h', pct(r.ch.h24)], ['DEX', r.dex || '—']].map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v)))),
      h('h3', null, `${tr('Momentum', 'Momentum')} ${r.momentum.score}/100`),
      h('div', { class: 'mt-parts' }, Object.entries(r.momentum.parts).map(([k, v]) => h('div', null, h('span', null, { volume: tr('Volume', 'Volumen'), acceleration: tr('Acceleration', 'Aceleración'), buyPressure: tr('Buy pressure', 'Presión compradora'), priceTrend: tr('Price trend', 'Tendencia') }[k]),
        h('i', { style: `--w:${(v / ({ volume: 30, acceleration: 25, buyPressure: 20, priceTrend: 25 }[k])) * 100}%` }), h('b', null, v.toFixed(0))))),
      r.signals.length ? [h('h3', null, tr('Signals', 'Señales')), h('ul', { class: 'mt-list' }, r.signals.map((s) => h('li', null, h('b', null, L(s.label)), ': ', L(s.reason))))] : null,
      h('h3', null, `${tr('Risk', 'Riesgo')}: `, h('span', { class: `mt-risk r-${r.risk.level}` }, riskLabel(r.risk.level))),
      i ? h('ul', { class: 'mt-checks' },
        chk(i.mintAuthority === null ? null : !i.mintAuthority, 'Mint authority revoked', 'Autoridad de mint revocada'),
        chk(i.freezeAuthority === null ? null : !i.freezeAuthority, 'Freeze authority revoked', 'Autoridad de freeze revocada'),
        chk(i.honeypot === null ? null : !i.honeypot, 'Not a honeypot', 'No es honeypot'),
        chk(i.devPct === null ? null : i.devPct < 10, `Developer holds ${i.devPct ?? '?'}%`, `El desarrollador tiene ${i.devPct ?? '?'}%`),
        chk(i.top10Pct === null ? null : i.top10Pct < 40, `Top 10 holders ${i.top10Pct === null ? '?' : i.top10Pct.toFixed(0)}%`, `Top 10 holders ${i.top10Pct === null ? '?' : i.top10Pct.toFixed(0)}%`),
        i.holders ? h('li', { class: 'unk' }, `${tr('Holders', 'Holders')}: ${i.holders.toLocaleString()}`) : null,
        i.graduation !== null ? h('li', { class: 'unk' }, `${tr('Launchpad progress', 'Progreso en launchpad')}: ${Math.round(i.graduation)}%${i.graduated ? ' ✓' : ''}`) : null) : null,
      h('ul', { class: 'mt-list' }, r.risk.flags.map((f) => h('li', { class: `sev-${f.sev}` }, L(f)))),
      h('div', { class: 'controls' },
        r.url ? h('a', { class: 'btn sm', href: r.url, target: '_blank', rel: 'noopener', style: 'margin:0' }, `${tr('Chart', 'Gráfico')} ↗`) : null,
        r.token ? h('button', { class: 'btn sm', onclick: (e) => { navigator.clipboard?.writeText(r.token); e.currentTarget.textContent = tr('Copied', 'Copiado'); } }, tr('Copy contract', 'Copiar contrato')) : null,
        i?.twitter ? h('a', { class: 'btn sm', href: `https://x.com/${i.twitter}`, target: '_blank', rel: 'noopener noreferrer' }, 'X ↗') : null,
        i?.telegram ? h('a', { class: 'btn sm', href: `https://t.me/${i.telegram}`, target: '_blank', rel: 'noopener noreferrer' }, 'Telegram ↗') : null),
      h('p', { class: 'small muted mono' }, r.token || '')));
  };

  const renderNews = () => {
    const n = state.data.news;
    newsBox.replaceChildren(...(n.length ? n.slice(0, 12).map((it) => h('a', { class: 'mt-newsitem', href: articlePath(it) },
      it.image ? h('img', { src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('div', null, h('b', null, it.title), h('div', { class: 'small muted' }, `${it.source} · ${ago(it.publishedAt)}`))))
      : [h('p', { class: 'muted small' }, tr('No memecoin-related headlines in the current window.', 'No hay titulares sobre memecoins en este momento.'))]));
  };

  const alertNew = () => {
    const keys = new Set(state.data.signals.map((s) => `${s.pool}:${s.key}`));
    const prev = state.prevKeys;
    state.prevKeys = keys;
    state.fresh = new Set();
    if (!prev) return; // first load is the baseline: never alert on it
    const fresh = state.data.signals.filter((s) => !prev.has(`${s.pool}:${s.key}`));
    for (const s of fresh.slice(0, 4)) {
      state.fresh.add(s.pool);
      const toast = h('button', { class: `mt-toastitem sig-${s.key}`, onclick: () => { select(s.pool); toast.remove(); } }, h('b', null, `${s.symbol} · ${L(s.label)}`), h('div', null, L(s.reason)), h('span', { class: `mt-risk r-${s.risk}` }, riskLabel(s.risk)));
      toasts.append(toast);
      setTimeout(() => toast.remove(), 15000);
      if (prefs.notify && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(`VOID · ${s.symbol}: ${L(s.label)}`, { body: `${L(s.reason)} · ${tr('Risk', 'Riesgo')}: ${riskLabel(s.risk)}`, tag: `${s.pool}:${s.key}` }); } catch { /* ignore */ }
      }
    }
    if (fresh.length && prefs.sound) beep();
  };

  const load = async (manual = false) => {
    if (!document.body.contains(root) && !manual && state.data) { clearInterval(timer); return; }
    try {
      state.data = await api('/api/meme/scanner');
      alertNew();
      renderStats(); renderFeed(); renderTable(); renderNews();
      if (state.selected) select(state.selected); else if (state.data.rows[0]) detail.replaceChildren(h('p', { class: 'muted small' }, tr('Select a token to see its contract checks.', 'Selecciona un token para ver las comprobaciones del contrato.')));
    } catch (e) {
      if (!state.data) tableBox.replaceChildren(h('div', { class: 'error-box' }, e.message));
      else stats.prepend(h('div', { class: 'mt-stat' }, h('span', null, tr('Last refresh failed', 'Falló la última actualización')), h('b', { class: 'down' }, e.message.slice(0, 40))));
    }
    state.nextAt = Date.now() + POLL_MS;
  };

  tableBox.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), t('loading')));
  await load();
  timer = setInterval(() => {
    if (!document.body.contains(root)) { clearInterval(timer); return; }
    const left = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
    countdown.textContent = `${tr('Next refresh', 'Próxima actualización')}: ${left}s`;
    if (left === 0 && document.visibilityState === 'visible') { state.nextAt = Date.now() + POLL_MS; load(); }
  }, 1000);
  regimeView().then((node) => regimeBox.replaceChildren(node)).catch(() => {});
  return root;
}
