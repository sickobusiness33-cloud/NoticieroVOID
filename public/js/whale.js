// Quantum Lab — Whale Tracker UI. All data comes from /api/lab/* (Blockscout, Solana RPC,
// CoinGecko/GeckoTerminal, SEC EDGAR) and /api/alerts/* (D1, evaluated by the server cron).
// Polling intervals are shown in the UI; nothing here is simulated.
import { tr, getLang } from './i18n.js';
import { h, api, authApi, ago, fmtTime, statusBadge, store, persist } from './ui.js';
import { adSlot } from './ads.js';
import { lineChart, bars } from './charts.js';
import { fmtAmt } from './shared/whales.js';

const L = (o) => (o ? o[getLang()] || o.en : '');
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const usd = (v) => (Number.isFinite(v) ? `$${fmtAmt(v)}` : '—');
const CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana'];
const KIND = {
  buy: ['Buy', 'Compra', 'k-buy'], sell: ['Sell', 'Venta', 'k-sell'],
  transfer_in: ['Transfer in', 'Entrada', 'k-in'], transfer_out: ['Transfer out', 'Salida', 'k-out'],
};
const kindTag = (k) => { const x = KIND[k] || [k, k, '']; return h('span', { class: `wk ${x[2]}` }, tr(x[0], x[1])); };
const RULES = [
  ['any_move', 'Any movement', 'Cualquier movimiento'], ['buy', 'Buy (swap)', 'Compra (swap)'], ['sell', 'Sell (swap)', 'Venta (swap)'],
  ['transfer_in', 'Incoming transfer', 'Transferencia entrante'], ['transfer_out', 'Outgoing transfer', 'Transferencia saliente'],
  ['large_move', 'Movement above threshold', 'Movimiento por encima de umbral'], ['balance_pct', 'Balance change ≥ %', 'Cambio de saldo ≥ %'],
  ['counterparty', 'Interaction with address', 'Interacción con dirección'], ['exchange_flow', 'Flow to/from labelled exchange', 'Flujo hacia/desde exchange etiquetado'],
  ['repeated', 'Repeated moves in a window', 'Movimientos repetidos en una ventana'],
];
const ruleName = (t) => { const r = RULES.find((x) => x[0] === t); return r ? tr(r[1], r[2]) : t; };

export async function whaleTracker() {
  const st = { asset: null, holders: null, chain: null, alerts: null, lastAlertId: store('lastAlertId', 0), feedFilter: store('feedFilter', { minUsd: 0, kind: '', chain: '', period: '24h' }) };
  const timers = [];
  const root = h('div', { class: 'wt' });
  const searchBox = h('div', { class: 'wt-search' });
  const results = h('div', { class: 'wt-results' });
  const assetBox = h('div');
  const holdersBox = h('div');
  const walletBox = h('div', { class: 'wt-wallet', hidden: true });
  const watchBox = h('div');
  const ruleBox = h('div');
  const alertBox = h('div');
  const feedBox = h('div');
  const toasts = h('div', { class: 'mt-toasts', 'aria-live': 'polite' });

  const input = h('input', { class: 'input wt-input', type: 'search', placeholder: tr('Name, symbol, ticker, contract or wallet address…', 'Nombre, símbolo, ticker, contrato o dirección de wallet…'), 'aria-label': tr('Search assets', 'Buscar activos'), value: store('labLastQ', '') });
  const go = h('button', { class: 'btn pri', onclick: () => doSearch() }, tr('Search', 'Buscar'));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  searchBox.append(input, go);

  root.append(
    h('div', { class: 'wt-hint small muted' }, tr('Real on-chain data: Blockscout (Ethereum, Base, Arbitrum, Optimism, Polygon), Solana RPC, CoinGecko/GeckoTerminal; stocks via SEC EDGAR filings. Public addresses only — never enter private keys or seed phrases.',
      'Datos on-chain reales: Blockscout (Ethereum, Base, Arbitrum, Optimism, Polygon), RPC de Solana, CoinGecko/GeckoTerminal; acciones mediante registros de la SEC. Solo direcciones públicas: nunca introduzcas claves privadas ni frases semilla.')),
    searchBox, results,
    h('div', { class: 'wt-grid' },
      h('section', { class: 'wt-main' }, assetBox, holdersBox, walletBox, adSlot('leaderboard')),
      h('aside', { class: 'wt-side' },
        h('h2', { class: 'mt-h' }, tr('Alert center', 'Centro de alertas'), h('span', { class: 'wt-badge', id: 'wtUnread' }, '0')), alertBox,
        h('h2', { class: 'mt-h' }, tr('Watched wallets', 'Wallets vigiladas')), watchBox, ruleBox,
        adSlot('rectangle'))),
    h('h2', { class: 'mt-h', style: 'margin-top:16px' }, tr('Live movements of watched wallets', 'Movimientos en directo de wallets vigiladas')), feedBox,
    toasts);

  // ---------------- search ----------------
  async function doSearch() {
    const q = input.value.trim();
    if (q.length < 2) return;
    persist('labLastQ', q);
    results.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Searching…', 'Buscando…')));
    try {
      const d = await api(`/api/lab/search?q=${encodeURIComponent(q)}`);
      if (!d.results.length) { results.replaceChildren(h('div', { class: 'notice' }, tr('No supported asset or address found.', 'No se encontró ningún activo o dirección compatible.'), d.errors.length ? ` (${d.errors.join(' · ')})` : '')); return; }
      if (d.results.length === 1) { results.replaceChildren(); openResult(d.results[0]); return; }
      results.replaceChildren(h('p', { class: 'small muted' }, tr('Several matches — choose the correct one:', 'Varias coincidencias: elige la correcta:')),
        h('div', { class: 'wt-choices' }, d.results.map((r) => h('button', { class: 'wt-choice', onclick: () => { results.replaceChildren(); openResult(r); } },
          r.image ? h('img', { src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('i', { class: 'mt-noimg' }),
          h('div', null, h('b', null, r.symbol || short(r.address)), h('div', { class: 'small muted' }, (r.name || '').slice(0, 34))),
          h('span', { class: `wt-kind kd-${r.kind}` }, { coin: tr('Coin', 'Moneda'), token: 'Token', stock: tr('Stock', 'Acción'), wallet: 'Wallet' }[r.kind]),
          r.chain ? h('span', { class: 'tag' }, r.chain) : null, h('span', { class: 'small muted' }, r.source)))),
        d.errors.length ? h('p', { class: 'small down' }, d.errors.join(' · ')) : null);
    } catch (e) { results.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  function openResult(r) {
    walletBox.hidden = true;
    if (r.kind === 'wallet') { openWallet(r.chain, r.address); return; }
    loadAsset(r);
  }

  async function loadAsset(r) {
    holdersBox.replaceChildren();
    assetBox.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Loading asset…', 'Cargando activo…')));
    const qs = r.kind === 'coin' ? `kind=coin&id=${r.id}` : r.kind === 'stock' ? `kind=stock&cik=${r.cik}` : `kind=token&chain=${r.chain}&address=${r.address}`;
    try {
      const a = await api(`/api/lab/asset?${qs}`);
      st.asset = a;
      renderAsset(a);
      if (a.kind === 'token') loadHolders(a.chain, a.address);
      else if (a.kind === 'coin' && a.deployments.length) loadHolders(a.deployments[0].chain, a.deployments[0].address);
      else if (a.kind === 'coin' && a.nativeChain && a.nativeChain !== 'solana') loadHolders(a.nativeChain, null, true);
    } catch (e) { assetBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  function renderAsset(a) {
    const kv = (k, v) => h('div', null, h('span', null, k), h('b', null, v ?? '—'));
    const chainTabs = a.kind === 'coin' && (a.deployments.length > 1 || (a.deployments.length && a.nativeChain))
      ? h('div', { class: 'mt-tabs' }, [...a.deployments.map((d) => h('button', { onclick: (e) => { markTab(e); loadHolders(d.chain, d.address); } }, d.chain)),
        a.nativeChain && a.nativeChain !== 'solana' ? h('button', { onclick: (e) => { markTab(e); loadHolders(a.nativeChain, null, true); } }, tr(`${a.nativeChain} native`, `${a.nativeChain} nativo`)) : null]) : null;
    assetBox.replaceChildren(h('div', { class: 'mt-card wt-asset' },
      h('div', { class: 'mt-tok big' }, a.image ? h('img', { src: a.image, alt: '', referrerpolicy: 'no-referrer' }) : h('i', { class: 'mt-noimg' }),
        h('div', null, h('b', null, `${a.symbol || ''} · ${a.name || ''}`), h('div', { class: 'small muted' }, a.kind === 'stock' ? `CIK ${a.cik} · ${(a.exchanges || []).join(', ')}` : a.chain ? `${a.chain} · ${short(a.address)}` : 'CoinGecko'))),
      a.kind !== 'stock' ? h('div', { class: 'mt-kv' },
        kv(tr('Price', 'Precio'), Number.isFinite(a.priceUsd) ? `$${a.priceUsd < 1 ? a.priceUsd.toPrecision(4) : a.priceUsd.toLocaleString()}` : '—'),
        kv(tr('Market cap', 'Capitalización'), usd(a.marketCapUsd)), kv(tr('Total supply', 'Oferta total'), Number.isFinite(a.totalSupply) ? fmtAmt(a.totalSupply) : '—'),
        a.holdersCount ? kv('Holders', a.holdersCount.toLocaleString()) : kv(tr('24h', '24h'), Number.isFinite(a.change24h) ? `${a.change24h.toFixed(2)}%` : '—')) : null,
      chainTabs,
      a.limitation ? h('div', { class: 'notice warn small' }, a.limitation) : null,
      a.kind === 'stock' ? stockFilings(a) : null,
      h('div', { class: 'meta' }, statusBadge(a.kind === 'stock' ? 'historical' : 'delayed'), h('span', null, `${tr('Source', 'Fuente')}: `, h('a', { href: a.sourceUrl, target: '_blank', rel: 'noopener' }, a.source)),
        a.explorerUrl ? h('a', { href: a.explorerUrl, target: '_blank', rel: 'noopener' }, tr('Explorer ↗', 'Explorador ↗')) : null)));
  }
  const markTab = (e) => { e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); };

  function stockFilings(a) {
    const FORM = { 'SC 13D': tr('>5% owner (activist)', 'Propietario >5% (activista)'), 'SC 13G': tr('>5% owner (passive)', 'Propietario >5% (pasivo)'), 'SCHEDULE 13D': tr('>5% owner (activist)', 'Propietario >5% (activista)'), 'SCHEDULE 13G': tr('>5% owner (passive)', 'Propietario >5% (pasivo)'), 3: tr('Insider initial statement', 'Declaración inicial de insider'), 4: tr('Insider transaction', 'Operación de insider'), 5: tr('Insider annual statement', 'Declaración anual de insider') };
    return h('div', null, h('h3', { class: 'wt-h3' }, tr('Official ownership filings (SEC)', 'Registros oficiales de propiedad (SEC)')),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, tr('Filed', 'Presentado')), h('th', null, tr('Form', 'Formulario')), h('th', null, tr('Meaning', 'Significado')), h('th', null, ''))),
        h('tbody', null, a.holderFilings.length ? a.holderFilings.map((f) => h('tr', null, h('td', { class: 'num' }, f.filed), h('td', null, f.form), h('td', { class: 'small' }, FORM[f.form.replace('/A', '')] || ''), h('td', null, h('a', { href: f.url, target: '_blank', rel: 'noopener' }, tr('Document ↗', 'Documento ↗')))))
          : h('tr', null, h('td', { colspan: 4, class: 'muted' }, tr('No ownership filings in the recent list.', 'No hay registros de propiedad recientes.')))))));
  }

  async function loadHolders(chain, address, native = false) {
    st.chain = chain;
    holdersBox.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Loading holders…', 'Cargando holders…')));
    try {
      const d = await api(`/api/lab/holders?chain=${chain}${address ? `&address=${address}` : ''}${native ? '&native=1' : ''}`);
      st.holders = d;
      renderHolders(d);
    } catch (e) { holdersBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  function renderHolders(d) {
    const c = d.concentration;
    holdersBox.replaceChildren(
      h('h3', { class: 'wt-h3' }, tr('Top holders', 'Mayores holders'), ' · ', d.chain, d.native ? ` (${tr('native', 'nativo')})` : ''),
      c ? h('div', { class: 'wt-conc' }, bars([[tr('Top 1', 'Top 1'), c.top1], [tr('Top 5', 'Top 5'), c.top5], [tr('Top 10', 'Top 10'), c.top10], [tr('Top 20', 'Top 20'), c.top20]].map(([label, v]) => ({ label, value: v })), { min: 0, max: 100, format: (v) => `${v.toFixed(1)}%` }),
        h('p', { class: 'small muted' }, `${tr('Denominator', 'Denominador')}: ${d.denominatorLabel}${Number.isFinite(d.totalSupply) ? ` = ${fmtAmt(d.totalSupply)}` : ''}`)) : h('p', { class: 'small muted' }, d.denominatorLabel || ''),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl wt-tbl' },
        h('thead', null, h('tr', null, ...['#', tr('Wallet', 'Wallet'), tr('Label (evidence)', 'Etiqueta (evidencia)'), tr('Amount', 'Cantidad'), '%', tr('Value', 'Valor'), ''].map((x) => h('th', null, x)))),
        h('tbody', null, d.holders.map((x) => h('tr', null,
          h('td', { class: 'num' }, x.rank),
          h('td', { class: 'mono' }, h('button', { class: 'linkbtn', onclick: () => openWallet(d.chain, x.address) }, short(x.address)), ' ', h('button', { class: 'iconbtn', title: tr('Copy', 'Copiar'), onclick: () => navigator.clipboard?.writeText(x.address) }, '⧉')),
          h('td', { class: 'small' }, x.label || h('span', { class: 'muted' }, tr('unlabelled', 'sin etiqueta')), x.isScam ? h('span', { class: 'tag hot' }, 'scam') : null),
          h('td', { class: 'num' }, fmtAmt(x.amount)), h('td', { class: 'num' }, x.pct == null ? '—' : `${x.pct.toFixed(2)}%`), h('td', { class: 'num' }, usd(x.valueUsd)),
          h('td', null, h('button', { class: 'btn sm', onclick: () => watchWallet(d.chain, x.address, x.label) }, tr('Watch', 'Vigilar')))))))),
      h('p', { class: 'small muted' }, d.labelsNote || ''),
      h('div', { class: 'meta' }, statusBadge('delayed'), h('a', { href: d.sourceUrl, target: '_blank', rel: 'noopener' }, d.source), h('span', null, `${tr('Updated', 'Actualizado')}: ${fmtTime(d.fetchedAt)}`), d.rpc === 'public' ? h('span', { class: 'note' }, tr('public RPC', 'RPC público')) : null));
  }

  // ---------------- wallet view ----------------
  let walletTimer = null;
  async function openWallet(chain, address) {
    walletBox.hidden = false;
    walletBox.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), tr('Loading wallet…', 'Cargando wallet…')));
    walletBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (walletTimer) clearInterval(walletTimer);
    try {
      const w = await api(`/api/lab/wallet?chain=${chain}&address=${address}`);
      const actBox = h('div');
      const histBox = h('div');
      const tokenSel = h('select', { class: 'input', onchange: () => loadHist(tokenSel.value) }, h('option', { value: '' }, tr('Balance history of…', 'Historial de saldo de…')),
        w.positions.slice(0, 30).map((p) => h('option', { value: p.token }, `${p.symbol || short(p.token)} (${fmtAmt(p.amount)})`)));
      const loadHist = async (token) => {
        if (!token) return histBox.replaceChildren();
        histBox.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), '…'));
        try {
          const hh = await api(`/api/lab/wallet/history?chain=${chain}&address=${address}&token=${token}`);
          histBox.replaceChildren(hh.points.length ? lineChart([{ name: tr('Balance', 'Saldo'), points: hh.points.map((p) => ({ date: p.date.slice(0, 19), value: p.value })) }], { format: (v) => fmtAmt(v) }) : h('p', { class: 'muted small' }, tr('No movements of this token in the recent history.', 'Sin movimientos de este token en el historial reciente.')),
            h('p', { class: 'small muted' }, `${hh.basis} · ${hh.source}`));
        } catch (e) { histBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
      };
      const renderAct = (act, at) => actBox.replaceChildren(
        h('div', { class: 'meta' }, statusBadge('delayed'), h('span', null, `${tr('Auto-refresh every 30 s', 'Actualización automática cada 30 s')} · ${act.latency || ''}`), at ? h('span', null, `${tr('Updated', 'Actualizado')} ${ago(at)}`) : null),
        act.error ? h('div', { class: 'error-box' }, act.error) : activityTable(act.events));
      walletBox.replaceChildren(h('div', { class: 'mt-card' },
        h('div', { class: 'wt-whead' }, h('div', null, h('b', { class: 'mono' }, short(address)), ' ', w.label ? h('span', { class: 'tag vio' }, w.label) : null, w.isContract ? h('span', { class: 'tag' }, tr('contract', 'contrato')) : null,
          h('div', { class: 'small muted mono' }, `${chain} · ${address}`)),
          h('div', { class: 'controls' }, h('button', { class: 'btn sm pri', onclick: () => watchWallet(chain, address, w.label) }, tr('Watch & alert', 'Vigilar y alertar')),
            h('a', { class: 'btn sm', href: w.explorerUrl, target: '_blank', rel: 'noopener' }, tr('Explorer ↗', 'Explorador ↗')),
            h('button', { class: 'btn sm', onclick: () => { walletBox.hidden = true; clearInterval(walletTimer); } }, '✕'))),
        h('div', { class: 'mt-kv' }, h('div', null, h('span', null, w.native.symbol), h('b', null, w.native.amount == null ? '—' : fmtAmt(w.native.amount))),
          h('div', null, h('span', null, tr('Token positions', 'Posiciones en tokens')), h('b', null, w.positions.length)),
          h('div', null, h('span', null, tr('Valued positions', 'Posiciones valoradas')), h('b', null, usd(w.positions.reduce((a, p) => a + (p.valueUsd || 0), 0))))),
        h('h3', { class: 'wt-h3' }, tr('Positions', 'Posiciones')),
        h('div', { class: 'tbl-wrap wt-pos' }, h('table', { class: 'tbl' }, h('tbody', null, w.positions.slice(0, 15).map((p) => h('tr', null, h('td', null, h('b', null, p.symbol || short(p.token))), h('td', { class: 'num' }, fmtAmt(p.amount)), h('td', { class: 'num' }, usd(p.valueUsd))))))),
        h('div', { class: 'controls' }, tokenSel), histBox,
        h('h3', { class: 'wt-h3' }, tr('Activity', 'Actividad')), actBox,
        h('p', { class: 'small muted' }, tr('Buy/Sell only when the same transaction shows the wallet giving one asset and receiving another (a swap) or a router swap call; otherwise it is a transfer. Native-coin legs of swaps may not appear in token-transfer data.',
          'Compra/Venta solo cuando la misma transacción muestra a la wallet entregando un activo y recibiendo otro (swap) o una llamada swap a un router; si no, es una transferencia. La parte en moneda nativa de un swap puede no aparecer en los datos de transferencias.'))));
      renderAct(w.activity, w.fetchedAt);
      walletTimer = setInterval(async () => {
        if (!document.body.contains(walletBox) || walletBox.hidden) { clearInterval(walletTimer); return; }
        try { const a = await api(`/api/lab/wallet/activity?chain=${chain}&address=${address}`); renderAct(a, a.fetchedAt); } catch (e) { /* keep last good data; show error */ actBox.prepend(h('div', { class: 'error-box small' }, e.message)); }
      }, 30000);
      timers.push(walletTimer);
    } catch (e) { walletBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  function activityTable(evs) {
    if (!evs.length) return h('p', { class: 'muted small' }, tr('No recent movements returned by the provider.', 'El proveedor no devolvió movimientos recientes.'));
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl wt-tbl' },
      h('thead', null, h('tr', null, ...[tr('Time', 'Hora'), tr('Type', 'Tipo'), tr('Amount', 'Cantidad'), tr('Value', 'Valor'), tr('Counterparty', 'Contraparte'), tr('Status', 'Estado'), 'Tx'].map((x) => h('th', null, x)))),
      h('tbody', null, evs.slice(0, 40).map((e) => h('tr', null,
        h('td', { class: 'small', title: e.ts }, fmtTime(e.ts)), h('td', null, kindTag(e.kind)),
        h('td', { class: 'num' }, `${fmtAmt(e.amount)} ${e.token_symbol || (e.token ? short(e.token) : '')}`), h('td', { class: 'num' }, usd(e.amount_usd)),
        h('td', { class: 'small' }, e.counterparty_label || (e.counterparty ? short(e.counterparty) : '—')),
        h('td', null, h('span', { class: `wst st-${e.status}` }, e.status)),
        h('td', null, e.explorer_url ? h('a', { href: e.explorer_url, target: '_blank', rel: 'noopener', class: 'mono small' }, `${short(e.tx_hash)} ↗`) : short(e.tx_hash)))))));
  }

  // ---------------- watchlist, rules, alerts ----------------
  async function watchWallet(chain, address, label) {
    const name = prompt(tr('Label for this wallet (optional):', 'Etiqueta para esta wallet (opcional):'), label || '');
    if (name === null) return;
    try { await authApi('/api/alerts/watch', { method: 'POST', body: { chain, address, label: name } }); toast(tr('Wallet added to your watchlist', 'Wallet añadida a tu lista de seguimiento')); await refreshAlerts(); }
    catch (e) { toast(e.message, true); }
  }

  async function refreshAlerts() {
    try {
      st.alerts = await authApi('/api/alerts/state');
      renderWatch(); renderAlertCenter();
    } catch (e) { watchBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  function renderWatch() {
    const s = st.alerts;
    const unread = root.querySelector('#wtUnread');
    if (unread) { unread.textContent = s.unread; unread.classList.toggle('on', s.unread > 0); }
    if (!s.wallets.length) { watchBox.replaceChildren(h('p', { class: 'small muted' }, tr('No wallets yet. Open any holder or wallet and press “Watch”, or add an address:', 'Aún no hay wallets. Abre cualquier holder o wallet y pulsa «Vigilar», o añade una dirección:')), addForm()); return; }
    watchBox.replaceChildren(...s.wallets.map((w) => {
      const rules = s.rules.filter((r) => r.wallet_id === w.id);
      return h('div', { class: `wt-w ${w.enabled ? '' : 'off'}` },
        h('div', { class: 'wt-wtop' }, h('button', { class: 'linkbtn', onclick: () => openWallet(w.chain, w.address) }, h('b', null, w.label || short(w.address))), h('span', { class: 'tag' }, w.chain),
          h('label', { class: 'mt-toggle', title: tr('Alerts on/off', 'Alertas on/off') }, h('input', { type: 'checkbox', checked: w.enabled ? true : null, onchange: async (e) => { await authApi('/api/alerts/watch/toggle', { method: 'POST', body: { id: w.id, enabled: e.target.checked } }); refreshAlerts(); } }), tr('active', 'activa')),
          h('button', { class: 'iconbtn', title: tr('Remove', 'Eliminar'), onclick: async () => { if (confirm(tr('Remove this wallet and its rules?', '¿Eliminar esta wallet y sus reglas?'))) { await authApi('/api/alerts/watch/delete', { method: 'POST', body: { id: w.id } }); refreshAlerts(); } } }, '🗑')),
        h('div', { class: 'small muted' }, w.last_checked_at ? `${tr('Checked', 'Revisada')} ${ago(w.last_checked_at)}` : tr('Waiting for first server scan (≤ 1–2 min)', 'Esperando el primer escaneo del servidor (≤ 1–2 min)'), w.last_error ? h('span', { class: 'down' }, ` · ${w.last_error.slice(0, 90)}`) : null),
        h('ul', { class: 'wt-rules' }, rules.map((r) => h('li', null, h('span', { class: r.enabled ? '' : 'muted' }, ruleName(r.type), ruleDetail(r)),
          h('button', { class: 'iconbtn', onclick: () => editRule(w, r) }, '✎'), h('button', { class: 'iconbtn', onclick: async () => { await authApi('/api/alerts/rules/delete', { method: 'POST', body: { id: r.id } }); refreshAlerts(); } }, '✕')))),
        h('button', { class: 'btn sm', style: 'margin:0', onclick: () => editRule(w, null) }, tr('+ Alert rule', '+ Regla de alerta')));
    }), addForm(), h('div', { class: 'controls', style: 'margin-top:6px' },
      h('button', { class: 'btn sm', style: 'margin:0', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await authApi('/api/alerts/check', { method: 'POST' }); toast(tr(`Checked ${r.scanned} wallets`, `Revisadas ${r.scanned} wallets`)); await refreshAlerts(); await pollAlerts(); await loadFeed(); } catch (err) { toast(err.message, true); } e.currentTarget.disabled = false; } }, tr('Check now', 'Comprobar ahora')),
      settingsForm()));
  }

  const ruleDetail = (r) => [r.token ? ` · ${short(r.token)}` : '', r.min_amount != null ? ` · ≥${fmtAmt(r.min_amount)}` : '', r.min_usd != null ? ` · ≥$${fmtAmt(r.min_usd)}` : '', r.pct != null ? ` · ≥${r.pct}%` : '',
    r.counterparty ? ` · ${short(r.counterparty)}` : '', r.type === 'repeated' ? ` · ${r.min_count}/${r.window_min}m` : '', r.channel === 'telegram' ? ' · Telegram' : '', r.cooldown_min ? ` · ${tr('cooldown', 'pausa')} ${r.cooldown_min}m` : ''].join('');

  function addForm() {
    const chain = h('select', { class: 'input' }, CHAINS.map((c) => h('option', { value: c }, c)));
    const addr = h('input', { class: 'input', placeholder: tr('Public address', 'Dirección pública'), style: 'flex:1;min-width:140px' });
    return h('form', { class: 'controls wt-add', onsubmit: (e) => { e.preventDefault(); if (addr.value.trim()) watchWallet(chain.value, addr.value.trim(), ''); } }, chain, addr, h('button', { class: 'btn sm', type: 'submit' }, tr('Add', 'Añadir')));
  }

  function settingsForm() {
    const s = st.alerts.settings;
    if (!s.telegramAvailable) return h('span', { class: 'small muted' }, tr('Telegram delivery: server bot not configured.', 'Envío por Telegram: bot del servidor no configurado.'));
    const inp = h('input', { class: 'input', value: s.telegramChatId || '', placeholder: 'Telegram chat id', style: 'width:150px' });
    return h('form', { class: 'controls', onsubmit: async (e) => { e.preventDefault(); try { await authApi('/api/alerts/settings', { method: 'POST', body: { telegram_chat_id: inp.value } }); toast(tr('Saved', 'Guardado')); } catch (err) { toast(err.message, true); } } }, inp, h('button', { class: 'btn sm', type: 'submit' }, 'OK'));
  }

  function editRule(w, r) {
    const f = { ...(r || { type: 'any_move', channel: 'inapp', cooldown_min: 0, enabled: 1 }) };
    const type = h('select', { class: 'input' }, RULES.map(([k, en, es]) => h('option', { value: k, selected: k === f.type ? true : null }, tr(en, es))));
    const field = (key, label, ph = '') => { const i = h('input', { class: 'input', value: f[key] ?? '', placeholder: ph, 'data-k': key }); return h('label', { class: 'f' }, label, i); };
    const channel = h('select', { class: 'input' }, h('option', { value: 'inapp' }, tr('In VOID', 'En VOID')), st.alerts.settings.telegramAvailable ? h('option', { value: 'telegram', selected: f.channel === 'telegram' ? true : null }, 'Telegram + VOID') : null);
    const enabled = h('input', { type: 'checkbox', checked: f.enabled ? true : null });
    const err = h('div', { class: 'small down' });
    const form = h('form', { class: 'wt-ruleform mt-card', onsubmit: async (e) => {
      e.preventDefault();
      const body = { id: r?.id, wallet_id: w.id, type: type.value, channel: channel.value, enabled: enabled.checked };
      form.querySelectorAll('input[data-k]').forEach((i) => { body[i.dataset.k] = i.value.trim() === '' ? null : i.value.trim(); });
      try { await authApi('/api/alerts/rules', { method: 'POST', body }); ruleBox.replaceChildren(); toast(tr('Rule saved', 'Regla guardada')); refreshAlerts(); } catch (x) { err.textContent = x.message; }
    } },
    h('b', null, `${r ? tr('Edit rule', 'Editar regla') : tr('New rule', 'Nueva regla')} · ${w.label || short(w.address)}`),
    h('label', { class: 'f' }, tr('Condition', 'Condición'), type),
    field('token', tr('Only this token (contract/mint, optional)', 'Solo este token (contrato/mint, opcional)')),
    h('div', { class: 'controls' }, field('min_amount', tr('Min. amount (tokens)', 'Cantidad mín. (tokens)')), field('min_usd', tr('Min. value (USD)', 'Valor mín. (USD)'))),
    h('div', { class: 'controls' }, field('pct', tr('Balance change %', 'Cambio de saldo %')), field('counterparty', tr('Counterparty address', 'Dirección contraparte'))),
    h('div', { class: 'controls' }, field('min_count', tr('Repeated: count', 'Repetidos: número')), field('window_min', tr('Window (min)', 'Ventana (min)')), field('cooldown_min', tr('Cooldown (min)', 'Pausa (min)'))),
    h('div', { class: 'controls' }, h('label', { class: 'f' }, tr('Channel', 'Canal'), channel), h('label', { class: 'mt-toggle' }, enabled, tr('Enabled', 'Activa'))),
    err, h('div', { class: 'controls' }, h('button', { class: 'btn pri sm', type: 'submit' }, tr('Save', 'Guardar')), h('button', { class: 'btn sm', type: 'button', onclick: () => ruleBox.replaceChildren() }, tr('Cancel', 'Cancelar'))),
    h('p', { class: 'small muted' }, tr('Rules are evaluated on the server every minute, even with VOID closed. Only movements after the rule was created can trigger it.', 'Las reglas se evalúan en el servidor cada minuto, aunque VOID esté cerrado. Solo los movimientos posteriores a la creación de la regla pueden activarla.')));
    ruleBox.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function renderAlertCenter() {
    try {
      const d = await authApi('/api/alerts/events');
      alertBox.replaceChildren(
        h('div', { class: 'controls' }, h('button', { class: 'btn sm', style: 'margin:0', onclick: async () => { await authApi('/api/alerts/read', { method: 'POST', body: { ids: 'all' } }); refreshAlerts(); } }, tr('Mark all read', 'Marcar todo leído')),
          'Notification' in window && Notification.permission === 'default' ? h('button', { class: 'btn sm', onclick: () => Notification.requestPermission() }, tr('Browser notifications', 'Notificaciones del navegador')) : null),
        ...(d.events.length ? d.events.slice(0, 30).map((a) => h('div', { class: `wt-alert ${a.read ? '' : 'unread'}` },
          h('div', null, kindTag(a.kind), ' ', h('b', null, a.wallet_label || short(a.address)), h('span', { class: 'small muted' }, ` · ${a.chain}`)),
          h('div', { class: 'small' }, L(a.summary)),
          h('div', { class: 'small muted' }, `${fmtTime(a.ts)} · ${tr('rule', 'regla')} #${a.rule_id}`, ' · ', a.explorer_url ? h('a', { href: a.explorer_url, target: '_blank', rel: 'noopener' }, `${short(a.tx_hash)} ↗`) : null)))
          : [h('p', { class: 'small muted' }, tr('No alerts yet.', 'Todavía no hay alertas.'))]));
      const maxId = d.events.reduce((m, a) => Math.max(m, a.id), 0);
      if (maxId > st.lastAlertId) { st.lastAlertId = maxId; persist('lastAlertId', maxId); }
    } catch (e) { alertBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
  }

  async function pollAlerts() {
    try {
      const d = await authApi(`/api/alerts/events?since=${st.lastAlertId}`);
      if (d.events.length) {
        for (const a of d.events.slice(0, 3)) {
          toast(`${a.wallet_label || short(a.address)}: ${L(a.summary)}`);
          if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(`VOID 🐋 ${a.wallet_label || short(a.address)}`, { body: L(a.summary), tag: `alert-${a.id}` }); } catch { /* ignore */ } }
        }
        await refreshAlerts();
      }
    } catch { /* offline: next poll retries */ }
  }

  async function loadFeed() {
    const f = st.feedFilter;
    const sel = (key, opts) => h('select', { class: 'input', onchange: (e) => { f[key] = e.target.value; persist('feedFilter', f); renderFeed(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(f[key]) === String(v) ? true : null }, l)));
    const controls = h('div', { class: 'controls' },
      sel('kind', [['', tr('All types', 'Todos los tipos')], ...Object.entries(KIND).map(([k, v]) => [k, tr(v[0], v[1])])]),
      sel('chain', [['', tr('All chains', 'Todas las redes')], ...CHAINS.map((c) => [c, c])]),
      sel('minUsd', [[0, tr('Any value', 'Cualquier valor')], [1000, '≥ $1K'], [10000, '≥ $10K'], [100000, '≥ $100K'], [1000000, '≥ $1M']]),
      sel('period', [['1h', '1h'], ['24h', '24h'], ['7d', '7d'], ['all', tr('All', 'Todo')]]),
      h('span', { class: 'small muted' }, tr('Server scan every minute · page refresh every 30 s', 'Escaneo del servidor cada minuto · refresco de la página cada 30 s')));
    let events = [];
    const tableBox = h('div');
    const renderFeed = () => {
      const cut = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3 }[f.period];
      const rows = events.filter((e) => (!f.kind || e.kind === f.kind) && (!f.chain || e.chain === f.chain) && (!Number(f.minUsd) || (e.amount_usd ?? 0) >= Number(f.minUsd)) && (!cut || Date.now() - Date.parse(e.ts) <= cut));
      tableBox.replaceChildren(rows.length ? activityTable(rows.map((e) => ({ ...e, counterparty_label: `${e.wallet_label || short(e.address)} ↔ ${e.counterparty_label || short(e.counterparty)}` })))
        : h('p', { class: 'small muted' }, tr('No movements match. Watched wallets appear here after the first server scan.', 'No hay movimientos que coincidan. Las wallets vigiladas aparecen aquí tras el primer escaneo del servidor.')));
    };
    try { events = (await authApi('/api/alerts/feed')).events; } catch (e) { feedBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); return; }
    feedBox.replaceChildren(controls, tableBox);
    renderFeed();
  }

  function toast(msg, isErr = false) {
    const t = h('div', { class: `mt-toastitem ${isErr ? 'err' : ''}` }, msg);
    toasts.append(t);
    setTimeout(() => t.remove(), 8000);
  }

  await refreshAlerts();
  loadFeed();
  if (store('labLastQ', '')) doSearch();
  const tick = setInterval(() => {
    if (!document.body.contains(root)) { timers.forEach(clearInterval); clearInterval(tick); return; }
    if (document.visibilityState === 'visible') { pollAlerts(); loadFeed(); }
  }, 30000);
  return root;
}
