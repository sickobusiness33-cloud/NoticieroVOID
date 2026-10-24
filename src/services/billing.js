// VOID PRO billing with Stripe (REST API over fetch; no SDK needed in the Worker).
//  * Checkout: Stripe-hosted Checkout in subscription mode, €7.50/month (EUR).
//  * Webhooks: signature verified (HMAC-SHA256, 5-minute tolerance), processed once per event id;
//    the subscription is always re-read from Stripe, so out-of-order events cannot corrupt state.
//  * Management: Stripe customer portal (cancel, update card, invoices).
//  * Entitlement: computed on the server from the stored Stripe status; the client never decides.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (wrangler secrets). Optional STRIPE_PRICE_ID.

import { log } from '../lib/core.js';

export const PRO_PRICE = { amount: 750, currency: 'eur', interval: 'month' };
const API = 'https://api.stripe.com/v1';
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export const billingConfigured = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

// Stripe expects application/x-www-form-urlencoded with bracketed nested keys.
export function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? formEncode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, method, path, params, { idempotencyKey, fetchImpl = fetch } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw fail(503, 'billing_not_configured', 'Payments are not configured yet.');
  const headers = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  let url = API + path, body;
  if (params && method === 'GET') url += `?${formEncode(params)}`;
  else if (params) { body = formEncode(params).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const res = await fetchImpl(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    log('warn', 'stripe_error', { path, status: res.status, type: data.error?.type, code: data.error?.code });
    throw fail(502, 'stripe_error', `Payment provider error (${data.error?.code || res.status}).`);
  }
  return data;
}

// ---------- webhook signature ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function signPayload(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
}
export async function verifyStripeSignature(payload, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret) throw fail(503, 'billing_not_configured', 'Webhook secret not configured');
  const parts = {};
  const v1 = [];
  for (const kv of String(header || '').split(',')) {
    const [k, v] = kv.split('=');
    if (k === 't') parts.t = v; else if (k === 'v1') v1.push(v);
  }
  if (!parts.t || !v1.length) throw fail(400, 'bad_signature', 'Missing Stripe signature');
  if (Math.abs(now / 1000 - Number(parts.t)) > toleranceSec) throw fail(400, 'bad_signature', 'Stale Stripe signature');
  const expected = await signPayload(secret, parts.t, payload);
  if (!v1.some((s) => timingSafeEqual(s, expected))) throw fail(400, 'bad_signature', 'Invalid Stripe signature');
  return JSON.parse(payload);
}

// ---------- entitlement ----------
// Maps a stored subscription to the state the UI shows and to the server-side PRO flag.
export function entitlement(sub, now = Date.now()) {
  if (!sub) return { state: 'none', pro: false };
  const end = sub.current_period_end ? Date.parse(sub.current_period_end) : 0;
  const base = { periodEnd: sub.current_period_end || null, cancelAtPeriodEnd: !!sub.cancel_at_period_end, lastInvoice: sub.last_invoice_status || null };
  switch (sub.status) {
    case 'active':
    case 'trialing':
      // A missed renewal webhook must not grant access forever: 2-day grace past period end.
      if (end && end + 2 * 86400e3 < now) return { ...base, state: 'expired', pro: false };
      return { ...base, state: sub.cancel_at_period_end ? 'canceling' : 'active', pro: true };
    case 'past_due':
    case 'unpaid':
      return { ...base, state: 'past_due', pro: false };
    case 'incomplete':
      return { ...base, state: 'pending', pro: false };
    case 'incomplete_expired':
      return { ...base, state: 'expired', pro: false };
    case 'canceled':
      return { ...base, state: 'canceled', pro: false };
    default:
      return { ...base, state: 'pending', pro: false };
  }
}

export async function subscriptionFor(env, userId) {
  if (!env.DB || !userId) return null;
  return env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(userId).first();
}

const periodEnd = (s) => {
  const t = s.current_period_end ?? s.items?.data?.[0]?.current_period_end; // field moved to items in newer API versions
  return t ? new Date(t * 1000).toISOString() : null;
};

// Upserts the user's subscription from a Stripe subscription object (always fetched from Stripe).
export async function storeSubscription(env, s, lastInvoiceStatus) {
  let userId = s.metadata?.user_id || null;
  const customer = typeof s.customer === 'string' ? s.customer : s.customer?.id;
  if (!userId && customer) userId = (await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(customer).first())?.id;
  if (!userId) { log('warn', 'stripe_sub_unlinked', { subscription: s.id }); return null; }
  const existing = await subscriptionFor(env, userId);
  // A user keeps one VOID PRO record; an older, ended subscription never overwrites a live one.
  if (existing && existing.stripe_subscription_id !== s.id && ['active', 'trialing', 'past_due'].includes(existing.status) && ['canceled', 'incomplete_expired'].includes(s.status)) return existing;
  await env.DB.prepare(`INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, price_id, current_period_end, cancel_at_period_end, last_invoice_status, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id = excluded.stripe_subscription_id, stripe_customer_id = excluded.stripe_customer_id,
      status = excluded.status, price_id = excluded.price_id, current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end, last_invoice_status = COALESCE(excluded.last_invoice_status, subscriptions.last_invoice_status), updated_at = excluded.updated_at`)
    .bind(userId, s.id, customer, s.status, s.items?.data?.[0]?.price?.id || null, periodEnd(s), s.cancel_at_period_end ? 1 : 0, lastInvoiceStatus || null, new Date().toISOString()).run();
  return subscriptionFor(env, userId);
}

async function ensureCustomer(env, user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = await stripe(env, 'POST', '/customers', { email: user.email, name: user.name || undefined, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL').bind(c.id, user.id).run();
  return (await env.DB.prepare('SELECT stripe_customer_id AS id FROM users WHERE id = ?').bind(user.id).first()).id;
}

export async function createCheckout(env, user, site) {
  if (!billingConfigured(env)) throw fail(503, 'billing_not_configured', 'Payments are not configured yet.');
  const ent = entitlement(await subscriptionFor(env, user.id));
  if (ent.pro || ent.state === 'past_due') throw fail(409, 'already_subscribed', 'You already have a VOID PRO subscription; manage it from the portal.');
  const customer = await ensureCustomer(env, user);
  const lineItem = env.STRIPE_PRICE_ID
    ? { price: env.STRIPE_PRICE_ID, quantity: 1 }
    : { quantity: 1, price_data: { currency: PRO_PRICE.currency, unit_amount: PRO_PRICE.amount, recurring: { interval: PRO_PRICE.interval }, product_data: { name: 'VOID PRO', description: 'Noticiero VOID monthly membership' } } };
  const session = await stripe(env, 'POST', '/checkout/sessions', {
    mode: 'subscription', customer, client_reference_id: user.id, line_items: [lineItem],
    subscription_data: { metadata: { user_id: user.id } }, metadata: { user_id: user.id },
    success_url: `${site}/pro?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${site}/pro?checkout=cancel`,
    locale: 'auto',
  });
  return { url: session.url };
}

export async function createPortal(env, user, site) {
  if (!billingConfigured(env)) throw fail(503, 'billing_not_configured', 'Payments are not configured yet.');
  if (!user.stripeCustomerId) throw fail(404, 'no_customer', 'No VOID PRO billing account yet.');
  const s = await stripe(env, 'POST', '/billing_portal/sessions', { customer: user.stripeCustomerId, return_url: `${site}/pro` });
  return { url: s.url };
}

// After Checkout redirects back, read the session from Stripe (in case the webhook is still
// in flight). Only the user who started the session can sync it.
export async function syncCheckout(env, user, sessionId) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId || '')) throw fail(400, 'bad_session', 'Invalid checkout session id');
  const cs = await stripe(env, 'GET', `/checkout/sessions/${sessionId}`);
  if (cs.client_reference_id !== user.id) throw fail(403, 'forbidden', 'This checkout session belongs to another account.');
  if (!cs.subscription) return entitlement(await subscriptionFor(env, user.id));
  const s = await stripe(env, 'GET', `/subscriptions/${cs.subscription}`);
  return entitlement(await storeSubscription(env, { ...s, metadata: { ...s.metadata, user_id: user.id } }));
}

const HANDLED = new Set(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed']);

export async function handleWebhook(env, request) {
  const payload = await request.text();
  const event = await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!HANDLED.has(event.type)) return { received: true, ignored: event.type };
  // Process each event once (Stripe retries deliveries).
  const fresh = await env.DB.prepare('INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(event.id, event.type, new Date().toISOString()).run();
  if (!fresh.meta?.changes) return { received: true, duplicate: true };
  const o = event.data.object;
  let subId = null, invoiceStatus = null;
  if (event.type === 'checkout.session.completed') {
    subId = o.subscription;
    if (o.client_reference_id && o.customer) await env.DB.prepare('UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?').bind(o.customer, o.client_reference_id).run();
  } else if (event.type.startsWith('customer.subscription.')) {
    subId = o.id;
  } else {
    subId = o.subscription || o.parent?.subscription_details?.subscription || o.lines?.data?.[0]?.subscription || null;
    invoiceStatus = event.type === 'invoice.payment_failed' ? 'failed' : 'paid';
  }
  if (!subId) return { received: true };
  try {
    const s = await stripe(env, 'GET', `/subscriptions/${subId}`);
    const stored = await storeSubscription(env, s, invoiceStatus);
    log('info', 'stripe_webhook', { type: event.type, status: s.status, linked: !!stored });
  } catch (e) {
    // Let Stripe retry: forget the event id so the retry is processed.
    await env.DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(event.id).run();
    throw e;
  }
  return { received: true };
}
