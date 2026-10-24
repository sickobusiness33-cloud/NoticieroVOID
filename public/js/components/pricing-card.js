// VOID PRO pricing card — vanilla port of the supplied PricingDemo.tsx. Keeps the ShaderCard2
// configuration (color #5227FF, speed 0.5, noiseScale 1.5, waveAmount 0.15, branchIntensity 2,
// blur 5, opacity 0.8, tilt, glow) and structure (badge, title, copy, price, benefits, note,
// button, footnote). Benefits list only what VOID PRO actually delivers today.
import { shaderCard2 } from './shader-card.js';
import { icon } from '../icons.js';
import { tr, getLang } from '../i18n.js';
import { h } from '../ui.js';

export const PRO_BENEFITS = [
  ['No VOID-managed ads: the ad scripts are removed from every page for members', 'Sin anuncios gestionados por VOID: los scripts de publicidad se eliminan de todas las páginas para miembros'],
  ['Saved stories synced to your account across devices', 'Noticias guardadas sincronizadas en tu cuenta en todos tus dispositivos'],
  ['Supports independent bilingual market news', 'Apoyas un medio independiente y bilingüe de noticias de mercado'],
];

export function pricingCard({ isSubscribed = false, isLoading = false, disabled = false, label = null, onSubscribe, onManageSubscription }) {
  const es = getLang() === 'es';
  const btnText = isLoading ? tr('Processing…', 'Procesando…') : label || (isSubscribed ? tr('Manage VOID PRO', 'Gestionar VOID PRO') : tr('Activate VOID PRO', 'Activar VOID PRO'));
  const button = h('button', { type: 'button', class: 'pc-btn', disabled: isLoading || disabled, 'aria-busy': isLoading ? 'true' : null, onclick: () => (isSubscribed ? onManageSubscription?.() : onSubscribe?.()) },
    h('span', null, btnText), isLoading ? null : icon('arrow-right', 'pc-ico'));
  return shaderCard2({
    color: '#5227FF', speed: 0.5, noiseScale: 1.5, waveAmount: 0.15, branchIntensity: 2.0, blur: 5.0, opacity: 0.8, enableTilt: true, glow: true,
    className: 'pricing-card',
  },
  h('div', { class: 'pc-head' },
    h('div', { class: 'pc-badge' }, h('span', { class: 'pc-dot' }), h('span', null, tr('VOID PRO MEMBERSHIP', 'MEMBRESÍA VOID PRO'))),
    h('div', null,
      h('h3', { class: 'pc-title' }, 'VOID PRO', icon('sparkles', 'pc-spark')),
      h('p', { class: 'pc-copy' }, tr('A cleaner research experience with your reading synced to your account.', 'Una experiencia de lectura más limpia, con tus lecturas sincronizadas en tu cuenta.')))),
  h('div', { class: 'pc-price' }, h('span', { class: 'pc-amount' }, es ? '7,50 €' : '€7.50'), h('span', { class: 'pc-per' }, tr('/ month', '/ mes'))),
  h('ul', { class: 'pc-benefits' }, PRO_BENEFITS.map(([en, esTxt]) => h('li', null, icon('check', 'pc-check'), h('span', null, es ? esTxt : en)))),
  h('div', { class: 'pc-note' }, icon('shield-check', 'pc-check'),
    h('span', null, tr('Secure recurring billing by Stripe. Manage or cancel your subscription from your account; access continues until the end of the paid period.',
      'Cobro recurrente seguro con Stripe. Gestiona o cancela tu suscripción desde tu cuenta; el acceso sigue hasta el final del periodo pagado.'))),
  button,
  h('p', { class: 'pc-foot' }, tr('€7.50/month. Recurring subscription.', '7,50 €/mes. Suscripción recurrente.')));
}
