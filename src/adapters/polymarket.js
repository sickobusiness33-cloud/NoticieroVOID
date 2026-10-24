// Prediction markets: Polymarket public Gamma API (keyless). We show each outcome's current
// market price as published by Polymarket — a traded price, not a VOID forecast or a
// calibrated probability. Only finance-relevant tags are requested (no sports/esports).

import { upstream, cached } from '../lib/core.js';

export const PM_TAGS = ['economy', 'fed', 'crypto', 'stocks', 'finance', 'ai', 'tech'];
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const parseList = (s) => { try { return Array.isArray(s) ? s : JSON.parse(s || '[]'); } catch { return []; } };

// Normalises one Gamma event: open markets only, each with its "Yes" price (0–1) when binary.
export function mapEvent(e, tag) {
  const markets = (e.markets || []).filter((m) => m.active && !m.closed).map((m) => {
    const outcomes = parseList(m.outcomes), prices = parseList(m.outcomePrices).map(Number);
    const yes = outcomes.findIndex((o) => /^yes$/i.test(o));
    return {
      label: m.groupItemTitle || m.question,
      question: m.question,
      price: yes >= 0 && Number.isFinite(prices[yes]) ? prices[yes] : null,
      outcomes: yes >= 0 ? null : outcomes.map((o, i) => ({ name: o, price: Number.isFinite(prices[i]) ? prices[i] : null })),
      volume24h: num(m.volume24hr),
    };
  }).filter((m) => m.price !== null || m.outcomes?.length)
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  return {
    id: String(e.id), title: e.title, tag, url: `https://polymarket.com/event/${e.slug}`,
    endDate: e.endDate || null, volume24h: num(e.volume24hr), volume: num(e.volume), updatedAt: e.updatedAt || null,
    markets: markets.slice(0, 5), marketCount: markets.length,
  };
}

export async function predictionMarkets(env) {
  return cached(env, 'polymarket:events:v1', 120, async () => {
    const lists = await Promise.allSettled(PM_TAGS.map((tag) => upstream('polymarket', `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=${tag}&order=volume24hr&ascending=false&limit=10`, { timeoutMs: 10000 })
      .then((events) => events.map((e) => mapEvent(e, tag)))));
    const seen = new Set();
    const events = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .filter((e) => e.markets.length && !seen.has(e.id) && seen.add(e.id))
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    if (!events.length) throw Object.assign(new Error('Polymarket API unavailable'), { status: 502, provider: 'polymarket' });
    return { events, tagsOk: lists.filter((r) => r.status === 'fulfilled').length, tagsTotal: PM_TAGS.length };
  });
}
