// VOID AI Analyst. Requires the ANTHROPIC_API_KEY secret.
// The model only sees an "evidence pack" we assemble from retrieved data (indicator
// values with dates, rule-based regime, headlines with links). It is instructed to cite
// evidence ids, to separate reported facts from interpretation, and to say when the
// evidence is insufficient. Output is validated JSON; anything malformed is rejected.

import Anthropic from '@anthropic-ai/sdk';
import { log } from '../lib/core.js';

const MODEL_DEFAULT = 'claude-opus-5-5';

export function aiEnabled(env) { return !!env.ANTHROPIC_API_KEY; }

function client(env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 });
}

const RULES = `You are VOID Analyst, the research assistant of the Noticiero VOID financial intelligence terminal.
Hard rules:
- Use ONLY the evidence provided in the EVIDENCE block. Every factual claim must cite one or more evidence ids like [E3].
- Never invent numbers, dates, quotes, consensus forecasts, probabilities, or sources. Do not state numeric probabilities.
- Separate what was reported/measured ("facts") from your interpretation ("analysis").
- Monthly/weekly statistics are not real-time; mention observation dates when relevant.
- Correlation is not causation; historical relationships may not persist.
- If the evidence cannot support a conclusion, say "insufficient evidence" for that item.
- This is research, not investment advice.
Return ONLY a JSON object, no markdown fences.`;

const BRIEFING_SHAPE = `{
 "executiveSummary": {"regime": string, "keyDevelopments": [string], "expectationShifts": [string], "upcomingCatalysts": [string], "principalRisks": [string]},
 "regimeAnalysis": {"inflation": string, "growth": string, "policy": string, "financialConditions": string, "liquidity": string, "riskAppetite": string, "mixedSignals": [string]},
 "scenarios": [{"name": "bullish"|"base"|"bearish", "thesis": string, "supportingEvidence": [string], "triggers": [string], "transmission": string, "affectedAssets": [string], "invalidation": [string], "confidence": "low"|"moderate"|"high", "limitations": string}],
 "evidenceGaps": [string]
}`;

const ARTICLE_SHAPE = `{
 "facts": {"whatHappened": string},
 "analysis": {"vsExpectations": string, "whyItMatters": string, "marketsAffected": [string], "supportingEvidence": [string], "invalidation": [string]},
 "confidence": "low"|"moderate"|"high",
 "limitations": string
}`;

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Model did not return JSON');
  return JSON.parse(t.slice(start, end + 1));
}

async function ask(env, system, user, maxTokens = 8000) {
  const params = {
    model: env.AI_MODEL || MODEL_DEFAULT,
    max_tokens: maxTokens,
    system,
    output_config: { effort: env.AI_EFFORT || 'medium' },
    messages: [{ role: 'user', content: user }],
  };
  // Server-side refusal fallback routed by category; disable with AI_FALLBACKS=off.
  const useFallbacks = env.AI_FALLBACKS !== 'off';
  const c = client(env);
  let res;
  try {
    res = useFallbacks
      ? await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await c.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('AI provider rejected the API key'), { status: 502 });
    if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('AI provider rate limit reached; retry later'), { status: 429 });
    if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`AI provider error ${err.status}`), { status: 502 });
    throw err;
  }
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('The AI model declined this request'), { status: 422 });
  if (res.stop_reason === 'max_tokens') log('warn', 'ai_truncated', { model: res.model });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { data: parseJson(text), model: res.model, usage: res.usage };
}

export function buildEvidence({ indicators = [], regime, news = [], markets = [], liquidity, calendar = [] }) {
  const ev = [];
  const add = (kind, text, ref) => { ev.push({ id: `E${ev.length + 1}`, kind, text, ref }); };
  for (const i of indicators) {
    if (!i?.latest) continue;
    add('indicator', `${i.name} (${i.id}) = ${fmt(i.latest.value)} ${i.unit} for ${i.latest.date}; previous ${i.previous ? `${fmt(i.previous.value)} for ${i.previous.date}` : 'n/a'}; 5y percentile ${i.context ? Math.round(i.context.percentile5y * 100) : 'n/a'}.`, i.meta.sourceUrl);
  }
  for (const m of markets) add('market', `${m.name} (${m.symbol}) price ${fmt(m.price)} USD; 24h ${fmt(m.change24h)}%; 7d ${fmt(m.change7d)}%. CoinGecko, as of ${m.lastUpdated}.`, 'https://www.coingecko.com');
  if (liquidity?.last) add('liquidity', `Fed net liquidity proxy ${fmt(liquidity.last.value)} USD bn on ${liquidity.last.date}; 13 weeks earlier ${fmt(liquidity.prev?.value)} USD bn.`, 'https://fred.stlouisfed.org/series/WALCL');
  if (regime) for (const d of regime.dimensions) add('rule-regime', `Rule-based ${d.key}: ${d.label} (confidence ${d.confidence}).`, null);
  for (const n of news.slice(0, 25)) add('headline', `${n.source} (${n.publishedAt}): "${n.title}"`, n.url);
  for (const c of calendar.slice(0, 12)) add('calendar', `${c.date} ${c.region}: ${c.event}`, c.sourceUrl);
  return ev;
}

const fmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : +v.toFixed(3)) : 'n/a');

export async function briefing(env, evidence, lang = 'en', question = null) {
  const language = lang === 'es' ? 'Spanish (neutral Latin American)' : 'English';
  const task = question
    ? `Write an on-demand research report answering: "${question}". Use the shape below.`
    : 'Write the daily macro & crypto briefing. Use the shape below.';
  const user = `${task}\nWrite all strings in ${language}. Cite evidence ids in every string that states a fact.\nJSON SHAPE:\n${BRIEFING_SHAPE}\n\nEVIDENCE:\n${evidence.map((e) => `[${e.id}] (${e.kind}) ${e.text}`).join('\n')}`;
  const r = await ask(env, RULES, user, 12000);
  return validateBriefing(r.data, evidence) && { report: r.data, model: r.model, evidence, generatedAt: new Date().toISOString(), label: 'AI-GENERATED INTERPRETATION' };
}

export async function analyzeArticle(env, article, context, lang = 'en') {
  const language = lang === 'es' ? 'Spanish' : 'English';
  const evidence = [
    { id: 'E1', kind: 'headline', text: `${article.source} (${article.publishedAt}): "${article.title}". Excerpt: ${article.excerpt}`, ref: article.url },
    ...context.map((e, i) => ({ ...e, id: `E${i + 2}` })),
  ];
  const user = `Analyze this news item. You only have the headline and a short excerpt, not the full article: say so where it limits the analysis.\nWrite all strings in ${language}.\nJSON SHAPE:\n${ARTICLE_SHAPE}\n\nEVIDENCE:\n${evidence.map((e) => `[${e.id}] (${e.kind}) ${e.text}`).join('\n')}`;
  const r = await ask(env, RULES, user, 4000);
  if (!r.data?.facts || !r.data?.analysis) throw Object.assign(new Error('AI returned an unexpected structure'), { status: 502 });
  return { analysis: r.data, model: r.model, evidence, generatedAt: new Date().toISOString(), label: 'AI-GENERATED INTERPRETATION' };
}

// Structural validation + citation check: every cited id must exist in the evidence pack.
export function validateBriefing(report, evidence) {
  if (!report?.executiveSummary || !Array.isArray(report.scenarios)) throw Object.assign(new Error('AI returned an unexpected structure'), { status: 502 });
  const ids = new Set(evidence.map((e) => e.id));
  const cited = JSON.stringify(report).match(/\bE\d+\b/g) || [];
  const bad = [...new Set(cited.filter((c) => !ids.has(c)))];
  if (bad.length) throw Object.assign(new Error(`AI cited unknown evidence: ${bad.join(', ')}`), { status: 502 });
  return true;
}
