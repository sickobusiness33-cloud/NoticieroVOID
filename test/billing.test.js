import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitlement, formEncode, signPayload, verifyStripeSignature, handleWebhook, createCheckout, PRO_PRICE } from '../src/services/billing.js';
import { verifyGoogleIdToken, readCookie, sessionCookie, sameOrigin } from '../src/services/account.js';
import { activeNavIndex, NAV_ITEMS } from '../public/js/shared/nav.js';
import { mapEvent } from '../src/adapters/polymarket.js';
import { classify } from '../public/js/shared/news.js';

const SECRET = 'whsec_test_secret';
const now = Date.now();
const future = new Date(now + 20 * 86400e3).toISOString();
const past = new Date(now - 5 * 86400e3).toISOString();

test('price is €7.50 per month in EUR', () => {
  assert.deepEqual(PRO_PRICE, { amount: 750, currency: 'eur', interval: 'month' });
});

test('entitlement covers every subscription state', () => {
  assert.deepEqual(entitlement(null), { state: 'none', pro: false });
  assert.equal(entitlement({ status: 'active', current_period_end: future }).pro, true);
  assert.equal(entitlement({ status: 'active', current_period_end: future }).state, 'active');
  assert.equal(entitlement({ status: 'trialing', current_period_end: future }).pro, true);
  const canceling = entitlement({ status: 'active', current_period_end: future, cancel_at_period_end: 1 });
  assert.equal(canceling.state, 'canceling'); assert.equal(canceling.pro, true);
  assert.deepEqual([entitlement({ status: 'past_due' }).state, entitlement({ status: 'past_due' }).pro], ['past_due', false]);
  assert.equal(entitlement({ status: 'unpaid' }).state, 'past_due');
  assert.deepEqual([entitlement({ status: 'incomplete' }).state, entitlement({ status: 'incomplete' }).pro], ['pending', false]);
  assert.deepEqual([entitlement({ status: 'canceled' }).state, entitlement({ status: 'canceled' }).pro], ['canceled', false]);
  assert.equal(entitlement({ status: 'incomplete_expired' }).state, 'expired');
  // Missed renewal webhook: an "active" row past its period (+2 day grace) no longer grants PRO.
  const stale = entitlement({ status: 'active', current_period_end: past });
  assert.deepEqual([stale.state, stale.pro], ['expired', false]);
});

test('Stripe form encoding uses bracketed nested keys', () => {
  const f = formEncode({ mode: 'subscription', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 750, recurring: { interval: 'month' } } }], skip: undefined });
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '750');
  assert.equal(f.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(f.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(f.has('skip'), false);
});

test('webhook signature: valid, tampered, wrong secret and stale are handled', async () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
  const t = Math.floor(now / 1000);
  const sig = await signPayload(SECRET, t, payload);
  assert.equal((await verifyStripeSignature(payload, `t=${t},v1=${sig}`, SECRET, { now })).id, 'evt_1');
  await assert.rejects(verifyStripeSignature(payload.replace('paid', 'free'), `t=${t},v1=${sig}`, SECRET, { now }), /Invalid Stripe signature/);
  await assert.rejects(verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_other', { now }), /Invalid Stripe signature/);
  await assert.rejects(verifyStripeSignature(payload, `t=${t - 600},v1=${await signPayload(SECRET, t - 600, payload)}`, SECRET, { now }), /Stale/);
  await assert.rejects(verifyStripeSignature(payload, '', SECRET, { now }), /Missing/);
});

// In-memory D1 + Stripe fakes to exercise the webhook flow end to end.
function fakeDb() {
  const t = { users: [{ id: 'u1', stripe_customer_id: 'cus_1', email: 'a@b.c' }], subscriptions: [], stripe_events: [] };
  const run = (sql, a) => {
    if (/^INSERT INTO stripe_events/.test(sql)) { if (t.stripe_events.some((e) => e.id === a[0])) return { meta: { changes: 0 } }; t.stripe_events.push({ id: a[0] }); return { meta: { changes: 1 } }; }
    if (/^DELETE FROM stripe_events/.test(sql)) { t.stripe_events = t.stripe_events.filter((e) => e.id !== a[0]); return { meta: { changes: 1 } }; }
    if (/^INSERT INTO subscriptions/.test(sql)) {
      const row = { user_id: a[0], stripe_subscription_id: a[1], stripe_customer_id: a[2], status: a[3], price_id: a[4], current_period_end: a[5], cancel_at_period_end: a[6], last_invoice_status: a[7] };
      const i = t.subscriptions.findIndex((s) => s.user_id === a[0]);
      if (i >= 0) t.subscriptions[i] = { ...row, last_invoice_status: row.last_invoice_status ?? t.subscriptions[i].last_invoice_status }; else t.subscriptions.push(row);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  };
  return { t, prepare: (sql) => ({ bind: (...a) => ({
    run: async () => run(sql, a),
    first: async () => (/FROM subscriptions WHERE user_id/.test(sql) ? t.subscriptions.find((s) => s.user_id === a[0]) || null
      : /FROM users WHERE stripe_customer_id/.test(sql) ? t.users.find((u) => u.stripe_customer_id === a[0]) || null : null),
  }) }) };
}
let stripeSub = null;
const realFetch = globalThis.fetch;
function mockStripe() {
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.stripe.com/v1/subscriptions/')) return new Response(JSON.stringify(stripeSub), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  };
}
async function deliver(env, event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return handleWebhook(env, new Request('https://x/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${await signPayload(SECRET, t, body)}` } }));
}
const sub = (status, extra = {}) => ({ id: 'sub_1', customer: 'cus_1', status, metadata: { user_id: 'u1' }, cancel_at_period_end: false,
  items: { data: [{ current_period_end: Math.floor(Date.parse(future) / 1000), price: { id: 'price_1' } }] }, ...extra });

test('webhooks: payment, renewal, failed payment, cancellation, duplicates and bad signatures', async () => {
  mockStripe();
  try {
    const db = fakeDb();
    const env = { DB: db, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET };
    stripeSub = sub('active');
    await deliver(env, { id: 'evt_a', type: 'checkout.session.completed', data: { object: { subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'u1' } } });
    assert.equal(entitlement(db.t.subscriptions[0]).state, 'active');
    // Duplicate delivery is ignored.
    assert.equal((await deliver(env, { id: 'evt_a', type: 'checkout.session.completed', data: { object: { subscription: 'sub_1' } } })).duplicate, true);
    // Renewal paid (new API shape: subscription under invoice.parent).
    await deliver(env, { id: 'evt_b', type: 'invoice.paid', data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } } });
    assert.equal(db.t.subscriptions[0].last_invoice_status, 'paid');
    // Failed renewal → past_due, PRO removed.
    stripeSub = sub('past_due');
    await deliver(env, { id: 'evt_c', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } } });
    assert.deepEqual([entitlement(db.t.subscriptions[0]).state, entitlement(db.t.subscriptions[0]).pro], ['past_due', false]);
    // Card fixed, then cancellation scheduled, then subscription ended.
    stripeSub = sub('active', { cancel_at_period_end: true });
    await deliver(env, { id: 'evt_d', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    assert.equal(entitlement(db.t.subscriptions[0]).state, 'canceling');
    stripeSub = sub('canceled');
    await deliver(env, { id: 'evt_e', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
    assert.deepEqual([entitlement(db.t.subscriptions[0]).state, entitlement(db.t.subscriptions[0]).pro], ['canceled', false]);
    // Forged event is rejected before touching the database.
    const body = JSON.stringify({ id: 'evt_f', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    await assert.rejects(handleWebhook(env, new Request('https://x', { method: 'POST', body, headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` } })), /Invalid Stripe signature/);
    assert.ok(!db.t.stripe_events.some((e) => e.id === 'evt_f'));
  } finally { globalThis.fetch = realFetch; }
});

test('checkout refuses to run without payment configuration (no fake checkout)', async () => {
  await assert.rejects(createCheckout({}, { id: 'u1' }, 'https://x'), /not configured/);
});

// ---------- Google sign-in token verification ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
async function makeToken(claims, { kid = 'k1', keyPair } = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}
test('Google ID tokens are verified (signature, issuer, audience, expiry, email)', async () => {
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' };
  const good = { iss: 'https://accounts.google.com', aud: 'client-1', sub: '123', email: 'a@b.c', email_verified: true, exp: Math.floor(now / 1000) + 600 };
  const opts = { clientId: 'client-1', keys: [jwk], now };
  assert.equal((await verifyGoogleIdToken(await makeToken(good, { keyPair }), opts)).sub, '123');
  await assert.rejects(verifyGoogleIdToken(await makeToken({ ...good, aud: 'other' }, { keyPair }), opts), /another application/);
  await assert.rejects(verifyGoogleIdToken(await makeToken({ ...good, iss: 'evil.com' }, { keyPair }), opts), /issuer/);
  await assert.rejects(verifyGoogleIdToken(await makeToken({ ...good, exp: Math.floor(now / 1000) - 3600 }, { keyPair }), opts), /expired/);
  await assert.rejects(verifyGoogleIdToken(await makeToken({ ...good, email_verified: false }, { keyPair }), opts), /not verified/);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  await assert.rejects(verifyGoogleIdToken(await makeToken(good, { keyPair: other }), opts), /signature/);
  await assert.rejects(verifyGoogleIdToken('a.b', opts), /Malformed/);
  await assert.rejects(verifyGoogleIdToken('x.y.z', { ...opts, clientId: '' }), /not configured/);
});

test('session cookie is HttpOnly/Secure/SameSite and cross-site POSTs are refused', () => {
  const c = sessionCookie('tok');
  assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/);
  assert.equal(readCookie(new Request('https://x', { headers: { cookie: 'a=1; void_session=abc' } }), 'void_session'), 'abc');
  assert.equal(sameOrigin(new Request('https://void.example/api/pro/checkout', { method: 'POST', headers: { origin: 'https://evil.example' } })), false);
  assert.equal(sameOrigin(new Request('https://void.example/api/pro/checkout', { method: 'POST', headers: { origin: 'https://void.example' } })), true);
});

test('primary navigation: ten items, active item follows the URL', () => {
  assert.equal(NAV_ITEMS.length, 10);
  assert.deepEqual(NAV_ITEMS.map((i) => i.en), ['AI', 'Web3', 'Crypto', 'Stocks', 'Finance', 'Macro', 'Prediction Markets', 'Technology', 'Markets', 'Newsletter']);
  assert.equal(activeNavIndex('/section/ai'), 0);
  assert.equal(activeNavIndex('/section/ai/'), 0);
  assert.equal(activeNavIndex('/macro/DGS10'), 5);
  assert.equal(activeNavIndex('/prediction-markets'), 6);
  assert.equal(activeNavIndex('/terminal'), 8);
  assert.equal(activeNavIndex('/section/fx'), 8);
  assert.equal(activeNavIndex('/'), -1);
  assert.equal(activeNavIndex('/news/abc/slug'), -1);
});

test('Polymarket events map to market prices (no invented values)', () => {
  const e = mapEvent({ id: 1, title: 'Fed decision?', slug: 'fed', volume24hr: 1000, markets: [
    { active: true, closed: false, groupItemTitle: 'No change', outcomes: '["Yes","No"]', outcomePrices: '["0.9","0.1"]' },
    { active: true, closed: true, groupItemTitle: 'Closed', outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]' },
    { active: true, closed: false, groupItemTitle: 'Broken', outcomes: '["Yes","No"]', outcomePrices: '[]' },
  ] }, 'economy');
  assert.equal(e.url, 'https://polymarket.com/event/fed');
  assert.equal(e.markets.length, 1);
  assert.equal(e.markets[0].price, 0.9);
});

test('new topics are classified for the new sections', () => {
  assert.ok(classify({ title: 'OpenAI ships new agents', excerpt: '' }).categories.includes('ai'));
  assert.ok(classify({ title: 'Polymarket volume hits record', excerpt: '' }).categories.includes('prediction-markets'));
  assert.ok(classify({ title: 'Nvidia shares rally on earnings', excerpt: '' }).categories.includes('stocks'));
  assert.ok(classify({ title: 'New rollup launches on Ethereum', excerpt: '' }).categories.includes('web3'));
  assert.ok(classify({ title: 'Untitled', excerpt: '', topics: ['technology'] }).categories.includes('technology'));
});
