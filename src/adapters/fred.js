// FRED adapter (Federal Reserve Bank of St. Louis).
// With FRED_API_KEY set it uses the official JSON API (fred/series/observations) and
// release-dates endpoints. Without a key it uses FRED's public graph CSV download,
// which serves the same observations but no release calendar.

import { upstream } from '../lib/core.js';

// Units verified against current FRED values (magnitudes checked 2026-10-22).
export const CATALOG = {
  // Rates & curve
  DGS3MO: { name: '3-Month Treasury Yield', nameEs: 'Rendimiento Tesoro 3 meses', unit: '%', freq: 'daily', group: 'rates' },
  DGS2: { name: '2-Year Treasury Yield', nameEs: 'Rendimiento Tesoro 2 años', unit: '%', freq: 'daily', group: 'rates' },
  DGS10: { name: '10-Year Treasury Yield', nameEs: 'Rendimiento Tesoro 10 años', unit: '%', freq: 'daily', group: 'rates' },
  T10Y2Y: { name: '10Y − 2Y Treasury Spread', nameEs: 'Diferencial 10A − 2A', unit: 'pp', freq: 'daily', group: 'rates' },
  T10Y3M: { name: '10Y − 3M Treasury Spread', nameEs: 'Diferencial 10A − 3M', unit: 'pp', freq: 'daily', group: 'rates' },
  DFII10: { name: '10-Year Real Yield (TIPS)', nameEs: 'Rendimiento real 10 años (TIPS)', unit: '%', freq: 'daily', group: 'rates' },
  SOFR: { name: 'SOFR', nameEs: 'SOFR', unit: '%', freq: 'daily', group: 'funding' },
  DFF: { name: 'Effective Fed Funds Rate', nameEs: 'Tasa efectiva de fondos federales', unit: '%', freq: 'daily', group: 'policy' },
  DFEDTARU: { name: 'Fed Funds Target (Upper)', nameEs: 'Objetivo fondos federales (sup.)', unit: '%', freq: 'daily', group: 'policy' },
  ECBDFR: { name: 'ECB Deposit Facility Rate', nameEs: 'Tipo de la facilidad de depósito BCE', unit: '%', freq: 'daily', group: 'policy' },
  IRSTCI01JPM156N: { name: 'Japan Call Money Rate', nameEs: 'Tasa interbancaria Japón', unit: '%', freq: 'monthly', group: 'policy' },
  // Inflation
  CPIAUCSL: { name: 'CPI (All Urban)', nameEs: 'IPC (urbano)', unit: 'index 1982-84=100', freq: 'monthly', group: 'inflation', transform: 'yoy' },
  CPILFESL: { name: 'Core CPI', nameEs: 'IPC subyacente', unit: 'index 1982-84=100', freq: 'monthly', group: 'inflation', transform: 'yoy' },
  PCEPILFE: { name: 'Core PCE Price Index', nameEs: 'Índice PCE subyacente', unit: 'index 2017=100', freq: 'monthly', group: 'inflation', transform: 'yoy' },
  CP0000EZ19M086NEST: { name: 'Euro Area HICP', nameEs: 'IPCA zona euro', unit: 'index 2015=100', freq: 'monthly', group: 'inflation', transform: 'yoy' },
  T5YIE: { name: '5-Year Breakeven Inflation', nameEs: 'Inflación implícita 5 años', unit: '%', freq: 'daily', group: 'inflation' },
  T5YIFR: { name: '5y5y Forward Inflation Expectation', nameEs: 'Expectativa inflación 5a5a', unit: '%', freq: 'daily', group: 'inflation' },
  // Growth & labor
  A191RL1Q225SBEA: { name: 'Real GDP Growth (SAAR)', nameEs: 'Crecimiento PIB real (anualizado)', unit: '% q/q SAAR', freq: 'quarterly', group: 'growth' },
  UNRATE: { name: 'Unemployment Rate', nameEs: 'Tasa de desempleo', unit: '%', freq: 'monthly', group: 'labor' },
  PAYEMS: { name: 'Nonfarm Payrolls', nameEs: 'Nóminas no agrícolas', unit: 'thousands', freq: 'monthly', group: 'labor', transform: 'diff' },
  ICSA: { name: 'Initial Jobless Claims', nameEs: 'Solicitudes iniciales de desempleo', unit: 'claims', freq: 'weekly', group: 'labor' },
  // Liquidity & balance sheets
  WALCL: { name: 'Fed Total Assets', nameEs: 'Activos totales de la Fed', unit: 'USD millions', freq: 'weekly', group: 'liquidity' },
  WTREGEN: { name: 'Treasury General Account', nameEs: 'Cuenta General del Tesoro', unit: 'USD millions', freq: 'weekly', group: 'liquidity' },
  RRPONTSYD: { name: 'Overnight Reverse Repo', nameEs: 'Repo inverso a un día', unit: 'USD billions', freq: 'daily', group: 'liquidity' },
  WRESBAL: { name: 'Reserve Balances at Fed', nameEs: 'Reservas en la Fed', unit: 'USD millions', freq: 'weekly', group: 'liquidity' },
  M2SL: { name: 'M2 Money Stock', nameEs: 'Masa monetaria M2', unit: 'USD billions', freq: 'monthly', group: 'liquidity' },
  ECBASSETSW: { name: 'Eurosystem Total Assets', nameEs: 'Activos totales Eurosistema', unit: 'EUR millions', freq: 'weekly', group: 'liquidity' },
  JPNASSETS: { name: 'Bank of Japan Total Assets', nameEs: 'Activos totales Banco de Japón', unit: 'JPY 100 millions', freq: 'monthly', group: 'liquidity' },
  // Credit, risk, FX, commodities, equities
  BAMLH0A0HYM2: { name: 'US High-Yield OAS', nameEs: 'Diferencial high-yield EE.UU.', unit: '%', freq: 'daily', group: 'credit' },
  NFCI: { name: 'Chicago Fed Financial Conditions', nameEs: 'Condiciones financieras (Fed Chicago)', unit: 'index', freq: 'weekly', group: 'credit' },
  VIXCLS: { name: 'VIX (close)', nameEs: 'VIX (cierre)', unit: 'index', freq: 'daily', group: 'risk' },
  DTWEXBGS: { name: 'Broad US Dollar Index', nameEs: 'Índice amplio del dólar', unit: 'index Jan 2006=100', freq: 'daily', group: 'fx' },
  DCOILWTICO: { name: 'WTI Crude Oil', nameEs: 'Petróleo WTI', unit: 'USD/bbl', freq: 'daily', group: 'commodities' },
  SP500: { name: 'S&P 500', nameEs: 'S&P 500', unit: 'index', freq: 'daily', group: 'equities' },
  NASDAQCOM: { name: 'NASDAQ Composite', nameEs: 'NASDAQ Composite', unit: 'index', freq: 'daily', group: 'equities' },
  DJIA: { name: 'Dow Jones Industrial Average', nameEs: 'Dow Jones', unit: 'index', freq: 'daily', group: 'equities' },
};

// FRED daily data are end-of-day closes published with a lag; never "live".
export const STATUS_BY_FREQ = { daily: 'delayed', weekly: 'historical', monthly: 'historical', quarterly: 'historical' };

export function fredUrl(id) { return `https://fred.stlouisfed.org/series/${id}`; }

// FRED throttles bursts (HTTP 403/429 on the public CSV endpoint), so upstream calls
// are limited to a few at a time per isolate.
const MAX_CONCURRENT = 4;
let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

export const FULL_HISTORY_START = '1990-01-01';

export async function fetchSeries(env, id, start = FULL_HISTORY_START) {
  if (!CATALOG[id]) throw new Error(`Series ${id} is not in the catalog`);
  return withSlot(() => fetchSeriesNow(env, id, start));
}

async function fetchSeriesNow(env, id, start) {
  if (env.FRED_API_KEY) {
    const u = new URL('https://api.stlouisfed.org/fred/series/observations');
    u.search = new URLSearchParams({ series_id: id, api_key: env.FRED_API_KEY, file_type: 'json', observation_start: start }).toString();
    const body = await upstream('fred', u.toString(), { timeoutMs: 12000 });
    return body.observations.map((o) => ({ date: o.date, value: o.value === '.' ? NaN : Number(o.value) })).filter((p) => Number.isFinite(p.value));
  }
  const csv = await upstream('fred', `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`, { as: 'text', timeoutMs: 15000, retries: 3, retryOn: [403, 429] });
  return parseFredCsv(csv);
}

export function parseFredCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!/date/i.test(lines[0])) throw new Error('Unexpected FRED CSV header');
  const out = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(',');
    const value = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && raw !== '.' && raw !== '' && Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}

// Official release calendar — requires FRED_API_KEY.
export async function releaseDates(env, from, to) {
  if (!env.FRED_API_KEY) return null;
  const u = new URL('https://api.stlouisfed.org/fred/releases/dates');
  u.search = new URLSearchParams({ api_key: env.FRED_API_KEY, file_type: 'json', realtime_start: from, realtime_end: to, include_release_dates_with_no_data: 'true', limit: '1000', sort_order: 'asc' }).toString();
  const body = await upstream('fred', u.toString());
  return body.release_dates || [];
}
