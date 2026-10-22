// Shared Worker infrastructure: logging, upstream fetch with timeout/retry,
// layered caching (KV when bound, in-isolate memory otherwise), provider health,
// rate limiting and response helpers.

export const UA = 'NoticieroVOID/1.0 (+https://github.com/sickobusiness33-cloud/noticierovoid)';

export function log(level, msg, data = {}) {
  // Structured JSON logs are searchable in `wrangler tail` and Workers Logs.
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }));
}

export class UpstreamError extends Error {
  constructor(provider, message, status) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.status = status;
  }
}

// ---- provider health -------------------------------------------------------------
const health = new Map();
export function recordHealth(provider, ok, detail = {}) {
  const h = health.get(provider) || { provider, okCount: 0, failCount: 0 };
  if (ok) { h.okCount++; h.lastSuccess = new Date().toISOString(); h.lastLatencyMs = detail.ms; }
  else { h.failCount++; h.lastFailure = new Date().toISOString(); h.lastError = String(detail.error || '').slice(0, 300); }
  h.status = ok ? 'ok' : 'degraded';
  health.set(provider, h);
}
export function healthSnapshot() { return [...health.values()]; }

export async function upstream(provider, url, opts = {}) {
  const { timeoutMs = 10000, retries = 2, init = {}, as = 'json', retryOn = [] } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': UA, accept: as === 'json' ? 'application/json' : '*/*', ...(init.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500 || retryOn.includes(res.status)) throw new UpstreamError(provider, `HTTP ${res.status}`, res.status);
      if (!res.ok) {
        // 4xx (other than 429) is not transient: do not retry.
        const e = new UpstreamError(provider, `HTTP ${res.status}`, res.status);
        e.final = true;
        throw e;
      }
      const body = as === 'json' ? await res.json() : await res.text();
      recordHealth(provider, true, { ms: Date.now() - started });
      return body;
    } catch (err) {
      lastErr = err;
      if (err.final || attempt === retries) break;
      await new Promise((r) => setTimeout(r, (retryOn.length ? 1200 : 300) * 2 ** attempt + Math.random() * 300));
    }
  }
  recordHealth(provider, false, { error: lastErr?.message });
  log('warn', 'upstream_failed', { provider, url: redact(url), error: lastErr?.message });
  throw lastErr instanceof UpstreamError ? lastErr : new UpstreamError(provider, lastErr?.message || 'request failed');
}

function redact(url) { return String(url).replace(/(api_key|apikey|key)=[^&]+/gi, '$1=***'); }

// ---- cache ------------------------------------------------------------------------
const mem = new Map();
const inflight = new Map();

// Returns { value, cachedAt, stale }. On upstream failure we serve the last good value
// marked `stale: true` — real data clearly flagged as old, never a fabricated fallback.
export async function cached(env, key, ttlSec, producer) {
  const now = Date.now();
  let entry = mem.get(key);
  if (!entry && env.CACHE) {
    try { entry = await env.CACHE.get(key, 'json'); if (entry) mem.set(key, entry); } catch (e) { log('warn', 'kv_read_failed', { key, error: e.message }); }
  }
  if (entry && now - entry.cachedAt < ttlSec * 1000) return { ...entry, stale: false };
  // Coalesce concurrent refreshes of the same key.
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const value = await producer();
      const fresh = { value, cachedAt: Date.now() };
      mem.set(key, fresh);
      if (env.CACHE) {
        // KV entries live longer than the TTL so they can serve as stale fallback.
        try { await env.CACHE.put(key, JSON.stringify(fresh), { expirationTtl: Math.max(60, ttlSec * 24) }); } catch (e) { log('warn', 'kv_write_failed', { key, error: e.message }); }
      }
      return fresh;
    })().finally(() => inflight.delete(key)));
  }
  try {
    const fresh = await inflight.get(key);
    return { ...fresh, stale: false };
  } catch (err) {
    if (entry) return { ...entry, stale: true, error: err.message };
    throw err;
  }
}

// ---- rate limiting (per isolate, sliding window) ----------------------------------
// For hard global limits bind the Cloudflare Rate Limiting API (see README).
const buckets = new Map();
export async function rateLimit(env, request, name, limit, windowSec) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = `${name}:${ip}`;
  if (env.RATE_LIMITER && name === 'ai') {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return success;
  }
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowSec * 1000);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

// ---- responses ----------------------------------------------------------------------
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS, ...extra },
  });
}

export function apiError(status, code, message, extra = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

// Standard metadata envelope attached to every data payload.
export function meta({ source, sourceUrl, status, frequency, unit, cachedAt, stale, note }) {
  return {
    source, sourceUrl, frequency, unit, note,
    // status ∈ live | delayed | historical | estimated | unavailable
    status: stale ? 'stale' : status,
    lastUpdated: cachedAt ? new Date(cachedAt).toISOString() : null,
    stale: !!stale,
  };
}

export function isoDate(d) { return new Date(d).toISOString().slice(0, 10); }
