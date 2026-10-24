// Accounts: "Sign in with Google" (Google Identity Services). The browser obtains a Google ID
// token; the Worker verifies it (RS256 signature against Google's published keys, issuer,
// audience = GOOGLE_CLIENT_ID, expiry, verified email) and opens a session. The session token
// lives only in an HttpOnly cookie; D1 stores its SHA-256 hash. No passwords are handled.

import { cached, upstream } from '../lib/core.js';

export const SESSION_COOKIE = 'void_session';
const SESSION_DAYS = 30;
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const bytesToB64url = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export async function googleKeys(env) {
  const r = await cached(env, 'google:jwks', 3600, () => upstream('google-jwks', 'https://www.googleapis.com/oauth2/v3/certs', { timeoutMs: 8000 }));
  return r.value.keys;
}

// Verifies a Google ID token. `keys` is the JWKS key list (injected in tests).
export async function verifyGoogleIdToken(token, { clientId, keys, now = Date.now() }) {
  if (!clientId) throw fail(503, 'auth_not_configured', 'Google sign-in is not configured (GOOGLE_CLIENT_ID).');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw fail(401, 'bad_token', 'Malformed sign-in token');
  let header, payload;
  try { header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))); }
  catch { throw fail(401, 'bad_token', 'Malformed sign-in token'); }
  if (header.alg !== 'RS256') throw fail(401, 'bad_token', 'Unexpected token algorithm');
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw fail(401, 'bad_token', 'Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw fail(401, 'bad_token', 'Invalid token signature');
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw fail(401, 'bad_token', 'Invalid token issuer');
  if (payload.aud !== clientId) throw fail(401, 'bad_token', 'Token was issued for another application');
  if (!payload.exp || payload.exp * 1000 < now - 60_000) throw fail(401, 'bad_token', 'Sign-in token expired');
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw fail(401, 'bad_token', 'Google account email is not verified');
  return { sub: payload.sub, email: payload.email, name: payload.name || null, picture: payload.picture || null };
}

export function readCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function sessionCookie(token, { secure = true, maxAgeSec = SESSION_DAYS * 86400 } = {}) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Cookie-authenticated POSTs must come from our own pages (SameSite=Lax + Origin check).
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function signIn(env, request, credential) {
  if (!env.DB) throw fail(503, 'db_not_configured', 'Accounts require the D1 binding "DB".');
  const g = await verifyGoogleIdToken(credential, { clientId: env.GOOGLE_CLIENT_ID, keys: await googleKeys(env) });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO users (id, google_sub, email, name, picture, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), g.sub, g.email, g.name, g.picture, now).run();
  const user = await env.DB.prepare('SELECT id, email, name, picture FROM users WHERE google_sub = ?').bind(g.sub).first();
  const token = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), user.id, now, expires).run();
  return { user, cookie: sessionCookie(token, { secure: new URL(request.url).protocol === 'https:' }) };
}

// The signed-in user for this request, or null. Never trusts anything but the session cookie.
export async function currentUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !env.DB || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return env.DB.prepare(`SELECT u.id, u.email, u.name, u.picture, u.stripe_customer_id AS stripeCustomerId FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha256Hex(token), new Date().toISOString()).first();
}

export async function signOut(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return sessionCookie('', { secure: new URL(request.url).protocol === 'https:', maxAgeSec: 0 });
}
