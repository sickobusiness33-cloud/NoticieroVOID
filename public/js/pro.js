// VOID PRO page: Google sign-in → Stripe Checkout (€7.50/month) → back here (sync) → Stripe
// customer portal for management. Every state shown comes from the server (/api/me); the page
// never grants PRO by itself.
import { tr, getLang } from './i18n.js';
import { h, api, fmtTime } from './ui.js';
import { app, refreshAccount } from './app.js';
import { pricingCard } from './components/pricing-card.js';
import { icon } from './icons.js';

const STATE_TEXT = {
  none: null,
  pending: ['Your payment is being confirmed by Stripe. This page updates automatically.', 'Stripe está confirmando tu pago. Esta página se actualiza sola.'],
  active: ['VOID PRO is active.', 'VOID PRO está activo.'],
  canceling: ['VOID PRO is active and will end on {date} (cancellation scheduled).', 'VOID PRO está activo y terminará el {date} (cancelación programada).'],
  past_due: ['Your last payment failed. Update your payment method to restore VOID PRO.', 'Tu último pago falló. Actualiza tu método de pago para recuperar VOID PRO.'],
  canceled: ['Your VOID PRO subscription was canceled.', 'Tu suscripción VOID PRO se canceló.'],
  expired: ['Your VOID PRO subscription has expired.', 'Tu suscripción VOID PRO ha caducado.'],
};

let gisLoading = null;
function loadGis() {
  gisLoading = gisLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.onload = resolve; s.onerror = () => { gisLoading = null; reject(new Error('Google sign-in could not load')); };
    document.head.append(s);
  });
  return gisLoading;
}

export async function proPage({ query }) {
  document.title = `VOID PRO · Noticiero VOID`;
  const root = h('div', { class: 'pro-page' });
  const status = h('div', { class: 'pro-status', role: 'status', 'aria-live': 'polite' });
  const cardSlot = h('div', { class: 'pro-card-slot' });
  const accountBox = h('div', { class: 'pro-account' });
  root.append(
    h('section', { class: 'pro-hero' },
      h('p', { class: 'np-kicker' }, tr('Membership', 'Membresía')),
      h('h1', { class: 'pro-title' }, 'VOID PRO'),
      h('p', { class: 'pro-sub' }, tr('Read Noticiero VOID without VOID-managed ads and keep your saved stories on every device. €7.50 per month, billed monthly until you cancel.',
        'Lee Noticiero VOID sin anuncios gestionados por VOID y conserva tus noticias guardadas en todos tus dispositivos. 7,50 € al mes, con cobro mensual hasta que canceles.')),
      status, accountBox),
    cardSlot,
    h('section', { class: 'pro-faq' },
      h('h2', null, tr('Good to know', 'Conviene saber')),
      h('p', null, tr('Billing recurs every month on the day you subscribe. Cancel anytime from "Manage VOID PRO"; you keep access until the end of the period you paid for.',
        'El cobro se repite cada mes el mismo día en que te suscribes. Cancela cuando quieras desde "Gestionar VOID PRO"; mantienes el acceso hasta el final del periodo pagado.')),
      h('p', null, tr('Ad-free covers the advertising VOID places on its own pages. Ads shown by other websites you visit, or browser push notifications you allowed before subscribing, are outside our control (revoke them in your browser settings).',
        'Sin anuncios cubre la publicidad que VOID coloca en sus páginas. Los anuncios de otras webs que visites, o las notificaciones push que permitiste antes de suscribirte, están fuera de nuestro control (puedes retirarlas en los ajustes del navegador).')),
      h('p', null, tr('Payments are processed by Stripe; VOID never sees or stores your card details.', 'Los pagos los procesa Stripe; VOID nunca ve ni guarda los datos de tu tarjeta.'))));

  let busy = false;
  const fail = (e) => { busy = false; draw(); status.replaceChildren(h('p', { class: 'pro-msg err' }, e.status === 401 ? tr('Please sign in again.', 'Vuelve a iniciar sesión.') : e.message || tr('Something went wrong.', 'Algo salió mal.'))); };
  const go = async (path) => {
    busy = true; draw();
    try { const r = await api(path, { method: 'POST', body: {} }); location.assign(r.url); } catch (e) { fail(e); }
  };

  function signInButton() {
    const me = app.me;
    if (!me?.authReady) return h('p', { class: 'pro-msg' }, tr('Sign-in is not available yet (Google sign-in is not configured).', 'El inicio de sesión aún no está disponible (falta configurar Google).'));
    const slot = h('div', { class: 'gis-slot' }, h('span', { class: 'small muted' }, tr('Loading Google sign-in…', 'Cargando inicio de sesión de Google…')));
    loadGis().then(() => {
      window.google.accounts.id.initialize({
        client_id: me.googleClientId,
        callback: async ({ credential }) => {
          try { await api('/api/auth/google', { method: 'POST', body: { credential } }); await refreshAccount(); draw(); } catch (e) { fail(e); }
        },
      });
      slot.replaceChildren();
      window.google.accounts.id.renderButton(slot, { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', locale: getLang() });
    }).catch((e) => slot.replaceChildren(h('p', { class: 'pro-msg err' }, e.message)));
    return h('div', { class: 'pro-signin' }, h('p', null, tr('Sign in to subscribe or manage your membership.', 'Inicia sesión para suscribirte o gestionar tu membresía.')), slot);
  }

  function draw() {
    const me = app.me;
    const ent = me?.pro || { state: 'none', pro: false };
    const signedIn = !!me?.signedIn;
    const msg = STATE_TEXT[ent.state];
    if (!busy) status.replaceChildren(...(msg ? [h('p', { class: `pro-msg ${ent.state === 'past_due' ? 'err' : ent.pro ? 'ok' : ''}` }, tr(...msg).replace('{date}', ent.periodEnd ? fmtTime(ent.periodEnd) : '—'))] : []));
    if (!me?.billingReady) status.append(h('p', { class: 'pro-msg' }, tr('Subscriptions are not open yet: payments are still being configured. Nothing will be charged.', 'Las suscripciones aún no están abiertas: los pagos se están configurando. No se cobrará nada.')));
    accountBox.replaceChildren(signedIn
      ? h('div', { class: 'pro-user' }, icon('user'), h('span', null, me.user.email),
        h('button', { type: 'button', class: 'btn sm', onclick: async () => { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); await refreshAccount(); draw(); } }, icon('log-out'), tr('Sign out', 'Cerrar sesión')))
      : signInButton());
    // Manage = active, canceling or failed payment (portal fixes the card); otherwise subscribe.
    const manage = ent.pro || ent.state === 'past_due';
    cardSlot.replaceChildren(pricingCard({
      isSubscribed: manage,
      isLoading: busy || ent.state === 'pending',
      disabled: !me?.billingReady || (!signedIn && !me?.authReady),
      label: ent.state === 'past_due' ? tr('Update payment method', 'Actualizar método de pago') : ['canceled', 'expired'].includes(ent.state) ? tr('Reactivate VOID PRO', 'Reactivar VOID PRO') : null,
      onSubscribe: () => {
        if (!signedIn) { accountBox.querySelector('.pro-signin')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); status.replaceChildren(h('p', { class: 'pro-msg' }, tr('Sign in with Google first.', 'Primero inicia sesión con Google.'))); return; }
        go('/api/pro/checkout');
      },
      onManageSubscription: () => go('/api/pro/portal'),
    }));
  }

  if (!app.me) await refreshAccount();
  draw();

  // Returning from Stripe Checkout.
  const checkout = query.get('checkout');
  if (checkout === 'cancel') status.replaceChildren(h('p', { class: 'pro-msg' }, tr('Checkout canceled. You have not been charged.', 'Pago cancelado. No se te ha cobrado nada.')));
  if (checkout === 'success' && app.me?.signedIn) {
    const sessionId = query.get('session_id');
    history.replaceState(null, '', '/pro');
    status.replaceChildren(h('p', { class: 'pro-msg' }, h('span', { class: 'spin' }), ' ', tr('Confirming your subscription with Stripe…', 'Confirmando tu suscripción con Stripe…')));
    // The webhook normally lands first; /sync reads the session from Stripe in case it has not.
    for (let i = 0; i < 6; i++) {
      try { await api('/api/pro/sync', { method: 'POST', body: { session_id: sessionId } }); } catch { /* retry below */ }
      await refreshAccount();
      if (app.me.pro.pro || app.me.pro.state === 'past_due') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    draw();
    // Reload so the server serves the page without ad scripts.
    if (app.me.pro.pro) setTimeout(() => location.reload(), 1200);
  }
  return root;
}

