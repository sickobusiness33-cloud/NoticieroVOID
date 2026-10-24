// DOM + formatting helpers and the API client.
import { t, getLang } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // only used with trusted, static strings
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = new Error(data?.error?.message || `HTTP ${res.status}`);
    e.status = res.status; e.code = data?.error?.code;
    throw e;
  }
  return data;
}

const locale = () => (getLang() === 'es' ? 'es-ES' : 'en-US');

export function fmtNum(v, digits = 2) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtCompact(v) {
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}
export function fmtUsd(v) {
  if (!Number.isFinite(v)) return '—';
  const d = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : 6;
  return '$' + v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtPct(v, digits = 2, signed = true) {
  if (!Number.isFinite(v)) return '—';
  return (signed && v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
}
export function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return getLang() === 'es' ? 'ahora' : 'now';
  if (m < 60) return getLang() === 'es' ? `hace ${m} min` : `${m}m ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return getLang() === 'es' ? `hace ${hrs} h` : `${hrs}h ago`;
  return getLang() === 'es' ? `hace ${Math.round(hrs / 24)} d` : `${Math.round(hrs / 24)}d ago`;
}
export const signClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function statusBadge(status) {
  const s = (status || 'unavailable').toLowerCase();
  return h('span', { class: `badge st-${s}`, title: statusHelp(s) }, t(`st_${s}`));
}
function statusHelp(s) {
  return {
    live: 'Streaming or sub-minute data', delayed: 'Recent data with a delay (cache or publication lag)',
    historical: 'Periodic statistic (weekly/monthly/quarterly)', estimated: 'Proxy or analytical estimate',
    unavailable: 'Provider failed or not configured', stale: 'Provider failed; showing last good value',
  }[s] || '';
}

// Footer line every data widget carries: source + status + last successful update.
export function metaLine(meta = {}) {
  return h('div', { class: 'meta' },
    statusBadge(meta.status),
    meta.unit ? h('span', null, `${t('unit')}: ${meta.unit}`) : null,
    meta.source ? h('span', null, `${t('source')}: `, meta.sourceUrl ? h('a', { href: meta.sourceUrl, target: '_blank', rel: 'noopener' }, meta.source) : meta.source) : null,
    meta.lastUpdated ? h('span', { title: meta.lastUpdated }, `${t('updated')}: ${ago(meta.lastUpdated)}`) : null,
    meta.observationDate ? h('span', null, `${t('observed')}: ${meta.observationDate}`) : null,
    meta.note ? h('span', { class: 'note' }, meta.note) : null,
    meta.error ? h('span', { class: 'err' }, meta.error) : null,
  );
}

export function panel(title, ...body) {
  return h('section', { class: 'panel' }, title ? h('header', { class: 'panel-h' }, typeof title === 'string' ? h('h2', null, title) : title) : null, h('div', { class: 'panel-b' }, ...body));
}

export function loading() { return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spin' }), t('loading')); }

export function errorBox(err, retry) {
  return h('div', { class: 'error-box', role: 'alert' },
    h('strong', null, t('unavailable')), ' — ', err?.message || String(err),
    retry ? h('button', { class: 'btn sm', onclick: retry }, t('retry')) : null);
}

// Render an async section: shows a loader, then content or a clear error with retry.
export function async(container, fn) {
  const run = async () => {
    container.replaceChildren(loading());
    try { const node = await fn(); container.replaceChildren(...[node].flat().filter(Boolean)); }
    catch (e) { container.replaceChildren(errorBox(e, run)); }
  };
  run();
  return container;
}

export function store(key, fallback) {
  try { const v = localStorage.getItem(`void.${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function persist(key, value) {
  try { localStorage.setItem(`void.${key}`, JSON.stringify(value)); } catch { /* storage unavailable: feature degrades gracefully */ }
}

export function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

export function table(headers, rows, opts = {}) {
  return h('div', { class: 'tbl-wrap' }, h('table', { class: `tbl ${opts.class || ''}` },
    h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
    h('tbody', null, rows.length ? rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))) : h('tr', null, h('td', { colspan: headers.length, class: 'muted' }, t('no_data')))),
  ));
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'tablist' });
  const render = (v) => wrap.replaceChildren(...options.map(([val, label]) =>
    h('button', { class: val === v ? 'on' : '', role: 'tab', 'aria-selected': String(val === v), onclick: () => { render(val); onChange(val); } }, label)));
  render(value);
  return wrap;
}

// Anonymous per-browser key for persistent alerts. Generated once, never sent anywhere but
// our own API (header x-void-key); the server stores only its SHA-256 hash.
export function voidKey() {
  let k = store('ownerKey', null);
  if (!k || !/^[A-Za-z0-9_-]{32,128}$/.test(k)) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    k = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    persist('ownerKey', k);
  }
  return k;
}

export async function authApi(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', 'x-void-key': voidKey() }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) { const e = new Error(data?.error?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}
