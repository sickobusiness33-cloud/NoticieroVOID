// Intelligence-calendar helpers (pure). Event categories drive colours only; they never
// encode a bullish/bearish view. Impact analysis is computed separately.

// Category → colour key used by the UI legend.
export const CATEGORIES = {
  macro: { color: 'blue', en: 'Macroeconomics', es: 'Macroeconomía' },
  cb: { color: 'orange', en: 'Central banks & rates', es: 'Bancos centrales y tipos' },
  crypto: { color: 'purple', en: 'Crypto & on-chain', es: 'Cripto y on-chain' },
  corporate: { color: 'green', en: 'Corporate & markets', es: 'Corporativo y mercados' },
  risk: { color: 'red', en: 'High-risk events', es: 'Eventos de alto riesgo' },
  past: { color: 'gray', en: 'Past / historical', es: 'Pasado / histórico' },
};

// Minimal RFC 5545 parser for VEVENTs (unfolds continuation lines, unescapes text).
export function parseIcs(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (name) => {
      const m = body.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm'));
      return m ? m[1].trim().replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').replace(/\\\\/g, '\\') : null;
    };
    const start = parseIcsDate(get('DTSTART'));
    if (!start) continue;
    out.push({ uid: get('UID'), summary: get('SUMMARY'), start, stamp: parseIcsDate(get('DTSTAMP')), description: get('DESCRIPTION') });
  }
  return out;
}

export function parseIcsDate(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

// Map a BEA release title to type/category/importance.
export function classifyBea(summary) {
  const s = summary || '';
  if (/^Gross Domestic Product|^GDP/i.test(s)) return { type: 'gdp', category: 'macro', importance: /Advance/i.test(s) ? 'high' : 'medium' };
  if (/Personal Income and Outlays/i.test(s)) return { type: 'pce', category: 'macro', importance: 'high' };
  if (/International Trade in Goods and Services/i.test(s)) return { type: 'trade', category: 'macro', importance: 'medium' };
  if (/International Transactions/i.test(s)) return { type: 'bop', category: 'macro', importance: 'low' };
  if (/Personal Income by State|State/i.test(s)) return { type: 'state', category: 'macro', importance: 'low' };
  return { type: 'bea-other', category: 'macro', importance: 'low' };
}

const iso = (d) => d.toISOString().slice(0, 10);
function nthWeekday(year, month, weekday, n) {
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * (n - 1));
  return d;
}
function lastWeekday(year, month, weekday) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// Rule-based expiries (exchange rules, not announcements). Holiday shifts are NOT applied,
// so these are flagged "rule-based" and link to the official exchange calendars.
export function expiries(year) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const third = nthWeekday(year, m, 5, 3);
    const quarterly = m % 3 === 2;
    out.push({
      id: `opex:${iso(third)}`, date: iso(third), time: '16:00', tz: 'America/New_York', region: 'US', type: quarterly ? 'quad-witching' : 'opex',
      title: quarterly ? 'Quarterly options & futures expiration (quad witching)' : 'Monthly US equity options expiration',
      titleEs: quarterly ? 'Vencimiento trimestral de opciones y futuros (cuádruple hora bruja)' : 'Vencimiento mensual de opciones sobre acciones de EE.UU.',
      categories: quarterly ? ['corporate', 'risk'] : ['corporate'], importance: quarterly ? 'high' : 'medium', status: 'scheduled', confirmation: 'rule-based',
      source: 'Cboe/OCC expiration rule (third Friday; holiday shifts not applied)', sourceUrl: 'https://www.cboe.com/about/hours/us-options/', assets: ['SPX', 'NDX', 'VIX'],
    });
    const last = lastWeekday(year, m, 5);
    out.push({
      id: `deribit:${iso(last)}`, date: iso(last), time: '08:00', tz: 'UTC', region: 'Global', type: 'crypto-expiry',
      title: quarterly ? 'Deribit quarterly BTC/ETH options & futures expiry' : 'Deribit monthly BTC/ETH options expiry',
      titleEs: quarterly ? 'Vencimiento trimestral de opciones y futuros BTC/ETH en Deribit' : 'Vencimiento mensual de opciones BTC/ETH en Deribit',
      categories: quarterly ? ['crypto', 'risk'] : ['crypto'], importance: quarterly ? 'high' : 'medium', status: 'scheduled', confirmation: 'rule-based',
      source: 'Deribit expiry rule (last Friday 08:00 UTC)', sourceUrl: 'https://www.deribit.com/kb/deribit-introduction-guide', assets: ['BTC', 'ETH'],
    });
  }
  return out;
}

// Status from date/time relative to now; publication events become "published".
export function statusFor(ev, now = Date.now()) {
  if (ev.status === 'cancelled') return 'cancelled';
  if (!ev.date) return 'tbc';
  const start = Date.parse(ev.datetimeUtc || `${ev.date}T23:59:59Z`);
  const end = start + (ev.durationMin || 60) * 60000;
  if (now < start - 0) return ev.previousDate ? 'rescheduled' : 'scheduled';
  if (now <= end) return 'in-progress';
  return ['cpi', 'pce', 'gdp', 'nfp', 'trade', 'auction', 'bop'].includes(ev.type) ? 'published' : 'finished';
}

// Event type → transmission category (public/js/shared/impact.js TRANSMISSION keys).
export const TYPE_TO_TRANSMISSION = {
  fomc: 'central-banks', ecb: 'central-banks', cpi: 'inflation', pce: 'inflation', ppi: 'inflation', nfp: 'labor', claims: 'labor',
  gdp: 'growth', trade: 'growth', retail: 'growth', auction: 'rates-bonds', opex: 'markets', 'quad-witching': 'markets', 'crypto-expiry': 'markets',
};

export const WATCH = {
  fomc: { en: ['Statement wording on future cuts/hikes', 'Dot plot and projections (at meetings with SEP)', 'Press conference tone', '2-year Treasury yield reaction'], es: ['Redacción del comunicado sobre recortes/subidas', 'Dot plot y proyecciones (en reuniones con SEP)', 'Tono de la rueda de prensa', 'Reacción del rendimiento a 2 años'] },
  ecb: { en: ['Deposit-rate decision', 'Guidance on the path of rates', 'EUR/USD and Bund yields'], es: ['Decisión sobre el tipo de depósito', 'Indicaciones sobre la senda de tipos', 'EUR/USD y rendimientos del Bund'] },
  cpi: { en: ['Core CPI month-on-month', 'Shelter and services ex-shelter', 'Breakeven inflation after release'], es: ['IPC subyacente mensual', 'Vivienda y servicios sin vivienda', 'Inflación implícita tras el dato'] },
  pce: { en: ['Core PCE month-on-month (Fed’s preferred gauge)', 'Real personal spending', 'Revisions to prior months'], es: ['PCE subyacente mensual (indicador preferido de la Fed)', 'Gasto personal real', 'Revisiones de meses anteriores'] },
  gdp: { en: ['Real final sales to private domestic purchasers', 'GDP price index', 'Revisions vs prior estimate'], es: ['Ventas finales reales a compradores privados', 'Deflactor del PIB', 'Revisiones frente a la estimación anterior'] },
  nfp: { en: ['Payrolls vs prior months and revisions', 'Unemployment rate', 'Average hourly earnings'], es: ['Nóminas frente a meses previos y revisiones', 'Tasa de desempleo', 'Salario medio por hora'] },
  trade: { en: ['Goods deficit trend', 'Import/export volumes'], es: ['Tendencia del déficit de bienes', 'Volumen de importaciones/exportaciones'] },
  auction: { en: ['Bid-to-cover ratio', 'High yield vs pre-auction market level (tail)', 'Indirect bidder share'], es: ['Ratio de cobertura', 'Rendimiento adjudicado frente al de mercado (cola)', 'Participación de pujadores indirectos'] },
  opex: { en: ['Open interest concentration near spot', 'VIX into and after expiry'], es: ['Concentración del interés abierto cerca del precio', 'VIX antes y después del vencimiento'] },
  'quad-witching': { en: ['Index rebalancing flows', 'Volume and closing auction imbalance', 'VIX into and after expiry'], es: ['Flujos de rebalanceo de índices', 'Volumen y desequilibrio en la subasta de cierre', 'VIX antes y después del vencimiento'] },
  'crypto-expiry': { en: ['Open interest by strike on Deribit', 'Funding rates and basis around expiry'], es: ['Interés abierto por strike en Deribit', 'Funding y basis alrededor del vencimiento'] },
};

export function horizonLabel(dateStr, now = Date.now()) {
  const days = Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);
  if (days < 0) return { days, kind: 'past' };
  if (days === 0) return { days, kind: 'today' };
  if (days <= 14) return { days, kind: 'near' };
  if (days <= 90) return { days, kind: 'medium' };
  return { days, kind: 'far' };
}
