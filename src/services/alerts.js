// Persistent whale alerts (D1 + Cron). The browser holds a random secret key; the server
// stores only SHA-256(key) as the owner id. Alerts are evaluated by the scheduled scanner,
// so they keep firing while every tab is closed. Duplicate alerts are impossible:
// alert_events has UNIQUE(rule_id, wallet_event_id) and wallet_events ids are deterministic.

import { log } from '../lib/core.js';
import { EVM_CHAINS } from '../adapters/chains.js';
import { walletActivity } from './lab.js';
import { RULE_TYPES, evaluateRule, eventId, isEvmAddress, isSolanaAddress } from '../../public/js/shared/whales.js';

const LIMITS = { wallets: 25, rules: 100 };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const now = () => new Date().toISOString();

function needDb(env) { if (!env.DB) throw bad('Alerts need the D1 binding "DB" (see README).', 503); }

export async function ownerFrom(env, request) {
  needDb(env);
  const key = request.headers.get('x-void-key') || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw bad('Missing or invalid x-void-key header', 401);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const id = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO owners (id, created_at, last_seen) VALUES (?1, ?2, ?2) ON CONFLICT(id) DO UPDATE SET last_seen = ?2').bind(id, now()).run();
  return id;
}

function validChainAddress(chain, address) {
  if (chain === 'solana') { if (!isSolanaAddress(address)) throw bad('Invalid Solana address'); return address; }
  if (!EVM_CHAINS[chain]) throw bad('Unsupported chain');
  if (!isEvmAddress(address)) throw bad('Invalid EVM address');
  return address.toLowerCase();
}

export async function state(env, owner) {
  const [w, r, unread, o] = await Promise.all([
    env.DB.prepare(`SELECT w.*, c.last_checked_at, c.last_error FROM watched_wallets w LEFT JOIN wallet_cursors c ON c.chain = w.chain AND c.address = w.address WHERE w.owner_id = ? ORDER BY w.created_at DESC`).bind(owner).all(),
    env.DB.prepare('SELECT * FROM alert_rules WHERE owner_id = ? ORDER BY created_at DESC').bind(owner).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM alert_events WHERE owner_id = ? AND read = 0').bind(owner).first(),
    env.DB.prepare('SELECT telegram_chat_id FROM owners WHERE id = ?').bind(owner).first(),
  ]);
  return { wallets: w.results, rules: r.results, unread: unread?.n || 0, settings: { telegramChatId: o?.telegram_chat_id || null, telegramAvailable: !!env.TELEGRAM_BOT_TOKEN }, limits: LIMITS };
}

export async function watch(env, owner, { chain, address, label }) {
  const addr = validChainAddress(chain, String(address || '').trim());
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM watched_wallets WHERE owner_id = ?').bind(owner).first();
  if (n.n >= LIMITS.wallets) throw bad(`Limit of ${LIMITS.wallets} watched wallets reached`, 429);
  await env.DB.prepare('INSERT INTO watched_wallets (owner_id, chain, address, label, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(owner_id, chain, address) DO UPDATE SET label = excluded.label, enabled = 1')
    .bind(owner, chain, addr, String(label || '').slice(0, 60) || null, now()).run();
  return env.DB.prepare('SELECT * FROM watched_wallets WHERE owner_id = ? AND chain = ? AND address = ?').bind(owner, chain, addr).first();
}

export async function setWalletEnabled(env, owner, id, enabled) {
  const r = await env.DB.prepare('UPDATE watched_wallets SET enabled = ? WHERE id = ? AND owner_id = ?').bind(enabled ? 1 : 0, Number(id), owner).run();
  if (!r.meta.changes) throw bad('Wallet not found', 404);
  return { ok: true };
}

export async function unwatch(env, owner, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM alert_rules WHERE wallet_id = ? AND owner_id = ?').bind(Number(id), owner),
    env.DB.prepare('DELETE FROM watched_wallets WHERE id = ? AND owner_id = ?').bind(Number(id), owner),
  ]);
  return { ok: true };
}

export function validateRule(b) {
  if (!RULE_TYPES.includes(b.type)) throw bad(`type must be one of ${RULE_TYPES.join(', ')}`);
  const pos = (v, name) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw bad(`${name} must be a positive number`); return n; };
  const r = {
    type: b.type, token: b.token ? String(b.token).trim().slice(0, 64) : null,
    min_amount: pos(b.min_amount, 'min_amount'), min_usd: pos(b.min_usd, 'min_usd'), pct: pos(b.pct, 'pct'),
    counterparty: b.counterparty ? String(b.counterparty).trim().slice(0, 64) : null,
    window_min: pos(b.window_min, 'window_min'), min_count: pos(b.min_count, 'min_count'),
    channel: b.channel === 'telegram' ? 'telegram' : 'inapp', cooldown_min: pos(b.cooldown_min, 'cooldown_min') ?? 0,
    enabled: b.enabled === false || b.enabled === 0 ? 0 : 1,
  };
  if (r.type === 'large_move' && r.min_amount == null && r.min_usd == null) throw bad('large_move needs min_amount or min_usd');
  if (r.type === 'balance_pct' && r.pct == null) throw bad('balance_pct needs pct');
  if (r.type === 'counterparty' && !r.counterparty) throw bad('counterparty rule needs an address');
  if (r.type === 'repeated') { r.window_min ??= 60; r.min_count ??= 3; }
  return r;
}

export async function saveRule(env, owner, body) {
  const r = validateRule(body);
  const w = await env.DB.prepare('SELECT id FROM watched_wallets WHERE id = ? AND owner_id = ?').bind(Number(body.wallet_id), owner).first();
  if (!w) throw bad('wallet_id not found in your watchlist', 404);
  const ts = now();
  if (body.id) {
    const res = await env.DB.prepare(`UPDATE alert_rules SET type=?, token=?, min_amount=?, min_usd=?, pct=?, counterparty=?, window_min=?, min_count=?, channel=?, cooldown_min=?, enabled=?, updated_at=? WHERE id=? AND owner_id=?`)
      .bind(r.type, r.token, r.min_amount, r.min_usd, r.pct, r.counterparty, r.window_min, r.min_count, r.channel, r.cooldown_min, r.enabled, ts, Number(body.id), owner).run();
    if (!res.meta.changes) throw bad('Rule not found', 404);
    return { id: Number(body.id) };
  }
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM alert_rules WHERE owner_id = ?').bind(owner).first();
  if (n.n >= LIMITS.rules) throw bad(`Limit of ${LIMITS.rules} rules reached`, 429);
  const res = await env.DB.prepare(`INSERT INTO alert_rules (owner_id, wallet_id, type, token, min_amount, min_usd, pct, counterparty, window_min, min_count, channel, cooldown_min, enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(owner, w.id, r.type, r.token, r.min_amount, r.min_usd, r.pct, r.counterparty, r.window_min, r.min_count, r.channel, r.cooldown_min, r.enabled, ts, ts).run();
  return { id: res.meta.last_row_id };
}

export async function deleteRule(env, owner, id) {
  await env.DB.prepare('DELETE FROM alert_rules WHERE id = ? AND owner_id = ?').bind(Number(id), owner).run();
  return { ok: true };
}

export async function events(env, owner, { since, limit = 50 } = {}) {
  const q = since
    ? env.DB.prepare(`SELECT a.*, e.chain, e.address, e.tx_hash, e.ts, e.kind, e.token, e.token_symbol, e.amount, e.amount_usd, e.explorer_url, e.status, e.counterparty_label, w.label AS wallet_label
        FROM alert_events a JOIN wallet_events e ON e.id = a.wallet_event_id LEFT JOIN alert_rules r ON r.id = a.rule_id LEFT JOIN watched_wallets w ON w.id = r.wallet_id
        WHERE a.owner_id = ? AND a.id > ? ORDER BY a.id DESC LIMIT ?`).bind(owner, Number(since), Math.min(100, limit))
    : env.DB.prepare(`SELECT a.*, e.chain, e.address, e.tx_hash, e.ts, e.kind, e.token, e.token_symbol, e.amount, e.amount_usd, e.explorer_url, e.status, e.counterparty_label, w.label AS wallet_label
        FROM alert_events a JOIN wallet_events e ON e.id = a.wallet_event_id LEFT JOIN alert_rules r ON r.id = a.rule_id LEFT JOIN watched_wallets w ON w.id = r.wallet_id
        WHERE a.owner_id = ? ORDER BY a.id DESC LIMIT ?`).bind(owner, Math.min(100, limit));
  const { results } = await q.all();
  return { events: results.map((r) => ({ ...r, summary: safeJson(r.summary) })) };
}

export async function feed(env, owner, { limit = 60 } = {}) {
  const { results } = await env.DB.prepare(`SELECT e.*, w.label AS wallet_label FROM wallet_events e JOIN watched_wallets w ON w.chain = e.chain AND w.address = e.address
    WHERE w.owner_id = ? ORDER BY e.ts DESC LIMIT ?`).bind(owner, Math.min(200, limit)).all();
  return { events: results };
}

export async function markRead(env, owner, ids) {
  if (ids === 'all') await env.DB.prepare('UPDATE alert_events SET read = 1 WHERE owner_id = ?').bind(owner).run();
  else for (const id of (ids || []).slice(0, 100)) await env.DB.prepare('UPDATE alert_events SET read = 1 WHERE owner_id = ? AND id = ?').bind(owner, Number(id)).run();
  return { ok: true };
}

export async function saveSettings(env, owner, { telegram_chat_id }) {
  const v = telegram_chat_id ? String(telegram_chat_id).trim() : null;
  if (v && !/^-?\d{4,20}$/.test(v)) throw bad('telegram_chat_id must be numeric');
  await env.DB.prepare('UPDATE owners SET telegram_chat_id = ? WHERE id = ?').bind(v, owner).run();
  return { ok: true };
}

const safeJson = (s) => { try { return JSON.parse(s); } catch { return { en: s, es: s }; } };

// ----------------------------------------------------------------------------------
// Scheduled scanner. Bounded per run (wallet count and per-wallet transactions) so it
// stays inside Worker limits; least-recently-checked wallets go first.
export async function scan(env, { maxWallets = 6, onlyOwner = null } = {}) {
  needDb(env);
  const q = onlyOwner
    ? env.DB.prepare(`SELECT DISTINCT w.chain, w.address FROM watched_wallets w WHERE w.enabled = 1 AND w.owner_id = ? LIMIT ?`).bind(onlyOwner, maxWallets)
    : env.DB.prepare(`SELECT w.chain, w.address, MIN(c.last_checked_at) AS lc FROM watched_wallets w LEFT JOIN wallet_cursors c ON c.chain = w.chain AND c.address = w.address
        WHERE w.enabled = 1 GROUP BY w.chain, w.address ORDER BY lc IS NOT NULL, lc ASC LIMIT ?`).bind(maxWallets);
  const { results: targets } = await q.all();
  const report = [];
  for (const t of targets) {
    try { report.push({ ...t, ...(await scanWallet(env, t.chain, t.address)) }); }
    catch (e) {
      report.push({ ...t, error: e.message });
      await env.DB.prepare(`INSERT INTO wallet_cursors (chain, address, last_checked_at, last_error) VALUES (?,?,?,?)
        ON CONFLICT(chain, address) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_error = excluded.last_error`).bind(t.chain, t.address, now(), e.message.slice(0, 300)).run();
    }
  }
  return { scanned: report.length, report };
}

async function scanWallet(env, chain, address) {
  const act = await walletActivity(env, chain, address, { limit: 15 });
  const evs = act.events.filter((e) => e.tx_hash && e.ts);
  let inserted = 0;
  const fresh = [];
  for (const e of evs) {
    const id = eventId(e);
    const res = await env.DB.prepare(`INSERT OR IGNORE INTO wallet_events (id, chain, address, tx_hash, ts, kind, token, token_symbol, amount, amount_usd, balance_after, counterparty, counterparty_label, status, method, explorer_url, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, chain, address, e.tx_hash, e.ts, e.kind, e.token, e.token_symbol || null, e.amount, e.amount_usd ?? null, e.balance_after ?? null,
      e.counterparty || null, e.counterparty_label || null, e.status, e.method || null, e.explorer_url || null, now()).run();
    if (res.meta.changes) { inserted++; fresh.push({ ...e, id }); }
  }
  await env.DB.prepare(`INSERT INTO wallet_cursors (chain, address, last_ref, last_ts, last_checked_at, last_error) VALUES (?,?,?,?,?,NULL)
    ON CONFLICT(chain, address) DO UPDATE SET last_ref = excluded.last_ref, last_ts = excluded.last_ts, last_checked_at = excluded.last_checked_at, last_error = NULL`)
    .bind(chain, address, evs[0]?.tx_hash || null, evs[0]?.ts || null, now()).run();
  const fired = fresh.length ? await fireRules(env, chain, address, fresh) : 0;
  return { inserted, fired };
}

async function fireRules(env, chain, address, fresh) {
  const { results: rules } = await env.DB.prepare(`SELECT r.*, o.telegram_chat_id FROM alert_rules r JOIN watched_wallets w ON w.id = r.wallet_id JOIN owners o ON o.id = r.owner_id
    WHERE w.chain = ? AND w.address = ? AND w.enabled = 1 AND r.enabled = 1`).bind(chain, address).all();
  let fired = 0;
  for (const rule of rules) {
    for (const ev of fresh) {
      // Only events that happened after the rule existed: never alert on history.
      if (Date.parse(ev.ts) < Date.parse(rule.created_at) - 60000) continue;
      if (ev.status !== 'confirmed') continue;
      if (rule.cooldown_min && rule.last_fired_at && Date.now() - Date.parse(rule.last_fired_at) < rule.cooldown_min * 60000) continue;
      let recent = [];
      if (rule.type === 'repeated') {
        const since = new Date(Date.parse(ev.ts) - (rule.window_min || 60) * 60000).toISOString();
        recent = (await env.DB.prepare('SELECT * FROM wallet_events WHERE chain = ? AND address = ? AND ts >= ? AND ts <= ? AND status = ?').bind(chain, address, since, ev.ts, 'confirmed').all()).results;
      }
      const res = evaluateRule(rule, ev, recent);
      if (!res.match) continue;
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO alert_events (owner_id, rule_id, wallet_event_id, fired_at, summary) VALUES (?,?,?,?,?)')
        .bind(rule.owner_id, rule.id, ev.id, now(), JSON.stringify(res.summary)).run();
      if (!ins.meta.changes) continue; // duplicate
      fired++;
      await env.DB.prepare('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?').bind(now(), rule.id).run();
      if (rule.channel === 'telegram' && rule.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
        const ok = await telegram(env, rule.telegram_chat_id, `🐋 VOID · ${chain} ${address.slice(0, 6)}…${address.slice(-4)}\n${res.summary.es}\n${ev.explorer_url || ''}`);
        await env.DB.prepare('UPDATE alert_events SET delivered = ? WHERE rule_id = ? AND wallet_event_id = ?').bind(ok ? 'inapp,telegram' : 'inapp,telegram_failed', rule.id, ev.id).run();
      }
    }
  }
  return fired;
}

async function telegram(env, chatId, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (e) { log('warn', 'telegram_failed', { error: e.message }); return false; }
}

