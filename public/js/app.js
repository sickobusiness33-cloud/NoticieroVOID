// SPA shell: hash router, language switch, connection indicator, market strip, ads.
import { t, setLang, getLang } from './i18n.js';
import { h, api, fmtUsd, fmtPct, signClass, fmtNum } from './ui.js';
import { configureAds, adSlot, stickyAd } from './ads.js';
import * as V from './views.js';
import * as V2 from './views2.js';

const ROUTES = [
  ['', 'nav_home', V.home], ['terminal', 'nav_terminal', V.terminal], ['macro', 'nav_macro', V.macro],
  ['news', 'nav_news', V.newsFeed], ['analyst', 'nav_analyst', V.analyst], ['calendar', 'nav_calendar', V.calendarView],
  ['liquidity', 'nav_liquidity', V2.liquidity], ['crypto-macro', 'nav_cryptomacro', V2.cryptoMacro],
  ['memecoins', 'nav_meme', V2.meme], ['lab', 'nav_lab', V2.lab], ['saved', 'nav_saved', V.saved], ['status', 'nav_status', V.status],
];

export const app = { config: null };
const main = document.getElementById('app');

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { route: parts[0] || '', params: parts.slice(1), query: new URLSearchParams(query || '') };
}

function renderChrome() {
  document.documentElement.lang = getLang();
  document.getElementById('tagline').textContent = t('tagline');
  document.getElementById('footTag').textContent = t('sub');
  document.getElementById('disclaimer').textContent = t('disclaimer');
  const { route } = parseHash();
  document.getElementById('nav').replaceChildren(...ROUTES.map(([r, key]) => h('a', { href: `#/${r}`, class: r === route ? 'on' : '', 'aria-current': r === route ? 'page' : null }, t(key))));
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  renderChrome();
  const { route, params, query } = parseHash();
  const def = ROUTES.find(([r]) => r === route) || ROUTES[0];
  document.title = `${t(def[1])} · Noticiero VOID`;
  main.replaceChildren();
  try {
    const node = await def[2]({ params, query, app });
    if (seq === renderSeq) main.replaceChildren(node);
  } catch (e) {
    if (seq === renderSeq) main.replaceChildren(h('div', { class: 'error-box' }, e.message));
  }
  document.getElementById('nav').classList.remove('open');
}

async function ticker() {
  const el = document.getElementById('ticker');
  try {
    const d = await api('/api/markets/overview?lang=' + getLang());
    const conn = document.getElementById('conn');
    const anyStale = d.crypto.meta?.stale || d.tradfi.some((x) => x.meta?.status === 'stale');
    conn.className = `conn ${d.crypto.rows.length ? (anyStale ? 'warn' : 'ok') : 'bad'}`;
    conn.querySelector('span').textContent = d.crypto.rows.length ? (anyStale ? 'STALE' : 'ONLINE') : 'DEGRADED';
    const crypto = d.crypto.rows.filter((r) => ['bitcoin', 'ethereum', 'solana', 'ripple', 'binancecoin'].includes(r.id))
      .map((r) => h('span', null, r.symbol, h('b', null, fmtUsd(r.price)), h('em', { class: signClass(r.change24h) }, fmtPct(r.change24h))));
    const trad = d.tradfi.filter((x) => x.latest && ['SP500', 'NASDAQCOM', 'DGS10', 'DTWEXBGS', 'VIXCLS', 'DCOILWTICO'].includes(x.id))
      .map((x) => h('span', { title: `${x.name} · ${x.latest.date} · ${x.meta.status}` }, x.name.replace(/ \(.*\)/, ''), h('b', null, fmtNum(x.latest.value, x.unit === '%' ? 2 : 2)), h('em', { class: 'muted' }, x.latest.date.slice(5))));
    el.replaceChildren(...crypto, ...trad);
  } catch {
    const conn = document.getElementById('conn');
    conn.className = 'conn bad'; conn.querySelector('span').textContent = 'OFFLINE';
  }
}

async function boot() {
  try { app.config = await api('/api/config'); } catch { app.config = { ai: false, coinzilla: null }; }
  configureAds(app.config);
  const top = document.getElementById('adTop');
  top.replaceChildren(adSlot('leaderboard'));
  stickyAd();
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); render(); ticker(); }));
  document.getElementById('menuBtn').addEventListener('click', (e) => {
    const nav = document.getElementById('nav');
    nav.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(nav.classList.contains('open')));
  });
  // Keyboard navigation: "g" then a letter; "/" focuses the first search box.
  let g = false;
  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === '/') { const s = document.querySelector('input[type=search]'); if (s) { s.focus(); e.preventDefault(); } return; }
    if (g) {
      const map = { h: '', t: 'terminal', m: 'macro', n: 'news', a: 'analyst', c: 'calendar', l: 'liquidity', k: 'crypto-macro', s: 'memecoins', q: 'lab' };
      if (e.key in map) location.hash = `#/${map[e.key]}`;
      g = false; return;
    }
    if (e.key === 'g') { g = true; setTimeout(() => { g = false; }, 1200); }
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('online', ticker);
  window.addEventListener('offline', () => { const c = document.getElementById('conn'); c.className = 'conn bad'; c.querySelector('span').textContent = 'OFFLINE'; });
  setLang(getLang());
  render();
  ticker();
  // CoinGecko data are cached ~2 min server-side; polling faster would only re-read the cache.
  setInterval(() => { if (document.visibilityState === 'visible') ticker(); }, 120000);
}

boot();
