// Asset universe + news → market transmission map.
//
// The "possible movements" shown on an article page are CONDITIONAL scenarios: for a
// given type of news, each branch ("if the news is hawkish…", "if dovish…") lists the
// direction in which each asset class has *typically* reacted through well-documented
// transmission channels. They are not forecasts, carry no probabilities, and are always
// shown next to real market data (price, change, typical 1-day move) for each asset.

import { std } from './stats.js';

// class: crypto | index | rates | fx | commodity | vol | credit
// src: 'cg' (CoinGecko id) or 'fred' (FRED series id). `invert` flags quotes where a
// rising number means the USD is weakening (EUR/USD, GBP/USD, AUD/USD).
export const UNIVERSE = [
  { id: 'BTC', src: 'cg', ref: 'bitcoin', cls: 'crypto', en: 'Bitcoin', es: 'Bitcoin' },
  { id: 'ETH', src: 'cg', ref: 'ethereum', cls: 'crypto', en: 'Ether', es: 'Ether' },
  { id: 'SOL', src: 'cg', ref: 'solana', cls: 'crypto', en: 'Solana', es: 'Solana' },
  { id: 'XRP', src: 'cg', ref: 'ripple', cls: 'crypto', en: 'XRP', es: 'XRP' },
  { id: 'BNB', src: 'cg', ref: 'binancecoin', cls: 'crypto', en: 'BNB', es: 'BNB' },
  { id: 'DOGE', src: 'cg', ref: 'dogecoin', cls: 'crypto', en: 'Dogecoin', es: 'Dogecoin' },
  { id: 'ADA', src: 'cg', ref: 'cardano', cls: 'crypto', en: 'Cardano', es: 'Cardano' },
  { id: 'LINK', src: 'cg', ref: 'chainlink', cls: 'crypto', en: 'Chainlink', es: 'Chainlink' },
  { id: 'AVAX', src: 'cg', ref: 'avalanche-2', cls: 'crypto', en: 'Avalanche', es: 'Avalanche' },
  { id: 'TRX', src: 'cg', ref: 'tron', cls: 'crypto', en: 'TRON', es: 'TRON' },
  { id: 'SPX', src: 'fred', ref: 'SP500', cls: 'index', en: 'S&P 500', es: 'S&P 500' },
  { id: 'NDX', src: 'fred', ref: 'NASDAQ100', cls: 'index', en: 'Nasdaq 100', es: 'Nasdaq 100' },
  { id: 'IXIC', src: 'fred', ref: 'NASDAQCOM', cls: 'index', en: 'Nasdaq Composite', es: 'Nasdaq Composite' },
  { id: 'DJI', src: 'fred', ref: 'DJIA', cls: 'index', en: 'Dow Jones', es: 'Dow Jones' },
  { id: 'N225', src: 'fred', ref: 'NIKKEI225', cls: 'index', en: 'Nikkei 225', es: 'Nikkei 225' },
  { id: 'UST2Y', src: 'fred', ref: 'DGS2', cls: 'rates', en: 'US 2Y yield', es: 'Rend. EE.UU. 2A' },
  { id: 'UST10Y', src: 'fred', ref: 'DGS10', cls: 'rates', en: 'US 10Y yield', es: 'Rend. EE.UU. 10A' },
  { id: 'REAL10Y', src: 'fred', ref: 'DFII10', cls: 'rates', en: 'US 10Y real yield', es: 'Rend. real EE.UU. 10A' },
  { id: 'DXY', src: 'fred', ref: 'DTWEXBGS', cls: 'fx', en: 'Broad US dollar', es: 'Dólar amplio' },
  { id: 'EURUSD', src: 'fred', ref: 'DEXUSEU', cls: 'fx', en: 'EUR/USD', es: 'EUR/USD', invert: true },
  { id: 'GBPUSD', src: 'fred', ref: 'DEXUSUK', cls: 'fx', en: 'GBP/USD', es: 'GBP/USD', invert: true },
  { id: 'AUDUSD', src: 'fred', ref: 'DEXUSAL', cls: 'fx', en: 'AUD/USD', es: 'AUD/USD', invert: true },
  { id: 'USDJPY', src: 'fred', ref: 'DEXJPUS', cls: 'fx', en: 'USD/JPY', es: 'USD/JPY' },
  { id: 'USDCHF', src: 'fred', ref: 'DEXSZUS', cls: 'fx', en: 'USD/CHF', es: 'USD/CHF' },
  { id: 'USDCAD', src: 'fred', ref: 'DEXCAUS', cls: 'fx', en: 'USD/CAD', es: 'USD/CAD' },
  { id: 'USDCNY', src: 'fred', ref: 'DEXCHUS', cls: 'fx', en: 'USD/CNY', es: 'USD/CNY' },
  { id: 'USDMXN', src: 'fred', ref: 'DEXMXUS', cls: 'fx', en: 'USD/MXN', es: 'USD/MXN' },
  { id: 'USDBRL', src: 'fred', ref: 'DEXBZUS', cls: 'fx', en: 'USD/BRL', es: 'USD/BRL' },
  { id: 'WTI', src: 'fred', ref: 'DCOILWTICO', cls: 'commodity', en: 'WTI crude', es: 'Petróleo WTI' },
  { id: 'BRENT', src: 'fred', ref: 'DCOILBRENTEU', cls: 'commodity', en: 'Brent crude', es: 'Petróleo Brent' },
  { id: 'NATGAS', src: 'fred', ref: 'DHHNGSP', cls: 'commodity', en: 'Natural gas (Henry Hub)', es: 'Gas natural (Henry Hub)' },
  { id: 'GOLD', src: 'cg', ref: 'pax-gold', cls: 'commodity', en: 'Gold (PAXG proxy)', es: 'Oro (proxy PAXG)', proxy: true },
  { id: 'VIX', src: 'fred', ref: 'VIXCLS', cls: 'vol', en: 'VIX', es: 'VIX' },
  { id: 'GVZ', src: 'fred', ref: 'GVZCLS', cls: 'vol', en: 'Gold volatility (GVZ)', es: 'Volatilidad oro (GVZ)' },
  { id: 'OVX', src: 'fred', ref: 'OVXCLS', cls: 'vol', en: 'Oil volatility (OVX)', es: 'Volatilidad petróleo (OVX)' },
  { id: 'HYOAS', src: 'fred', ref: 'BAMLH0A0HYM2', cls: 'credit', en: 'US high-yield spread', es: 'Diferencial high-yield EE.UU.' },
];

export const CLASS_NAMES = {
  crypto: ['Crypto', 'Cripto'], index: ['Equity indices', 'Índices bursátiles'], rates: ['Rates', 'Tipos'],
  fx: ['Currencies', 'Divisas'], commodity: ['Commodities', 'Materias primas'], vol: ['Volatility', 'Volatilidad'], credit: ['Credit', 'Crédito'],
};

// Text patterns that tag an article with specific assets from the universe.
export const ASSET_PATTERNS = [
  ['BTC', /\b(bitcoin|btc)\b/i], ['ETH', /\b(ethereum|ether|eth)\b/i], ['SOL', /\b(solana|sol)\b/i], ['XRP', /\b(xrp|ripple)\b/i],
  ['BNB', /\b(bnb|binance coin)\b/i], ['DOGE', /\b(dogecoin|doge)\b/i], ['ADA', /\b(cardano|ada)\b/i], ['LINK', /\b(chainlink)\b/i],
  ['AVAX', /\b(avalanche|avax)\b/i], ['TRX', /\b(tron|trx)\b/i],
  ['SPX', /\b(s&p ?500|spx|wall street|stocks|acciones|bolsa)\b/i], ['NDX', /\b(nasdaq|tech stocks|tecnol[oó]gicas)\b/i], ['DJI', /\b(dow jones|the dow)\b/i],
  ['N225', /\b(nikkei|japanese stocks)\b/i], ['UST10Y', /\b(treasur(y|ies)|10-year|bond yields?|bonos?)\b/i], ['UST2Y', /\b(2-year|two-year)\b/i],
  ['DXY', /\b(dollar|d[oó]lar|greenback|dxy)\b/i], ['EURUSD', /\b(euro|eur\/usd|eurusd)\b/i], ['GBPUSD', /\b(pound|sterling|libra|gbp)\b/i],
  ['USDJPY', /\b(yen|jpy|bank of japan|boj)\b/i], ['USDCHF', /\b(franc|swiss)\b/i], ['USDCAD', /\b(canadian dollar|loonie|cad)\b/i],
  ['USDCNY', /\b(yuan|renminbi|cny|pboc)\b/i], ['USDMXN', /\b(peso mexicano|mexican peso|mxn|banxico)\b/i], ['USDBRL', /\b(real brasile[nñ]o|brazilian real|brl)\b/i],
  ['AUDUSD', /\b(aussie|australian dollar|rba)\b/i],
  ['WTI', /\b(oil|crude|wti|petr[oó]leo|opec\+?)\b/i], ['BRENT', /\b(brent)\b/i], ['NATGAS', /\b(natural gas|gas natural|lng)\b/i],
  ['GOLD', /\b(gold|oro|bullion)\b/i], ['VIX', /\b(vix|volatility|volatilidad)\b/i], ['HYOAS', /\b(junk bonds?|high[- ]yield|credit spreads?)\b/i],
];

// Conditional transmission scenarios per news category. +1 = tends to rise, −1 = tends to fall.
// Sources of the channel logic: standard monetary-policy / FX / commodity transmission.
// Ambiguous assets are deliberately omitted rather than guessed.
const S = (key, en, es, moves) => ({ key, label: { en, es }, moves });
export const TRANSMISSION = {
  'central-banks': [
    S('hawkish', 'If the decision/communication is more hawkish than expected (higher-for-longer, hikes)', 'Si la decisión/comunicación es más restrictiva de lo esperado (tipos altos más tiempo, subidas)',
      { UST2Y: 1, UST10Y: 1, REAL10Y: 1, DXY: 1, EURUSD: -1, USDJPY: 1, USDMXN: 1, SPX: -1, NDX: -1, GOLD: -1, BTC: -1, ETH: -1, SOL: -1, VIX: 1, HYOAS: 1 }),
    S('dovish', 'If it is more dovish than expected (cuts, easing bias)', 'Si es más expansiva de lo esperado (recortes, sesgo de relajación)',
      { UST2Y: -1, UST10Y: -1, REAL10Y: -1, DXY: -1, EURUSD: 1, USDJPY: -1, USDMXN: -1, SPX: 1, NDX: 1, GOLD: 1, BTC: 1, ETH: 1, SOL: 1, VIX: -1, HYOAS: -1 }),
  ],
  inflation: [
    S('hot', 'If inflation comes in hotter than expected', 'Si la inflación sale por encima de lo esperado',
      { UST2Y: 1, UST10Y: 1, REAL10Y: 1, DXY: 1, EURUSD: -1, SPX: -1, NDX: -1, GOLD: -1, BTC: -1, ETH: -1, VIX: 1 }),
    S('cool', 'If inflation comes in cooler than expected', 'Si la inflación sale por debajo de lo esperado',
      { UST2Y: -1, UST10Y: -1, REAL10Y: -1, DXY: -1, EURUSD: 1, SPX: 1, NDX: 1, GOLD: 1, BTC: 1, ETH: 1, VIX: -1 }),
  ],
  labor: [
    S('strong', 'If the labor data are stronger than expected', 'Si los datos de empleo son más fuertes de lo esperado',
      { UST2Y: 1, UST10Y: 1, DXY: 1, EURUSD: -1, USDJPY: 1, GOLD: -1, BTC: -1 }),
    S('weak', 'If the labor data are weaker than expected', 'Si los datos de empleo son más débiles de lo esperado',
      { UST2Y: -1, UST10Y: -1, DXY: -1, EURUSD: 1, USDJPY: -1, GOLD: 1, VIX: 1 }),
  ],
  growth: [
    S('stronger', 'If growth surprises to the upside', 'Si el crecimiento sorprende al alza',
      { SPX: 1, NDX: 1, DJI: 1, UST10Y: 1, WTI: 1, BRENT: 1, AUDUSD: 1, HYOAS: -1, VIX: -1 }),
    S('weaker', 'If growth surprises to the downside / recession fears', 'Si el crecimiento decepciona / temor a recesión',
      { SPX: -1, NDX: -1, DJI: -1, UST10Y: -1, WTI: -1, BRENT: -1, AUDUSD: -1, GOLD: 1, USDJPY: -1, HYOAS: 1, VIX: 1 }),
  ],
  'rates-bonds': [
    S('higher', 'If yields keep rising', 'Si los rendimientos siguen subiendo',
      { UST10Y: 1, REAL10Y: 1, DXY: 1, USDJPY: 1, SPX: -1, NDX: -1, GOLD: -1, BTC: -1, ETH: -1 }),
    S('lower', 'If yields fall', 'Si los rendimientos bajan',
      { UST10Y: -1, REAL10Y: -1, DXY: -1, USDJPY: -1, SPX: 1, NDX: 1, GOLD: 1, BTC: 1, ETH: 1 }),
  ],
  'fx-dollar': [
    S('stronger-usd', 'If the US dollar strengthens', 'Si el dólar se fortalece',
      { DXY: 1, EURUSD: -1, GBPUSD: -1, AUDUSD: -1, USDJPY: 1, USDMXN: 1, USDBRL: 1, USDCNY: 1, GOLD: -1, WTI: -1, BTC: -1 }),
    S('weaker-usd', 'If the US dollar weakens', 'Si el dólar se debilita',
      { DXY: -1, EURUSD: 1, GBPUSD: 1, AUDUSD: 1, USDJPY: -1, USDMXN: -1, USDBRL: -1, USDCNY: -1, GOLD: 1, WTI: 1, BTC: 1 }),
  ],
  commodities: [
    S('supply-shock', 'If supply tightens / prices spike', 'Si se reduce la oferta / se disparan los precios',
      { WTI: 1, BRENT: 1, NATGAS: 1, OVX: 1, USDCAD: -1, UST10Y: 1, SPX: -1 }),
    S('glut', 'If supply loosens / demand weakens', 'Si sobra oferta / se debilita la demanda',
      { WTI: -1, BRENT: -1, NATGAS: -1, USDCAD: 1, UST10Y: -1 }),
  ],
  geopolitics: [
    S('escalation', 'If tensions escalate (risk-off)', 'Si escalan las tensiones (aversión al riesgo)',
      { GOLD: 1, WTI: 1, BRENT: 1, VIX: 1, GVZ: 1, OVX: 1, USDJPY: -1, USDCHF: -1, DXY: 1, SPX: -1, NDX: -1, N225: -1, HYOAS: 1, BTC: -1 }),
    S('de-escalation', 'If tensions ease (risk-on)', 'Si se relajan las tensiones (apetito por riesgo)',
      { GOLD: -1, WTI: -1, BRENT: -1, VIX: -1, SPX: 1, NDX: 1, N225: 1, HYOAS: -1, BTC: 1 }),
  ],
  regulation: [
    S('supportive', 'If the regulatory outcome is supportive for crypto', 'Si el resultado regulatorio favorece a las cripto',
      { BTC: 1, ETH: 1, SOL: 1, XRP: 1, BNB: 1 }),
    S('restrictive', 'If it is restrictive / enforcement-heavy', 'Si es restrictivo / con más sanciones',
      { BTC: -1, ETH: -1, SOL: -1, XRP: -1, BNB: -1 }),
  ],
  'etf-flows': [
    S('inflows', 'If ETF inflows persist', 'Si continúan las entradas en ETF', { BTC: 1, ETH: 1, SOL: 1 }),
    S('outflows', 'If ETF outflows persist', 'Si continúan las salidas de ETF', { BTC: -1, ETH: -1, SOL: -1 }),
  ],
  stablecoins: [
    S('growth', 'If stablecoin supply keeps expanding', 'Si la oferta de stablecoins sigue creciendo', { BTC: 1, ETH: 1, SOL: 1, TRX: 1 }),
    S('stress', 'If a stablecoin de-pegs or supply contracts', 'Si una stablecoin pierde la paridad o se contrae la oferta', { BTC: -1, ETH: -1, SOL: -1, TRX: -1 }),
  ],
  defi: [
    S('activity-up', 'If on-chain activity / TVL rises', 'Si sube la actividad on-chain / TVL', { ETH: 1, SOL: 1, LINK: 1, AVAX: 1 }),
    S('exploit', 'If it involves an exploit or failure', 'Si implica un hackeo o fallo', { ETH: -1, SOL: -1, LINK: -1, AVAX: -1 }),
  ],
  memecoins: [
    S('speculation-up', 'If speculative activity accelerates', 'Si se acelera la actividad especulativa', { SOL: 1, DOGE: 1 }),
    S('speculation-down', 'If speculative activity fades', 'Si se apaga la actividad especulativa', { SOL: -1, DOGE: -1 }),
  ],
  markets: [
    S('risk-on', 'If the news improves risk appetite', 'Si la noticia mejora el apetito por riesgo', { SPX: 1, NDX: 1, BTC: 1, ETH: 1, VIX: -1, HYOAS: -1 }),
    S('risk-off', 'If it worsens risk appetite', 'Si empeora el apetito por riesgo', { SPX: -1, NDX: -1, BTC: -1, ETH: -1, VIX: 1, GOLD: 1, HYOAS: 1 }),
  ],
};

export function tagAssets(text) {
  return ASSET_PATTERNS.filter(([, re]) => re.test(text)).map(([id]) => id);
}

// Build the impact view for one article: which assets to show (mentioned first, then
// those touched by the scenarios) and the conditional scenarios that apply.
export function impactFor(item) {
  const text = `${item.title} ${item.excerpt || ''} ${(item.feedCategories || []).join(' ')}`;
  const mentioned = tagAssets(text);
  const cats = (item.categories || []).filter((c) => TRANSMISSION[c]);
  if (!cats.length) cats.push('markets');
  const scenarios = cats.slice(0, 3).flatMap((c) => TRANSMISSION[c].map((s) => ({ ...s, category: c })));
  const touched = new Set(scenarios.flatMap((s) => Object.keys(s.moves)));
  const order = [...mentioned, ...UNIVERSE.map((a) => a.id).filter((id) => touched.has(id) && !mentioned.includes(id))];
  const known = new Set(UNIVERSE.map((a) => a.id));
  return { mentioned: mentioned.filter((id) => known.has(id)), assets: order.filter((id) => known.has(id)), scenarios, categories: cats };
}

// Typical one-period move: sample standard deviation of recent changes.
// kind 'pct' → percent changes (prices), 'bp' → changes in basis points (yields/spreads).
export function typicalMove(points, kind = 'pct', n = 60) {
  const v = points.filter((p) => Number.isFinite(p.value)).slice(-(n + 1));
  if (v.length < 20) return null;
  const ch = [];
  for (let i = 1; i < v.length; i++) ch.push(kind === 'bp' ? (v[i].value - v[i - 1].value) * 100 : (v[i].value / v[i - 1].value - 1) * 100);
  return { sigma: std(ch), n: ch.length, unit: kind === 'bp' ? 'bp' : '%' };
}
