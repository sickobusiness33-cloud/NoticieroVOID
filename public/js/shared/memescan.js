// Memecoin scanner analytics: momentum score, activity signals and risk flags.
//
// Everything here is deterministic and computed from observed on-chain/DEX data
// (GeckoTerminal). Signals describe *what is happening* (fast launch, volume surge,
// buy pressure…); they are not buy recommendations and say nothing about future price.
// Risk flags are always evaluated next to signals so neither is shown without the other.

const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Normalize a GeckoTerminal pool (+ included base token) into a flat row.
export function normalizePool(p, tokens = {}, now = Date.now()) {
  const a = p.attributes || {};
  const tx = a.transactions || {};
  const vol = a.volume_usd || {};
  const ch = a.price_change_percentage || {};
  const baseId = p.relationships?.base_token?.data?.id;
  const tok = tokens[baseId]?.attributes || {};
  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : null;
  return {
    pool: a.address, name: a.name, symbol: tok.symbol || (a.name || '').split(' / ')[0], tokenName: tok.name || null,
    token: baseId ? baseId.split('_').slice(1).join('_') : null, image: tok.image_url && /^https:\/\//.test(tok.image_url) ? tok.image_url : null,
    dex: p.relationships?.dex?.data?.id || null,
    priceUsd: n(a.base_token_price_usd), fdvUsd: n(a.fdv_usd), marketCapUsd: n(a.market_cap_usd), liquidityUsd: n(a.reserve_in_usd),
    createdAt: a.pool_created_at || null, ageMin: created ? Math.max(0, (now - created) / 60000) : null,
    ch: { m5: n(ch.m5), m15: n(ch.m15), h1: n(ch.h1), h6: n(ch.h6), h24: n(ch.h24) },
    vol: { m5: n(vol.m5), m15: n(vol.m15), h1: n(vol.h1), h6: n(vol.h6), h24: n(vol.h24) },
    tx: Object.fromEntries(['m5', 'm15', 'h1', 'h24'].map((k) => [k, { buys: tx[k]?.buys ?? null, sells: tx[k]?.sells ?? null, buyers: tx[k]?.buyers ?? null, sellers: tx[k]?.sellers ?? null }])),
    url: a.address ? `https://www.geckoterminal.com/solana/pools/${a.address}` : null,
  };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const val = (r) => r.marketCapUsd ?? r.fdvUsd;

// Momentum score 0–100 from four observable components (weights documented in the UI).
export function momentum(r) {
  const v5 = r.vol.m5 ?? 0, v1h = r.vol.h1 ?? 0;
  // Pace of the last 5 minutes vs the hourly pace (1 = steady, 3 = three times faster).
  const accel = v1h > 0 ? (v5 * 12) / v1h : v5 > 0 ? 3 : 0;
  const b = r.tx.m5.buys ?? 0, s = r.tx.m5.sells ?? 0;
  const buyRatio = b + s > 0 ? b / (b + s) : null;
  const buyers = r.tx.m5.buyers ?? 0;
  const c1h = r.ch.h1 ?? 0;
  const parts = {
    volume: clamp01(Math.log10(1 + v5) / 5) * 30,            // $100k in 5 min ≈ full marks
    acceleration: clamp01((accel - 1) / 4) * 25,            // 5× hourly pace ≈ full marks
    buyPressure: buyRatio === null ? 0 : clamp01((buyRatio - 0.5) / 0.3) * 20 * clamp01(buyers / 30),
    priceTrend: clamp01(c1h / 100) * 25,                    // +100% in 1h ≈ full marks
  };
  const score = Math.round(Object.values(parts).reduce((x, y) => x + y, 0));
  return { score, parts, accel: +accel.toFixed(2), buyRatio };
}

export const SIGNAL_RULES = {
  ROCKET_LAUNCH: { en: 'Rocket launch', es: 'Lanzamiento cohete', // A headline valuation only counts if real money backs it: inflated-supply tokens can
    // print huge FDVs with almost no liquidity or volume (a common scam pattern).
    test: (r) => r.ageMin !== null && r.ageMin <= 60 && val(r) >= 1_000_000 && (r.liquidityUsd ?? 0) >= 25_000
      && (r.vol.h1 ?? 0) >= 50_000 && r.liquidityUsd / val(r) >= 0.01,
    why: (r) => ({ en: `Reached $${fmtM(val(r))} valuation ${Math.round(r.ageMin)} min after launch`, es: `Alcanzó $${fmtM(val(r))} de valoración ${Math.round(r.ageMin)} min tras el lanzamiento` }) },
  VOLUME_SURGE: { en: 'Volume surge', es: 'Explosión de volumen', test: (r, m) => (r.vol.m5 ?? 0) >= 25_000 && m.accel >= 3,
    why: (r, m) => ({ en: `$${fmtM(r.vol.m5)} traded in 5 min, ${m.accel}× the hourly pace`, es: `$${fmtM(r.vol.m5)} negociados en 5 min, ${m.accel}× el ritmo horario` }) },
  BUY_PRESSURE: { en: 'Buy pressure', es: 'Presión compradora', test: (r, m) => (r.tx.m5.buyers ?? 0) >= 25 && m.buyRatio >= 0.7,
    why: (r, m) => ({ en: `${r.tx.m5.buyers} buyers in 5 min, ${Math.round(m.buyRatio * 100)}% of trades are buys`, es: `${r.tx.m5.buyers} compradores en 5 min, ${Math.round(m.buyRatio * 100)}% de operaciones son compras` }) },
  BREAKOUT: { en: 'Breakout', es: 'Ruptura', test: (r) => (r.ch.h1 ?? 0) >= 50 && (r.liquidityUsd ?? 0) >= 30_000,
    why: (r) => ({ en: `+${Math.round(r.ch.h1)}% in 1h with $${fmtM(r.liquidityUsd)} liquidity`, es: `+${Math.round(r.ch.h1)}% en 1h con $${fmtM(r.liquidityUsd)} de liquidez` }) },
  NEAR_GRADUATION: { en: 'Near graduation', es: 'A punto de graduarse', test: (r) => r.info?.graduation !== null && r.info?.graduation >= 85 && !r.info?.graduated,
    why: (r) => ({ en: `Bonding curve ${Math.round(r.info.graduation)}% complete on the launchpad`, es: `Curva de bonding al ${Math.round(r.info.graduation)}% en el launchpad` }) },
};

export function fmtM(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

export function signalsFor(r, m = momentum(r)) {
  return Object.entries(SIGNAL_RULES).filter(([, s]) => { try { return !!s.test(r, m); } catch { return false; } })
    .map(([key, s]) => ({ key, label: { en: s.en, es: s.es }, reason: s.why(r, m) }));
}

// Normalize GeckoTerminal token info into the fields the risk model uses.
export function normalizeInfo(attrs = {}) {
  const yn = (x) => (x === 'yes' ? true : x === 'no' ? false : null);
  const top10 = n(attrs.holders?.distribution_percentage?.top_10);
  return {
    gtScore: n(attrs.gt_score), holders: n(attrs.holders?.count), top10Pct: top10,
    mintAuthority: yn(attrs.mint_authority), freezeAuthority: yn(attrs.freeze_authority), honeypot: yn(attrs.is_honeypot),
    devPct: n(attrs.developer_holding_percentage),
    graduation: n(attrs.launchpad_details?.graduation_percentage), graduated: !!attrs.launchpad_details?.completed,
    twitter: attrs.twitter_handle || null, telegram: attrs.telegram_handle || null, websites: (attrs.websites || []).slice(0, 2),
  };
}

// Risk flags. Level is never "safe": the lowest level is MODERATE.
export function riskFor(r) {
  const f = [];
  const add = (sev, en, es) => f.push({ sev, en, es });
  const i = r.info;
  if (i) {
    if (i.mintAuthority === true) add('critical', 'Mint authority enabled: supply can be inflated', 'Autoridad de mint activa: pueden crear más tokens');
    if (i.freezeAuthority === true) add('critical', 'Freeze authority enabled: holders can be frozen', 'Autoridad de freeze activa: pueden congelar tus tokens');
    if (i.honeypot === true) add('critical', 'Flagged as honeypot (cannot sell)', 'Marcado como honeypot (no se puede vender)');
    if (i.devPct !== null && i.devPct >= 10) add('high', `Developer holds ${i.devPct.toFixed(1)}% of supply`, `El desarrollador tiene el ${i.devPct.toFixed(1)}% del suministro`);
    if (i.top10Pct !== null && i.top10Pct >= 40) add('high', `Top 10 holders own ${i.top10Pct.toFixed(0)}%`, `Los 10 mayores holders tienen el ${i.top10Pct.toFixed(0)}%`);
    if (i.gtScore !== null && i.gtScore < 25) add('medium', `Low GeckoTerminal trust score (${i.gtScore.toFixed(0)}/100)`, `Puntuación de confianza baja en GeckoTerminal (${i.gtScore.toFixed(0)}/100)`);
    if (i.honeypot === null) add('medium', 'Honeypot status unknown', 'Estado de honeypot desconocido');
    if (!i.twitter && !i.telegram && !i.websites.length) add('medium', 'No website or social links', 'Sin web ni redes sociales');
  } else {
    add('medium', 'Contract checks not loaded for this token', 'Comprobaciones del contrato no cargadas para este token');
  }
  if ((r.liquidityUsd ?? 0) < 10_000) add('high', `Very thin liquidity ($${fmtM(r.liquidityUsd)})`, `Liquidez muy baja ($${fmtM(r.liquidityUsd)})`);
  const v = val(r);
  if (v && r.liquidityUsd && r.liquidityUsd / v < 0.02) add('high', 'Liquidity under 2% of valuation: large price impact', 'Liquidez inferior al 2% de la valoración: gran impacto en precio');
  if (r.ageMin !== null && r.ageMin < 15) add('high', `Only ${Math.round(r.ageMin)} min old`, `Solo ${Math.round(r.ageMin)} min de vida`);
  if ((r.tx.m5.buys ?? 0) >= 20 && (r.tx.m5.sells ?? 0) === 0) add('medium', 'Buys but no sells in 5 min (check it is sellable)', 'Compras sin ninguna venta en 5 min (verifica que se pueda vender)');
  const crit = f.filter((x) => x.sev === 'critical').length, high = f.filter((x) => x.sev === 'high').length;
  const level = crit ? 'EXTREME' : high >= 2 ? 'HIGH' : high === 1 || f.length >= 2 ? 'ELEVATED' : 'MODERATE';
  return { level, flags: f };
}

export function analyze(r) {
  const m = momentum(r);
  return { ...r, momentum: m, signals: signalsFor(r, m), risk: riskFor(r) };
}

// Merge rows from several lists (new, trending, launchpad), keeping one row per pool.
export function mergePools(lists) {
  const byPool = new Map();
  for (const [source, rows] of lists) for (const r of rows) {
    if (!r.pool) continue;
    const prev = byPool.get(r.pool);
    if (prev) prev.lists.push(source); else byPool.set(r.pool, { ...r, lists: [source] });
  }
  return [...byPool.values()];
}
