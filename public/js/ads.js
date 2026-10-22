// Coinzilla integration. Zone IDs come from /api/config (Worker env vars), so ads can be
// configured without editing code. Placement uses Coinzilla's standard display tag:
//   <div class="coinzilla" data-zone="C-{zone}"></div> + coinzillatag.com/lib/display.js
// Every slot is labelled as advertising and visually separated from editorial content.
import { h } from './ui.js';
import { t } from './i18n.js';

let cfg = null;
let loaded = false;
const SIZES = { leaderboard: [728, 90], rectangle: [300, 250], mobile: [320, 100] };

export function configureAds(config) { cfg = config?.coinzilla || null; }

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  document.head.append(h('script', { src, async: true }));
}

// type: leaderboard | rectangle | mobile. On narrow screens leaderboard falls back to mobile.
export function adSlot(type = 'leaderboard') {
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const kind = type === 'leaderboard' && narrow ? 'mobile' : type;
  const zone = cfg?.[kind] || (kind === 'mobile' ? cfg?.leaderboard : null);
  const debug = new URLSearchParams(location.search).has('adsdebug');
  if (!zone) {
    return debug ? h('div', { class: `ad ad-${kind} ad-empty` }, h('span', { class: 'ad-label' }, t('ad')), `Coinzilla ${kind} — set COINZILLA_ZONE_${kind.toUpperCase()}`) : document.createComment('ad slot: zone not configured');
  }
  const [w, hgt] = kind === 'mobile' && !cfg?.mobile ? SIZES.leaderboard : SIZES[kind];
  const box = h('aside', { class: `ad ad-${kind}`, 'aria-label': t('ad') }, h('span', { class: 'ad-label' }, t('ad')), h('div', { class: 'coinzilla', 'data-zone': `C-${zone}` }));
  queueMicrotask(() => {
    window.coinzilla_display = window.coinzilla_display || [];
    window.coinzilla_display.push({ zone, width: String(w), height: String(hgt) });
    if (!loaded) { loadScript('https://coinzillatag.com/lib/display.js'); loaded = true; }
  });
  return box;
}

// Optional sticky ad (Coinzilla "sticky" format), loaded once per session.
export function stickyAd() {
  if (!cfg?.sticky || window.__voidSticky) return;
  window.__voidSticky = true;
  window.coinzilla_sticky = window.coinzilla_sticky || [];
  // sticky.js expects an arguments-like array whose first element is the zone id.
  window.coinzilla_sticky.push([cfg.sticky]);
  loadScript('https://coinzillatag.com/lib/sticky.js');
}
