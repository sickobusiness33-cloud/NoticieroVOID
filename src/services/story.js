// VOID Report: an original story written by Workers AI (binding AI, free daily allocation)
// from the facts that publishers put in their feeds (headline + short excerpt), plus other
// outlets' headlines on the same story. It never fetches or reproduces article bodies.
// Guards reject paragraphs that copy source wording, quote text the sources don't contain,
// or state numbers the sources don't contain (no invented data). Stories are generated once
// per article and language and stored in D1; a daily cap keeps usage inside the free tier.

import { log } from '../lib/core.js';

export const STORY_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
// ~90 neurons per story with this model → 60/day stays well under the 10,000 free neurons.
export const DAILY_CAP = 60;

const STOP = new Set('the a an of to in on for and or by with from at as is are was were be has have had its it this that after amid over into than more new says said de la el los las del en y o por con para un una que se su sus al lo como más tras ante sobre es son fue han ha'.split(' '));

const words = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+(?:[.,][0-9]+)*/g) || [];
const keyWords = (s) => new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)));

// Other items in the feed that cover the same story (shared significant headline words).
export function sameStory(item, items, max = 5) {
  const k = keyWords(item.title);
  return items
    .filter((o) => o.id !== item.id)
    .map((o) => ({ o, n: [...keyWords(o.title)].filter((w) => k.has(w)).length }))
    .filter((x) => x.n >= 3)
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((x) => x.o);
}

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));

// Returns the paragraphs that pass every guard, and the reasons others were dropped.
export function guardParagraphs(paragraphs, sources, publishedAt, minLen = 40) {
  const srcText = sources.join(' \n ');
  const srcLower = srcText.toLowerCase();
  const allowedNums = new Set(numbersIn(srcText).concat(numbersIn(publishedAt || '')));
  const srcWords = words(srcText);
  const shingles = new Set();
  for (let i = 0; i + 8 <= srcWords.length; i++) shingles.add(srcWords.slice(i, i + 8).join(' '));
  const kept = [], dropped = [];
  for (const raw of paragraphs) {
    const p = String(raw || '').trim();
    if (p.length < minLen) { if (p) dropped.push({ p, why: 'too_short' }); continue; }
    const badNum = numbersIn(p).find((n) => !allowedNums.has(n));
    if (badNum) { dropped.push({ p, why: `number_not_in_sources:${badNum}` }); continue; }
    const quotes = p.match(/[“«"]([^”»"]{6,})[”»"]/g) || [];
    if (quotes.some((q) => !srcLower.includes(q.slice(1, -1).toLowerCase().trim()))) { dropped.push({ p, why: 'unsourced_quote' }); continue; }
    const w = words(p);
    let copied = false;
    for (let i = 0; i + 8 <= w.length && !copied; i++) copied = shingles.has(w.slice(i, i + 8).join(' '));
    if (copied) { dropped.push({ p, why: 'copies_source_wording' }); continue; }
    kept.push(p);
  }
  return { kept, dropped };
}

function prompt(item, others, lang) {
  const language = lang === 'es' ? 'Spanish (neutral, for Spain and Latin America)' : 'English';
  const facts = [
    `[S1] ${item.source}, ${item.publishedAt || 'date n/a'}. Headline: ${item.title}. Excerpt: ${item.excerpt || '(none)'}`,
    ...others.map((o, i) => `[S${i + 2}] ${o.source}, ${o.publishedAt || 'date n/a'}. Headline: ${o.title}. Excerpt: ${o.excerpt || '(none)'}`),
  ].join('\n');
  const system = `You are the senior editor of Noticiero VOID, a financial news site. You write sharp, clear, well-structured news stories in your own words.
Rules you must never break:
- Use ONLY facts stated in the SOURCES. Do not add names, numbers, dates, quotes, causes or events that are not in them. No outside knowledge.
- Write everything in your own words: never copy phrases from the sources. No direct quotes.
- If a fact appears in only one source, attribute it ("according to <source>").
- Where the sources leave something open, say plainly that it has not been reported yet; never fill gaps by guessing.
- No investment advice, no price predictions, no probabilities.
Return ONLY JSON: {"headline": string, "paragraphs": [string, ...]} with 3 to 5 paragraphs. Paragraph 1 is a strong lead (who, what, when). Then the key details, how other outlets covered it (if there are several sources), and finally what is still unknown or what readers should watch for, without inventing anything.`;
  const user = `Write the story in ${language}.\nSOURCES:\n${facts}`;
  return { system, user };
}

function parse(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('model did not return JSON');
  const j = JSON.parse(t.slice(a, b + 1));
  if (typeof j.headline !== 'string' || !Array.isArray(j.paragraphs)) throw new Error('unexpected JSON shape');
  return j;
}

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function stored(env, id, lang) {
  return env.DB.prepare('SELECT headline, paragraphs, sources, model, status, created_at AS createdAt FROM stories WHERE id = ? AND lang = ?').bind(id, lang).first();
}

const shape = (row) => ({ status: row.status, headline: row.headline, paragraphs: row.paragraphs ? JSON.parse(row.paragraphs) : [], sources: row.sources ? JSON.parse(row.sources) : [], model: row.model, generatedAt: row.createdAt });

const inflight = new Map();

export async function story(env, item, allItems, lang) {
  if (item.official) throw fail(409, 'official', 'Official releases are shown in full; no AI story is needed.');
  if (!env.DB) throw fail(503, 'db_not_configured', 'D1 binding "DB" is required to store stories.');
  const row = await stored(env, item.id, lang);
  if (row) return shape(row);
  if (!env.AI) throw fail(503, 'ai_not_configured', 'Workers AI binding "AI" is not configured.');
  const key = `${item.id}:${lang}`;
  if (!inflight.has(key)) inflight.set(key, generate(env, item, allItems, lang).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function generate(env, item, allItems, lang) {
  const today = new Date().toISOString().slice(0, 10);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM stories WHERE created_at >= ?').bind(today).first();
  if (n >= DAILY_CAP) throw fail(429, 'daily_quota', 'The free daily AI quota is used up; new stories resume after 00:00 UTC.');

  const others = sameStory(item, allItems);
  const { system, user } = prompt(item, others, lang);
  let out;
  try {
    const res = await env.AI.run(STORY_MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 900, temperature: 0.4 });
    out = parse(typeof res?.response === 'string' ? res.response : JSON.stringify(res?.response));
  } catch (e) {
    log('warn', 'story_failed', { id: item.id, error: e.message });
    if (/3036|daily free allocation/i.test(e.message)) throw fail(429, 'daily_quota', 'The free daily AI quota is used up; new stories resume after 00:00 UTC.');
    throw fail(502, 'ai_failed', 'The AI writer could not produce a story right now; try again later.');
  }
  const srcTexts = [item.title, item.excerpt, ...others.flatMap((o) => [o.title, o.excerpt])].filter(Boolean);
  const { kept, dropped } = guardParagraphs(out.paragraphs, srcTexts, item.publishedAt);
  const headlineOk = guardParagraphs([out.headline], srcTexts, item.publishedAt, 10).kept.length === 1;
  if (dropped.length) log('info', 'story_guard', { id: item.id, dropped: dropped.map((d) => d.why) });
  const status = kept.length >= 2 ? 'ok' : 'rejected';
  const sources = [{ source: item.source, url: item.url }, ...others.map((o) => ({ source: o.source, url: o.url }))];
  await env.DB.prepare(`INSERT INTO stories (id, lang, headline, paragraphs, sources, model, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(id, lang) DO NOTHING`).bind(item.id, lang, headlineOk ? out.headline.trim() : null, status === 'ok' ? JSON.stringify(kept) : null, JSON.stringify(sources), STORY_MODEL, status, new Date().toISOString()).run();
  return shape(await stored(env, item.id, lang));
}
