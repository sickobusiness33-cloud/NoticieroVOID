// SPA shell: path router (real URLs, server-rendered first paint), language switch,
// connection indicator, market strip, ads. Route modules load on demand.
import { t, setLang, getLang } from './i18n.js';
import { h, api, fmtUsd, fmtPct, signClass, fmtNum } from './ui.js';
import { configureAds, adSlot, stickyAd } from './ads.js';
import { createSparkleNavbar } from './components/sparkle-navbar.js';
import { NAV_ITEMS, MORE_ITEMS, activeNavIndex } from './shared/nav.js';
import { icon } from './icons.js';

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
  ['prediction-markets', 'nav_predictions', lazy(() => import('./predictions.js'), 'predictionMarkets')],
  ['newsletter', 'nav_newsletter', lazy(() => import('./predictions.js'), 'newsletter')],
  ['pro', 'nav_pro', lazy(() => import('./pro.js'), 'proPage')],
];

export const app = { config: null, me: null };
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

// Primary navigation: one SparkleNavbar instance; its active item always follows the URL
// (link clicks, history back/forward, language changes).
let sparkle = null;
function navItems() { return NAV_ITEMS.map((it) => ({ label: getLang() === 'es' ? it.es : it.en, href: it.href })); }
function renderNav() {
  if (!sparkle) {
    sparkle = createSparkleNavbar({ items: navItems(), color: '#00fffc', activeIndex: activeNavIndex(location.pathname), ariaLabel: t('nav_main'), onItemClick: (item) => navigate(item.href) });
    document.getElementById('primaryNav').replaceChildren(sparkle.el);
  } else {
    const labels = navItems();
    if (labels.some((x, i) => x.label !== sparkle.items[i]?.label)) sparkle.setItems(labels);
    sparkle.el.setAttribute('aria-label', t('nav_main'));
  }
  sparkle.setActive(activeNavIndex(location.pathname));
  const menu = document.getElementById('moreMenu');
  menu.replaceChildren(...MORE_ITEMS.map((m) => h('a', { href: m.href, 'aria-current': location.pathname === m.href ? 'page' : null }, getLang() === 'es' ? m.es : m.en)));
  const menuBtn = document.getElementById('menuBtn');
  menuBtn.replaceChildren(h('span', { class: 'more-t' }, t('nav_more')), icon('chevron-down', 'more-ico'), icon('menu', 'more-burger'));
  menuBtn.setAttribute('aria-label', t('nav_more'));
}

// Header account state comes from the server (/api/me); nothing here grants PRO features.
export function renderAccount() {
  const me = app.me;
  const pro = me?.pro?.pro;
  const proLink = document.getElementById('proLink');
  proLink.replaceChildren(icon('crown'), document.createTextNode(pro ? 'PRO ✓' : 'PRO'));
  proLink.classList.toggle('on', !!pro);
  proLink.title = pro ? t('pro_active') : t('pro_get');
  const acct = document.getElementById('acctLink');
  acct.replaceChildren(icon('user'), h('span', { class: 'acct-t' }, me?.signedIn ? t('account') : t('sign_in')));
  acct.setAttribute('aria-label', me?.signedIn ? `${t('account')}: ${me.user.email}` : t('sign_in'));
}

export async function refreshAccount() {
  try { app.me = await api('/api/me'); } catch { app.me = { signedIn: false, pro: { state: 'none', pro: false } }; }
  renderAccount();
  return app.me;
}

function closeMore() {
  const menu = document.getElementById('moreMenu');
  menu.hidden = true;
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
}

function renderChrome() {
  document.documentElement.lang = getLang();
  document.getElementById('footTag').textContent = t('sub');
  document.getElementById('disclaimer').textContent = t('disclaimer');
  renderNav();
  closeMore();
  const links = [['/section/macro', 'Economy', 'Economía'], ['/section/markets', 'Markets', 'Mercados'], ['/section/crypto', 'Crypto', 'Cripto'],
    ['/section/commodities', 'Commodities', 'Materias primas'], ['/section/fx', 'Currencies', 'Divisas'], ['/section/world', 'Geopolitics', 'Geopolítica'],
    ['/pro', 'VOID PRO', 'VOID PRO'], ['/about', 'About', 'Sobre nosotros'], ['/editorial-policy', 'Editorial policy', 'Política editorial'], ['/privacy', 'Privacy', 'Privacidad'], ['/rss.xml', 'RSS', 'RSS']];
  document.getElementById('footLinks').replaceChildren(...links.flatMap(([href, en, es], i) => [i ? ' · ' : '', h('a', { href }, getLang() === 'es' ? es : en)]));
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  if (app.me) renderAccount();
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
  // Ad eligibility and account state are both decided by the server for this session.
  const [config] = await Promise.all([api('/api/config').catch(() => ({ ai: false, coinzilla: null, ads: true })), refreshAccount()]);
  app.config = config;
  configureAds(app.config);
  if (app.config.ads !== false) {
    document.getElementById('adTop').replaceChildren(adSlot('leaderboard'));
    stickyAd();
  } else {
    // VOID PRO: also drop the ad network's push service worker if this browser registered it.
    navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.filter((r) => /\/sw\.js/.test(r.active?.scriptURL || '')).forEach((r) => r.unregister())).catch(() => {});
  }
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); render(); ticker(); }));
  const menuBtn = document.getElementById('menuBtn');
  menuBtn.addEventListener('click', () => {
    const menu = document.getElementById('moreMenu');
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('a')?.focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('moreMenu').hidden) { closeMore(); menuBtn.focus(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest?.('.more')) closeMore(); });
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
