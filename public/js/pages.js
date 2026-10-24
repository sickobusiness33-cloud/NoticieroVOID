// About, Editorial policy and Privacy (content shared with the server renderer).
import { getLang, tr } from './i18n.js';
import { h } from './ui.js';
import { PAGES } from './shared/seo.js';
import { STATIC_PAGES } from './shared/pages.js';

const linkify = (text) => text.split(/(https:\/\/\S+?)(?=[.,]?(?:\s|$))/).map((part) => (part.startsWith('https://') ? h('a', { href: part, target: '_blank', rel: 'noopener' }, part) : part));

export function staticPage() {
  const path = location.pathname;
  const lang = getLang() === 'es' ? 'es' : 'en';
  const meta = PAGES[path];
  document.title = `${meta[lang]} · Noticiero VOID`;
  return h('article', { class: 'static-page' },
    h('nav', { class: 'crumbs small' }, h('a', { href: '/' }, tr('Front page', 'Portada'))),
    h('h1', null, meta[lang]),
    STATIC_PAGES[path][lang].map(([title, paras, id]) => [title ? h('h2', { id: id || null }, title) : null, paras.map((p) => h('p', null, linkify(p)))]));
}
