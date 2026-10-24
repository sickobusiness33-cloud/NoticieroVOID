// Full text of OFFICIAL releases only. Allowed hosts and their reuse terms:
//  - federalreserve.gov, bea.gov: U.S. government works (public domain)
//  - ecb.europa.eu: reproduction permitted provided the source is acknowledged
//  - bankofengland.co.uk: reproduction permitted with acknowledgement of the source
// Any other publisher is refused: VOID never republishes commercial articles.
import { upstream, cached } from '../lib/core.js';
import { decodeEntities } from '../../public/js/shared/news.js';

export const OFFICIAL_HOSTS = {
  'www.federalreserve.gov': 'Public domain (U.S. Government work)',
  'www.bea.gov': 'Public domain (U.S. Government work)',
  'apps.bea.gov': 'Public domain (U.S. Government work)',
  'www.ecb.europa.eu': 'Reproduction permitted with source acknowledged (ECB)',
  'www.bankofengland.co.uk': 'Reproduction permitted with source acknowledged (Bank of England)',
};

export function extractParagraphs(html) {
  let body = String(html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)[\s\S]*?<\/\1>/gi, ' ');
  const main = body.match(/<(main|article)[\s>][\s\S]*?<\/\1>/i);
  if (main) body = main[0];
  const out = [];
  for (const m of body.matchAll(/<(p|li|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text.length < 40 && m[1].toLowerCase() === 'p') continue;
    if (text.length < 3 || /cookie|javascript|subscribe|share this/i.test(text)) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out.slice(0, 80);
}

export async function officialText(env, item) {
  const host = new URL(item.url).host;
  const license = OFFICIAL_HOSTS[host];
  if (!item.official || !license) throw Object.assign(new Error('Full text is only available for official public-sector releases'), { status: 403 });
  const r = await cached(env, `official:${item.id}`, 24 * 3600, async () => {
    const html = await upstream(`official:${host}`, item.url, { as: 'text', timeoutMs: 15000, retries: 1, init: { headers: { 'user-agent': 'Mozilla/5.0 (compatible; NoticieroVOID/1.0)' } } });
    return extractParagraphs(html);
  });
  if (!r.value.length) throw Object.assign(new Error('No text could be extracted from the official page'), { status: 502 });
  return { paragraphs: r.value, license, sourceUrl: item.url };
}
