// Quantum Lab shell: Whale Tracker (default) + the existing strategy backtester.
import { tr } from './i18n.js';
import { h, store, persist } from './ui.js';
import { whaleTracker } from './whale.js';
import { lab as backtestLab } from './views2.js';

export async function quantLab() {
  let tab = store('labTab', 'whales');
  const body = h('div');
  const tabs = h('div', { class: 'mt-tabs ql-tabs', role: 'tablist' });
  const draw = async () => {
    tabs.replaceChildren(...[['whales', tr('Whale Tracker', 'Whale Tracker')], ['backtest', tr('Strategy backtests', 'Backtests de estrategias')]].map(([k, l]) =>
      h('button', { class: tab === k ? 'on' : '', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; persist('labTab', k); draw(); } }, l)));
    body.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), '…'));
    body.replaceChildren(await (tab === 'whales' ? whaleTracker() : backtestLab()));
  };
  draw();
  return h('div', null, h('div', { class: 'page-h' }, h('div', null, h('h1', null, tr('Quantum Lab', 'Laboratorio Cuántico')),
    h('p', null, tr('Whale intelligence, wallet surveillance with persistent alerts, and strategy research.', 'Inteligencia de ballenas, vigilancia de wallets con alertas persistentes e investigación de estrategias.'))), tabs), body);
}
