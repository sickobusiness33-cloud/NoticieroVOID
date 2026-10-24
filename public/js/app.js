// SPA shell: path router (real URLs, server-rendered first paint), language switch,
// connection indicator, market strip, ads. Route modules load on demand.
import { t, setLang, getLang } from './i18n.js';
import { h, api, fmtUsd, fmtPct, signClass, fmtNum } from './ui.js';
import { configureAds, adSlot, stickyAd } from './ads.js';

const lazy = (mod, name) => (ctx) => mod().then((m) => m[name](ctx));
const paper = () => import('./paper.js'), views = () => import('./views.js'), views2 = () => import('./views2.js');
const ROUTES = [
  ['', 'nav_home', lazy(paper, 'front')], ['terminal', 'nav_terminal', lazy(views, 'terminal')], ['macro', 'nav_macro', lazy(views, 'macro')],
  ['news', 'nav_news', (ctx) => (/^[a-f0-9]{20}$/.test(ctx.params[0] || '') ? lazy(paper, 'article')(ctx) : lazy(views, 'newsFeed')(ctx))],
  ['analyst', 'nav_analyst', lazy(views, 'analyst')], ['calendar', 'nav_calendar', lazy(() => import('./calendar.js'), 'calendarIntel')],
  ['liquidity', 'nav_liquidity', lazy(views2, 'liquidity')], ['crypto-macro', 'nav_cryptomacro', lazy(views2, 'cryptoMacro')],
  ['memecoins', 'nav_meme', lazy(() => import('./memeterm.js'), 'memeTerminal')], ['lab', 'nav_lab', lazy(() => import('./quantlab.js'), 'quantLab')],
  ['saved', 'nav_saved', lazy(views, 'saved')], ['status', 'nav_status', lazy(views, 'status')],
  ['section', 'nav_home', lazy(paper, 'section'), { hidden: true }],
  ['about', 'nav_home', lazy(() => import('./pages.js'), 'staticPage'), { hidden: true }],
  ['editorial-policy', 'nav_home', lazy(() => import('./pages.js'), 'staticPage'), { hidden: true }],
  ['privacy', 'nav_home', lazy(() => import('./pages.js'), 'staticPage'), { hidden: true }],
];

export const app = { config: null };
const main = document.getElementById('app');

// Old #/ links (shared before real URLs existed) are moved to their path equivalent.
function migrateHash() {
  if (!location.hash.startsWith('#/')) return;
  let [path, query] = location.hash.slice(1).split('?');
  path = path.replace(/^\/article\//, '/news/');
  history.replaceState(null, '', path + (query ? `?${query}` : ''));
}

function parseLoc() {
  const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return { route: parts[0] || '', params: parts.slice(1), query: new URLSearchParams(location.search) };
}

export function navigate(path) {
  history.pushState(null, '', path);
  render();
}

function renderChrome() {
  document.documentElement.lang = getLang();
  document.getElementById('tagline').textContent = t('tagline');
  document.getElementById('footTag').textContent = t('sub');
  document.getElementById('disclaimer').textContent = t('disclaimer');
  const { route } = parseLoc();
  document.getElementById('nav').replaceChildren(...ROUTES.filter((x) => !x[3]?.hidden).map(([r, key]) => h('a', { href: `/${r}`, class: r === route ? 'on' : '', 'aria-current': r === route ? 'page' : null }, t(key))));
  const links = [['/section/macro', 'Economy', 'Economía'], ['/section/markets', 'Markets', 'Mercados'], ['/section/crypto', 'Crypto', 'Cripto'],
    ['/section/commodities', 'Commodities', 'Materias primas'], ['/section/fx', 'Currencies', 'Divisas'], ['/section/world', 'Geopolitics', 'Geopolítica'],
    ['/about', 'About', 'Sobre nosotros'], ['/editorial-policy', 'Editorial policy', 'Política editorial'], ['/privacy', 'Privacy', 'Privacidad'], ['/rss.xml', 'RSS', 'RSS']];
  document.getElementById('footLinks').replaceChildren(...links.flatMap(([href, en, es], i) => [i ? ' · ' : '', h('a', { href }, getLang() === 'es' ? es : en)]));
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  renderChrome();
  const { route, params, query } = parseLoc();
  const def = ROUTES.find(([r]) => r === route);
  document.title = `${def ? t(def[1]) : '404'} · Noticiero VOID`;
  const first = main.querySelector('.ssr');
  try {
    const node = def ? await def[2]({ params, query, app }) : h('div', { class: 'error-box' }, h('h1', null, t('not_found')), h('a', { href: '/' }, t('nav_home')));
    if (seq !== renderSeq) return;
    if (first) {
      // First load: keep the server-rendered page visible until the view has its data,
      // then swap once (avoids a spinner flash and a second paint of the main image).
      node.hidden = true;
      main.append(node);
      await ready(node);
      if (seq === renderSeq) { first.remove(); node.hidden = false; } else node.remove();
    } else main.replaceChildren(node);
  } catch (e) {
    if (seq === renderSeq) main.replaceChildren(h('div', { class: 'error-box' }, e.message));
  }
  document.getElementById('nav').classList.remove('open');
  if (!first) window.scrollTo(0, 0);
}

// A view is ready when no main loader is pending (the AI story box may keep loading), max 6 s.
function ready(node) {
  const done = () => ![...node.querySelectorAll('.loading')].some((l) => !l.closest('.art-story'));
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => { if (done()) { mo.disconnect(); resolve(); } });
    mo.observe(node, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve(); }, 6000);
  });
}

// Same-origin page links are handled in place (no full reload); API links, new tabs,
// modified clicks and downloads keep the browser default.
function interceptLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/') || /\.[a-z0-9]+$/i.test(url.pathname)) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  window.addEventListener('popstate', render);
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
      if (e.key in map) navigate(`/${map[e.key]}`);
      g = false; return;
    }
    if (e.key === 'g') { g = true; setTimeout(() => { g = false; }, 1200); }
  });
  interceptLinks();
  window.addEventListener('online', ticker);
  window.addEventListener('offline', () => { const c = document.getElementById('conn'); c.className = 'conn bad'; c.querySelector('span').textContent = 'OFFLINE'; });
  setLang(getLang());
  migrateHash();
  render();
  ticker();
  // CoinGecko data are cached ~2 min server-side; polling faster would only re-read the cache.
  setInterval(() => { if (document.visibilityState === 'visible') ticker(); }, 120000);
}

boot();
