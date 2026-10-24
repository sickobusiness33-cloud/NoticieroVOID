// Feed parsing, de-duplication, categorization and ranking for the news pipeline.
// Copyright rule enforced here: we keep only headline, a short excerpt (<= EXCERPT_MAX
// chars), publisher, timestamp and the canonical link. Full article bodies are never stored.

export const EXCERPT_MAX = 240;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  return decodeEntities(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim() : '';
}

function attr(block, name, attribute) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : '';
}

export function truncate(s, n = EXCERPT_MAX) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).trim() + '…';
}

// Publisher-supplied thumbnail: media:content / media:thumbnail / image enclosure,
// else the first <img> in the item's HTML. Only absolute https URLs are accepted.
export function feedImage(block) {
  const candidates = [
    attr(block, 'media:content', 'url'), attr(block, 'media:thumbnail', 'url'),
    /<enclosure\b[^>]*type=["']image/i.test(block) ? attr(block, 'enclosure', 'url') : '',
  ];
  const html = decodeEntities((block.match(/<(?:content:encoded|description)[^>]*>([\s\S]*?)<\/(?:content:encoded|description)>/i) || [])[1] || '');
  const img = html.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i);
  if (img) candidates.push(decodeEntities(img[1]));
  const ok = candidates.find((u) => /^https:\/\/[^\s"'<>]+$/i.test(u || '') && !/\.(mp4|mp3|webm)(\?|$)/i.test(u) && !/(pixel|tracking|feeds\.feedburner|1x1|gravatar)/i.test(u));
  return ok || null;
}

// Minimal RSS 2.0 / Atom parser that works in Workers (no DOMParser available there).
export function parseFeed(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = stripHtml(tag(b, 'title'));
    let link = isAtom ? (attr(b, 'link', 'href')) : stripHtml(tag(b, 'link'));
    if (!link) link = stripHtml(tag(b, 'guid'));
    const date = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated');
    const desc = stripHtml(tag(b, 'description') || tag(b, 'summary') || '')
      // WordPress feeds append "The post X appeared first on Y." / "El post X apareció primero en Y."
      .replace(/\s*(The post|El post|La entrada)\s.*?(appeared first on|apareció primero en)\s.*$/i, '')
      // Feed boilerplate such as "Read the full story on X" / "Continue reading" / "Leer más".
      .replace(/\s*(Read the full story on|Read more|Continue reading|Leer m[aá]s|Seguir leyendo|Sigue leyendo)\b.*$/i, '')
      .trim();
    const cats = [...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => stripHtml(m[1])).filter(Boolean);
    const image = feedImage(b);
    const ts = Date.parse(stripHtml(date));
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      title: truncate(title, 300),
      url: link.trim(),
      publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      excerpt: truncate(desc),
      feedCategories: cats.slice(0, 8),
      // Thumbnail the publisher distributes in its own feed (shown with credit + link).
      image,
    });
  }
  return items;
}

const STOP = new Set('the a an of to in on for and or with by at as is are be from after over into its it this that de la el los las en y para por con del al se un una que su sus'.split(' '));

export function titleTokens(title) {
  return new Set(
    title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

export function canonicalUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|ref|mc_)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return u; }
}

// Cluster near-duplicate stories. The earliest report becomes the primary item;
// later reports of the same story are attached as `alsoReportedBy`.
export function dedupe(items, threshold = 0.6) {
  const sorted = [...items].sort((a, b) => (a.publishedAt || '') < (b.publishedAt || '') ? -1 : 1);
  const out = [];
  const seenUrls = new Set();
  for (const it of sorted) {
    const cu = canonicalUrl(it.url);
    if (seenUrls.has(cu)) continue;
    seenUrls.add(cu);
    const tok = titleTokens(it.title);
    const dup = out.find((o) => o.lang === it.lang && jaccard(o._tok, tok) >= threshold);
    if (dup) { dup.alsoReportedBy.push({ source: it.source, url: it.url }); continue; }
    out.push({ ...it, url: cu, _tok: tok, alsoReportedBy: [] });
  }
  return out.map(({ _tok, ...rest }) => rest);
}

export const CATEGORY_RULES = [
  ['central-banks', /\b(fed|fomc|powell|federal reserve|ecb|lagarde|boj|bank of japan|ueda|rate (cut|hike)|interest rate|banco central|tipos de inter[eé]s|reserva federal|bce)\b/i],
  ['inflation', /\b(cpi|pce|inflation|inflaci[oó]n|prices index|hicp|ipc)\b/i],
  ['labor', /\b(jobs|payrolls|unemployment|jobless|labor market|nfp|empleo|desempleo)\b/i],
  ['growth', /\b(gdp|recession|pmi|ism|growth|pib|recesi[oó]n|crecimiento)\b/i],
  ['rates-bonds', /\b(treasur(y|ies)|yields?|bonds?|bund|jgb|bonos?|rendimientos?)\b/i],
  ['fx-dollar', /\b(dollar|dxy|yen|euro|currency|forex|d[oó]lar|divisas?)\b/i],
  ['commodities', /\b(oil|crude|brent|wti|opec\+?|natural gas|lng|gold|silver|copper|commodit(y|ies)|petr[oó]leo|oro|plata|cobre|materias primas|gas natural)\b/i],
  ['geopolitics', /\b(tariffs?|sanctions?|war|election|china|russia|ukraine|middle east|aranceles?|guerra|elecciones?)\b/i],
  ['regulation', /\b(sec|cftc|regulat\w*|lawsuit|etf approval|mica|gensler|atkins|regulaci[oó]n)\b/i],
  ['etf-flows', /\b(etf|inflows?|outflows?|blackrock|ibit|fidelity)\b/i],
  ['defi', /\b(defi|dex|tvl|uniswap|aave|lending|staking|restaking)\b/i],
  ['memecoins', /\b(memecoins?|meme coins?|pump\.?fun|bonk|wif|dogecoin|doge|shib|pepe)\b/i],
  ['stablecoins', /\b(stablecoins?|usdt|usdc|tether|circle|genius act)\b/i],
  ['markets', /\b(bitcoin|btc|ether(eum)?|eth|solana|sol|xrp|crypto|cripto\w*|stocks?|s&p|nasdaq|equities|acciones)\b/i],
  ['ai', /\b(artificial intelligence|ai|a\.i\.|genai|llms?|chatgpt|openai|anthropic|claude|gemini|deepmind|copilot|machine learning|ai agents?|inteligencia artificial|ia generativa|ia)\b/i],
  ['technology', /\b(tech|technology|semiconductors?|chipmakers?|chips?|tsmc|nvidia|intel|amd|apple|microsoft|alphabet|google|meta platforms|startups?|software|cloud computing|data cent(er|re)s?|tecnolog[ií]a|semiconductores?|centros? de datos)\b/i],
  ['web3', /\b(web3|blockchain|layer[- ]?2|rollups?|dapps?|smart contracts?|tokeni[sz]ation|daos?|nfts?|defi|ethereum|solana|cadena de bloques|contratos inteligentes|tokenizaci[oó]n)\b/i],
  ['stocks', /\b(stocks?|shares|equit(y|ies)|s&p ?500|nasdaq|dow jones|earnings|ipos?|wall street|nyse|ibex|acciones|bolsa|resultados trimestrales)\b/i],
  ['prediction-markets', /\b(polymarket|kalshi|prediction markets?|betting markets?|mercados? de predicci[oó]n)\b/i],
];

export const ASSET_RULES = [
  ['BTC', /\b(bitcoin|btc)\b/i], ['ETH', /\b(ethereum|ether|eth)\b/i], ['SOL', /\b(solana|sol)\b/i],
  ['XRP', /\bxrp\b/i], ['USD', /\b(dollar|dxy|d[oó]lar)\b/i], ['GOLD', /\b(gold|oro)\b/i],
  ['OIL', /\b(oil|crude|brent|wti|petr[oó]leo)\b/i], ['SPX', /\b(s&p ?500|spx|stocks|wall street)\b/i],
  ['UST', /\b(treasur(y|ies)|10-year|2-year|yields?)\b/i],
];

export const COUNTRY_RULES = [
  ['US', /\b(u\.?s\.?|united states|america|fed|fomc|treasury|ee\.? ?uu\.?|estados unidos)\b/i],
  ['EU', /\b(ecb|euro ?zone|euro area|eurozona|european|bce|europa)\b/i],
  ['JP', /\b(japan|boj|yen|jap[oó]n)\b/i], ['CN', /\b(china|chinese|pboc|yuan)\b/i],
  ['UK', /\b(uk|britain|bank of england|boe|reino unido)\b/i],
  ['LATAM', /\b(argentina|mexico|m[eé]xico|brazil|brasil|el salvador|venezuela|colombia|chile|per[uú])\b/i],
];

const BREAKING_RE = /\b(breaking|just in|urgent|surges?|plunges?|crash(es)?|halts?|hack(ed)?|exploit(ed)?|emergency|última hora|urgente|se desploma|se dispara)\b/i;

export function classify(item) {
  const text = `${item.title} ${item.excerpt} ${(item.feedCategories || []).join(' ')}`;
  // Keyword rules plus the feed's own topics (e.g. an AI-only feed).
  const categories = [...new Set([...CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([c]) => c), ...(item.topics || [])])];
  return {
    categories: categories.length ? categories : ['general'],
    assets: ASSET_RULES.filter(([, re]) => re.test(text)).map(([a]) => a),
    countries: COUNTRY_RULES.filter(([, re]) => re.test(text)).map(([c]) => c),
  };
}

// Transparent relevance score: recency decay + source weight + macro weight + corroboration.
export function relevance(item, now = Date.now()) {
  const ageH = item.publishedAt ? (now - Date.parse(item.publishedAt)) / 3600000 : 48;
  const recency = Math.exp(-Math.max(0, ageH) / 18);
  const macro = item.categories?.some((c) => ['central-banks', 'inflation', 'labor', 'growth', 'rates-bonds'].includes(c)) ? 0.25 : 0;
  const official = item.official ? 0.3 : 0;
  const corroboration = Math.min(0.3, (item.alsoReportedBy?.length || 0) * 0.1);
  return +(recency + macro + official + corroboration).toFixed(4);
}

export function isBreaking(item, now = Date.now()) {
  if (!item.publishedAt) return false;
  const ageH = (now - Date.parse(item.publishedAt)) / 3600000;
  return ageH >= 0 && ageH < 3 && (BREAKING_RE.test(item.title) || (item.official && ageH < 6) || (item.alsoReportedBy?.length || 0) >= 2);
}

export function enrich(items, now = Date.now()) {
  return items.map((it) => {
    const c = classify(it);
    const e = { ...it, ...c };
    e.breaking = isBreaking(e, now);
    e.score = relevance(e, now);
    return e;
  });
}

export async function hashId(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}
