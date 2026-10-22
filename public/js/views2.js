// Views: Global Liquidity Lab, Crypto Macro Engine, Memecoin Intelligence, Quant Lab.
import { t, tr, getLang } from './i18n.js';
import { h, api, async, panel, metaLine, statusBadge, fmtNum, fmtUsd, fmtPct, fmtCompact, fmtTime, signClass, table, segmented, store, persist, download } from './ui.js';
import { lineChart, sliceRange, bars } from './charts.js';
import { adSlot } from './ads.js';
import { pctReturns, diffs, alignByDate, rollingCorrelation, rollingVol, crossCorrelation, conditionalReturns, eventStudy, pearson, forwardFill } from './shared/stats.js';
import { runBacktest, walkForward, splitTest, STRATEGIES, toCSV } from './shared/backtest.js';
import { MEME_DEFAULT_RULES } from './shared/regime.js';

const pageHead = (title, sub, ...right) => h('div', { class: 'page-h' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'controls' }, ...right));

// ================= LIQUIDITY LAB =================
const LIQ_EXPLAIN = {
  netLiquidity: ['Fed assets minus the Treasury’s cash at the Fed (TGA) minus ON reverse repo: a common proxy for liquidity left in the banking system. It is an identity-based proxy, not a measure of “money printing”.', 'Activos de la Fed menos la caja del Tesoro (TGA) menos el repo inverso: proxy común de la liquidez en el sistema bancario. Es un proxy contable, no una medida de “impresión de dinero”.'],
  tga: ['When the Treasury builds its cash balance (e.g. after issuance), reserves drain from banks; drawing it down adds reserves.', 'Cuando el Tesoro acumula caja (p. ej. tras emisiones) drena reservas de los bancos; al gastarla las añade.'],
  rrp: ['Money-market funds park cash at the Fed via ON RRP. A falling balance has historically released cash into bills and reserves.', 'Los fondos monetarios aparcan liquidez en la Fed vía RRP. Un saldo menguante ha liberado históricamente liquidez hacia letras y reservas.'],
  reserves: ['Bank reserves at the Fed; scarcity can pressure funding markets.', 'Reservas bancarias en la Fed; su escasez puede tensionar la financiación.'],
  ecbAssets: ['Eurosystem balance sheet (EUR). Shown separately — no FX conversion into the Fed series.', 'Balance del Eurosistema (EUR). Se muestra por separado, sin conversión de divisa.'],
  bojAssets: ['Bank of Japan balance sheet (JPY, 100 million units).', 'Balance del Banco de Japón (JPY, unidades de 100 millones).'],
  m2: ['US broad money stock, monthly.', 'Masa monetaria amplia de EE.UU., mensual.'],
  sofr: ['Secured overnight funding rate: price of short-term collateralized funding.', 'Tipo de financiación garantizada a un día: precio de la financiación a corto plazo.'],
  realYield10y: ['10-year TIPS yield: the real cost of money; higher real yields tighten conditions for long-duration and speculative assets.', 'Rendimiento TIPS a 10 años: coste real del dinero; más alto endurece condiciones para activos especulativos.'],
  dollar: ['Trade-weighted broad dollar index; a stronger dollar tightens global conditions.', 'Índice amplio del dólar ponderado por comercio; un dólar fuerte endurece condiciones globales.'],
  stablecoins: ['Total stablecoin supply (DefiLlama): on-chain dollar liquidity available to crypto markets.', 'Oferta total de stablecoins (DefiLlama): liquidez en dólares on-chain disponible para cripto.'],
};

export async function liquidity() {
  const box = h('div');
  let range = '5y';
  const draw = () => async(box, async () => {
    const d = await api('/api/liquidity');
    const m = d.measured;
    const nl = m.netLiquidity;
    const comp = d.composite;
    const card = (key, s, title, fmt = (v) => fmtCompact(v)) => s ? panel(h('div', { class: 'controls' }, h('h2', null, title), h('span', { class: 'badge st-historical' }, t('measured'))),
      lineChart([{ name: `${title} (${s.unit})`, points: sliceRange(s.points, range) }], { format: fmt, maxGapDays: 40 }),
      h('p', { class: 'small muted' }, tr(...LIQ_EXPLAIN[key])), metaLine({ status: s.stale ? 'stale' : 'historical', unit: s.unit, source: 'FRED / DefiLlama', sourceUrl: s.sourceUrl, lastUpdated: s.lastUpdated, note: s.frequency })) : panel(title, h('div', { class: 'error-box' }, t('unavailable')));
    return [
      h('div', { class: 'grid g-main' },
        nl ? panel(h('div', { class: 'controls' }, h('h2', null, tr('Fed net liquidity (USD bn)', 'Liquidez neta Fed (USD mm)')), h('span', { class: 'badge st-historical' }, t('measured'))),
          lineChart([{ name: tr('Net liquidity', 'Liquidez neta'), points: sliceRange(nl.points, range) }, { name: 'TGA', points: sliceRange(nl.points.map((p) => ({ date: p.date, value: p.tga })), range), axis: 'right', dashed: true }, { name: 'ON RRP', points: sliceRange(nl.points.map((p) => ({ date: p.date, value: p.rrp })), range), axis: 'right', dashed: true }], { format: (v) => fmtNum(v, 0) }),
          h('p', { class: 'small muted' }, tr(...LIQ_EXPLAIN.netLiquidity)), h('p', { class: 'small muted mono' }, nl.meta.method), metaLine(nl.meta)) : panel('Net liquidity', h('div', { class: 'error-box' }, t('unavailable'))),
        panel(h('div', { class: 'controls' }, h('h2', null, tr('Composite liquidity score', 'Indicador compuesto de liquidez')), h('span', { class: 'badge st-estimated' }, t('estimate'))),
          lineChart([{ name: 'z-score', points: sliceRange(comp.rows.filter((r) => Number.isFinite(r.value)), range) }], { zero: true, format: (v) => fmtNum(v, 1) }),
          h('h4', null, tr('Inputs & weights', 'Entradas y pesos')),
          table([tr('Component', 'Componente'), tr('Weight', 'Peso'), tr('Sign', 'Signo'), tr('Latest z', 'Último z')], comp.components.map((c) => [c.label, fmtNum(c.weight, 2), c.sign > 0 ? '+' : '−', fmtNum(comp.rows.filter((r) => r.parts[c.key] !== null).at(-1)?.parts[c.key] ?? NaN, 2)])),
          h('p', { class: 'small muted' }, `${tr('Normalization', 'Normalización')}: ${comp.method.normalization}. ${tr('Missing data', 'Datos faltantes')}: ${comp.method.missing}.`),
          h('h4', null, tr('Sensitivity (correlation with base score)', 'Sensibilidad (correlación con el indicador base)')),
          bars(comp.sensitivity.variants.map((v) => ({ label: `${v.name} (n=${v.n})`, value: v.r })), { min: -1, max: 1 }),
          h('p', { class: 'small muted' }, tr('Unit-free percent/absolute changes are standardized before weighting; raw series in different units are never added together. Weights are a documented judgment call, not optimized on returns.', 'Los cambios sin unidades se estandarizan antes de ponderar; nunca se suman series en distintas unidades. Los pesos son una elección documentada, no optimizada sobre rentabilidades.')))),
      h('div', { class: 'grid g3', style: 'margin-top:14px' },
        card('tga', m.tga, 'TGA'), card('rrp', m.rrp, 'ON RRP'), card('reserves', m.reserves, tr('Reserve balances', 'Reservas')),
        card('ecbAssets', m.ecbAssets, tr('Eurosystem assets', 'Activos Eurosistema')), card('bojAssets', m.bojAssets, tr('BoJ assets', 'Activos BoJ')), card('m2', m.m2, 'M2'),
        card('realYield10y', m.realYield10y, tr('10Y real yield', 'Rend. real 10A'), (v) => fmtNum(v, 2)), card('dollar', m.dollar, tr('Broad dollar', 'Dólar amplio'), (v) => fmtNum(v, 1)), card('sofr', m.sofr, 'SOFR', (v) => fmtNum(v, 2)),
        card('stablecoins', m.stablecoins, tr('Stablecoin supply', 'Oferta stablecoins'))),
      d.errors.length ? h('div', { class: 'notice warn', style: 'margin-top:14px' }, d.errors.map((e) => `${e.name}: ${e.error}`).join(' · ')) : null,
    ];
  });
  draw();
  return h('div', null, pageHead(t('nav_liquidity'), tr('Measured data and analytical estimates are labelled separately.', 'Los datos medidos y las estimaciones se etiquetan por separado.'),
    segmented([['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y'], ['max', 'MAX']], range, (r) => { range = r; draw(); })), box);
}

// ================= CRYPTO MACRO ENGINE =================
const factors = () => [
  ['SP500', 'S&P 500', 'pct'], ['NASDAQCOM', 'NASDAQ', 'pct'], ['DTWEXBGS', tr('Broad dollar', 'Dólar amplio'), 'pct'],
  ['DGS10', tr('10Y yield (Δ pp)', 'Rend. 10A (Δ pp)'), 'diff'], ['DFII10', tr('10Y real yield (Δ pp)', 'Rend. real 10A (Δ pp)'), 'diff'], ['VIXCLS', 'VIX', 'pct'], ['DCOILWTICO', 'WTI', 'pct'],
];
const FOMC_DECISIONS = ['2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10', '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16'];

export async function cryptoMacro() {
  const state = { asset: 'bitcoin', window: 60 };
  const box = h('div');
  const assetSel = h('select', { class: 'input', 'aria-label': 'Asset' }, [['bitcoin', 'BTC'], ['ethereum', 'ETH'], ['solana', 'SOL']].map(([v, l]) => h('option', { value: v }, l)));
  assetSel.addEventListener('change', () => { state.asset = assetSel.value; draw(); });
  const draw = () => async(box, async () => {
    const start = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const [hist, ...facs] = await Promise.all([api(`/api/markets/history?asset=${state.asset}&days=365`), ...factors().map(([id]) => api(`/api/macro/series?id=${id}&start=${start}&transform=none`).catch((e) => ({ error: e.message })))]);
    const px = hist.points;
    const cr = pctReturns(px);
    const sample = `${px[0]?.date} → ${px.at(-1)?.date}`;
    const rows = [], rolls = [], lead = [];
    factors().forEach(([id, name, kind], i) => {
      const f = facs[i];
      if (f.error) { rows.push({ label: name, value: NaN, n: 0 }); return; }
      const fr = kind === 'pct' ? pctReturns(f.points) : diffs(f.points);
      // Crypto trades 7 days a week; join on dates where BOTH have an observation (weekdays).
      const a = alignByDate(cr, fr);
      rows.push({ label: name, value: pearson(a.x, a.y), n: a.x.length, id });
      if (['SP500', 'DTWEXBGS', 'DGS10'].includes(id) && a.x.length > state.window) rolls.push({ name, points: rollingCorrelation(a.dates, a.x, a.y, state.window) });
      if (id === 'DTWEXBGS' || id === 'SP500') lead.push({ name, rows: crossCorrelation(a.y, a.x, 5) });
    });
    const vol30 = rollingVol(cr, 30), vol90 = rollingVol(cr, 90);
    const dxy = facs[2].error ? null : pctReturns(facs[2].points);
    const cond = dxy ? conditionalReturns(dxy, cr) : null;
    const fomc = eventStudy(px, FOMC_DECISIONS.filter((d) => d >= px[0]?.date), 1, 3);
    const sigBound = (n) => 1.96 / Math.sqrt(n);
    return [
      h('div', { class: 'notice', style: 'margin-bottom:14px' }, `${tr('Sample', 'Muestra')}: ${sample} (${px.length} ${tr('daily closes', 'cierres diarios')}). `,
        tr('Correlation is not causation, and historical relationships can break. Crypto returns are joined to weekday macro data on matching dates only.', 'Correlación no implica causalidad y las relaciones históricas pueden romperse. Los retornos cripto se cruzan con datos macro de días laborables solo en fechas coincidentes.')),
      h('div', { class: 'grid g2' },
        panel(tr('Daily return correlation (full sample)', 'Correlación de retornos diarios (muestra completa)'),
          bars(rows.map((r) => ({ label: `${r.label} (n=${r.n})`, value: r.value }))),
          h('p', { class: 'small muted' }, tr(`Approx. 95% significance bound for n≈${rows[0]?.n || 0}: ±${fmtNum(sigBound(rows[0]?.n || 1), 2)}. Values inside it are indistinguishable from zero.`, `Límite aprox. de significancia 95% para n≈${rows[0]?.n || 0}: ±${fmtNum(sigBound(rows[0]?.n || 1), 2)}. Valores dentro no se distinguen de cero.`))),
        panel(h('div', { class: 'controls' }, h('h2', null, tr('Rolling correlation', 'Correlación móvil')), segmented([[30, '30d'], [60, '60d'], [90, '90d']], state.window, (w) => { state.window = w; draw(); })),
          lineChart(rolls, { zero: true, format: (v) => fmtNum(v, 2) }))),
      h('div', { class: 'grid g2', style: 'margin-top:14px' },
        panel(tr('Realized volatility (annualized)', 'Volatilidad realizada (anualizada)'), lineChart([{ name: '30d', points: vol30 }, { name: '90d', points: vol90 }], { format: (v) => fmtPct(v * 100, 0, false) })),
        panel(tr('Conditional returns & event study', 'Retornos condicionales y estudio de eventos'),
          cond ? table(['', 'n', tr('Mean', 'Media'), tr('Hit rate', 'Acierto')], [
            [tr('Days dollar index rose', 'Días con dólar al alza'), cond.whenUp.n, fmtPct(cond.whenUp.mean * 100, 2), fmtPct(cond.whenUp.hitRate * 100, 0, false)],
            [tr('Days dollar index fell', 'Días con dólar a la baja'), cond.whenDown.n, fmtPct(cond.whenDown.mean * 100, 2), fmtPct(cond.whenDown.hitRate * 100, 0, false)]]) : h('div', { class: 'error-box' }, t('unavailable')),
          h('h4', null, tr('FOMC decisions: return from day −1 to day +3', 'Decisiones FOMC: retorno del día −1 al +3')),
          table([tr('Decision date', 'Fecha decisión'), tr('Return', 'Retorno')], fomc.events.map((e) => [e.date, h('span', { class: `num ${signClass(e.ret)}` }, fmtPct(e.ret * 100, 2))])),
          h('p', { class: 'small muted' }, `n=${fomc.n} · ${tr('mean', 'media')} ${fmtPct(fomc.mean * 100, 2)} · ${tr('This is a tiny sample; it measures what happened, not an expected reaction.', 'Muestra muy pequeña: mide lo ocurrido, no una reacción esperada.')}`))),
      h('div', { style: 'margin-top:14px' }, panel(tr('Lead–lag (cross-correlation, macro leads crypto at positive lags)', 'Adelanto–retardo (correlación cruzada; macro adelanta a cripto en lags positivos)'),
        h('div', { class: 'grid g2' }, lead.map((l) => h('div', null, h('b', { class: 'small' }, l.name),
          bars(l.rows.map((r) => ({ label: `lag ${r.lag > 0 ? '+' : ''}${r.lag}d${Math.abs(r.r) > r.bound ? ' *' : ''}`, value: r.r })), { min: -0.5, max: 0.5 })))),
        h('p', { class: 'small muted' }, tr('* exceeds the approximate 95% white-noise bound. With ~7–11 lags tested, about one false positive is expected by chance; do not treat isolated stars as a lead–lag relationship.', '* supera el límite aprox. del 95% para ruido blanco. Al probar ~7–11 lags se espera un falso positivo por azar; no trates estrellas aisladas como relación de adelanto.')))),
      h('div', { class: 'grid g2', style: 'margin-top:14px' }, defiPanel(), adSlot('rectangle')),
    ];
  });
  draw();
  return h('div', null, pageHead(t('nav_cryptomacro'), tr('How crypto has co-moved with macro variables, measured on real data.', 'Cómo se ha movido cripto junto a variables macro, medido con datos reales.'), assetSel), box);
}

function defiPanel() {
  const box = h('div');
  async(box, async () => {
    const d = await api('/api/crypto/defi');
    return [lineChart([{ name: tr('Stablecoin supply (USD)', 'Oferta stablecoins (USD)'), points: d.stablecoins.points || [] }, { name: 'Solana TVL (USD)', points: d.solanaTvl.points || [], axis: 'right' }], { format: fmtCompact, formatRight: fmtCompact }),
      metaLine(d.stablecoins.meta)];
  });
  return panel(tr('Stablecoins & DeFi', 'Stablecoins y DeFi'), box);
}

// ================= MEMECOIN INTELLIGENCE =================
export async function meme() {
  const box = h('div');
  let rules = store('memeRules', null);
  const draw = () => async(box, async () => {
    const d = rules ? await api('/api/meme/regime', { method: 'POST', body: { rules } }) : await api('/api/meme/regime');
    const c = d.classification;
    const editor = h('div', { class: 'grid' }, Object.entries(d.rules).filter(([k]) => !['hardStops', 'minInputs'].includes(k)).map(([k, r]) => h('div', { class: 'controls' },
      h('span', { class: 'small', style: 'flex:1;min-width:180px' }, r.label + (r.invert ? tr(' (lower is better)', ' (menor es mejor)') : '')),
      h('label', { class: 'f' }, tr('good', 'bueno'), h('input', { class: 'input', type: 'number', step: 'any', value: r.good, style: 'width:110px', 'data-k': k, 'data-f': 'good' })),
      h('label', { class: 'f' }, tr('bad', 'malo'), h('input', { class: 'input', type: 'number', step: 'any', value: r.bad, style: 'width:110px', 'data-k': k, 'data-f': 'bad' })))));
    const apply = h('button', { class: 'btn pri', onclick: () => {
      const o = {};
      editor.querySelectorAll('input').forEach((i) => { (o[i.dataset.k] ||= {})[i.dataset.f] = Number(i.value); });
      rules = o; persist('memeRules', o); draw();
    } }, tr('Apply rules', 'Aplicar reglas'));
    const reset = h('button', { class: 'btn', onclick: () => { rules = null; persist('memeRules', null); draw(); } }, tr('Reset defaults', 'Restablecer'));
    const poolRows = (list) => list.map((p) => [h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.name), h('span', { class: 'small' }, p.dex || '—'),
      h('span', { class: 'num' }, p.priceUsd ? fmtUsd(p.priceUsd) : '—'), h('span', { class: 'num' }, '$' + fmtCompact(p.liquidityUsd)), h('span', { class: 'num' }, '$' + fmtCompact(p.volume24h)),
      h('span', { class: `num ${signClass(p.change24h)}` }, fmtPct(p.change24h, 1)), h('span', { class: 'num' }, p.buys24h !== null ? `${p.buys24h}/${p.sells24h}` : '—'), h('span', { class: 'num' }, p.ageHours !== null ? (p.ageHours < 48 ? `${fmtNum(p.ageHours, 0)}h` : `${fmtNum(p.ageHours / 24, 0)}d`) : '—')]);
    const head = [tr('Pool', 'Pool'), 'DEX', tr('Price', 'Precio'), tr('Liquidity', 'Liquidez'), tr('Vol 24h', 'Vol 24h'), '24h', tr('Buys/Sells', 'Compras/Ventas'), tr('Age', 'Edad')];
    return [
      h('div', { class: 'grid g-main' },
        panel(h('div', { class: 'controls' }, h('h2', null, t('regime')), h('span', { class: 'label-rule' }, t('rule_based'))),
          h('div', { class: `regime-big rg-${c.regime}` }, c.regime.replace('_', ' ')),
          h('p', null, c.explanation),
          bars(c.contributions.map((x) => ({ label: `${x.label}: ${x.value === null ? t('unavailable') : fmtNum(x.value, Math.abs(x.value) > 1000 ? 0 : 2)}`, value: x.vote ?? NaN })), { min: -1, max: 1, format: (v) => (v > 0 ? '+1' : v < 0 ? '−1' : '0') }),
          h('p', { class: 'small muted' }, t('meme_disclaimer'))),
        panel(tr('Solana market structure', 'Estructura de mercado Solana'),
          h('div', { class: 'grid g2' },
            kpi('SOL', d.sol ? fmtUsd(d.sol.price) : '—', d.sol ? `7d ${fmtPct(d.sol.change7d)}` : ''),
            kpi(tr('DEX volume 24h', 'Volumen DEX 24h'), d.dex ? '$' + fmtCompact(d.dex.total24h) : '—', d.dex ? `7d ${fmtPct(d.dex.change7d)}` : ''),
            kpi(tr('Priority fee (median)', 'Tarifa prioridad (mediana)'), d.fees ? `${fmtNum(d.fees.median, 0)}` : '—', d.fees ? `p90 ${fmtNum(d.fees.p90, 0)} · ${d.fees.unit}` : t('unavailable')),
            kpi(tr('Stablecoins on Solana', 'Stablecoins en Solana'), d.stablecoins ? '$' + fmtCompact(d.stablecoins.at(-1).value) : '—', d.observations.stablecoinChange30d !== null ? `30d ${fmtPct(d.observations.stablecoinChange30d)}` : '')),
          d.dex ? lineChart([{ name: tr('Solana DEX volume (USD/day)', 'Volumen DEX Solana (USD/día)'), points: d.dex.series }], { format: fmtCompact }) : null,
          h('ul', { class: 'small' }, Object.entries(d.providers).map(([k, v]) => h('li', null, statusBadge(v.ok ? (v.stale ? 'stale' : 'delayed') : 'unavailable'), ` ${k}`, v.error ? h('span', { class: 'down' }, ` — ${v.error}`) : ''))))),
      h('div', { style: 'margin-top:14px' }, panel(tr('Trending Solana pools (GeckoTerminal)', 'Pools en tendencia en Solana (GeckoTerminal)'), d.trendingPools.length ? table(head, poolRows(d.trendingPools)) : h('div', { class: 'error-box' }, t('unavailable')))),
      adSlot('leaderboard'),
      h('div', { style: 'margin-top:14px' }, panel(tr('Newest pools', 'Pools más nuevos'), d.newPools.length ? table(head, poolRows(d.newPools)) : h('div', { class: 'error-box' }, t('unavailable')),
        h('p', { class: 'small muted' }, tr('Brand-new pools carry extreme risk (rug pulls, honeypots, thin liquidity). Listing here is not an endorsement.', 'Los pools nuevos conllevan riesgo extremo (rug pulls, honeypots, liquidez escasa). Aparecer aquí no es una recomendación.')))),
      h('div', { style: 'margin-top:14px' }, panel(tr('Configure rules', 'Configurar reglas'), editor, h('div', { class: 'controls', style: 'margin-top:10px' }, apply, reset),
        h('p', { class: 'small muted' }, tr(`Hard stops: ${JSON.stringify(MEME_DEFAULT_RULES.hardStops)} force DEFENSIVE. At least ${MEME_DEFAULT_RULES.minInputs} inputs are required.`, `Paradas duras: ${JSON.stringify(MEME_DEFAULT_RULES.hardStops)} fuerzan DEFENSIVE. Se requieren al menos ${MEME_DEFAULT_RULES.minInputs} entradas.`)))),
    ];
  });
  draw();
  return h('div', null, pageHead(t('nav_meme'), tr('Market-wide conditions for Solana memecoins, from real observations.', 'Condiciones generales para memecoins de Solana, con observaciones reales.')), box);
}
const kpi = (k, v, d) => h('div', { class: 'kpi' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), h('span', { class: 'd muted' }, d));

// ================= QUANT LAB =================
export async function lab() {
  const f = {
    asset: h('select', { class: 'input' }, [['bitcoin', 'BTC'], ['ethereum', 'ETH'], ['solana', 'SOL'], ['ripple', 'XRP'], ['binancecoin', 'BNB']].map(([v, l]) => h('option', { value: v }, l))),
    strategy: h('select', { class: 'input' }, Object.keys(STRATEGIES).map((k) => h('option', { value: k }, k))),
    params: h('div', { class: 'controls' }),
    cost: h('input', { class: 'input', type: 'number', value: 10, min: 0, max: 500, step: 1, style: 'width:90px' }),
    slip: h('input', { class: 'input', type: 'number', value: 5, min: 0, max: 500, step: 1, style: 'width:90px' }),
    filter: h('select', { class: 'input' }, h('option', { value: '' }, tr('none', 'ninguno')), h('option', { value: 'DTWEXBGS:below_sma' }, tr('Dollar below its 20d SMA', 'Dólar bajo su media 20d')), h('option', { value: 'VIXCLS:below_sma' }, tr('VIX below its 20d SMA', 'VIX bajo su media 20d')), h('option', { value: 'DFII10:below_sma' }, tr('Real yield below 20d SMA', 'Rend. real bajo media 20d'))),
    lag: h('input', { class: 'input', type: 'number', value: 1, min: 0, max: 10, step: 1, style: 'width:70px' }),
    mode: h('select', { class: 'input' }, h('option', { value: 'full' }, tr('Full sample', 'Muestra completa')), h('option', { value: 'split' }, tr('70/30 in/out-of-sample', '70/30 dentro/fuera de muestra')), h('option', { value: 'wf' }, tr('Walk-forward (optimize → test)', 'Walk-forward (optimizar → probar)'))),
  };
  const renderParams = () => f.params.replaceChildren(...Object.entries(STRATEGIES[f.strategy.value].params).map(([k, v]) => h('label', { class: 'f' }, k, h('input', { class: 'input', type: 'number', value: v, 'data-p': k, style: 'width:80px' }))));
  f.strategy.addEventListener('change', renderParams);
  renderParams();
  const out = h('div');
  let last = null;
  const run = () => async(out, async () => {
    const [hist, filt] = await Promise.all([
      api(`/api/markets/history?asset=${f.asset.value}&days=365`),
      f.filter.value ? api(`/api/macro/series?id=${f.filter.value.split(':')[0]}&start=${new Date(Date.now() - 420 * 86400000).toISOString().slice(0, 10)}&transform=none`) : null,
    ]);
    const params = {};
    f.params.querySelectorAll('input').forEach((i) => { params[i.dataset.p] = Number(i.value); });
    const opts = { costBps: clamp(f.cost.value, 0, 500), slippageBps: clamp(f.slip.value, 0, 500), periodsPerYear: 365,
      macroFilter: filt ? { series: filt.points, rule: f.filter.value.split(':')[1], period: 20, publicationLagDays: clamp(f.lag.value, 0, 10) } : null };
    const strategy = { type: f.strategy.value, params };
    const prices = hist.points;
    if (f.mode.value === 'wf') {
      const wf = walkForward(prices, strategy.type, { ...opts, trainBars: 150, testBars: 45 });
      last = { kind: wf.kind, asset: f.asset.value, strategy, opts, wf };
      return [labelNote(hist), wf.metrics ? metricsTable([[tr('Walk-forward OOS', 'Walk-forward fuera de muestra'), wf.metrics]]) : h('div', { class: 'notice' }, tr('Not enough data for walk-forward.', 'Datos insuficientes para walk-forward.')),
        lineChart([{ name: tr('OOS equity', 'Capital fuera de muestra'), points: wf.equity }], { format: (v) => fmtNum(v, 2) }),
        table([tr('Train', 'Entrenamiento'), 'Test', tr('Chosen params', 'Parámetros'), tr('Train Sharpe', 'Sharpe entren.'), tr('Test return', 'Retorno test')], wf.folds.map((x) => [`${x.trainStart} → ${x.trainEnd}`, `${x.testStart} → ${x.testEnd}`, JSON.stringify(x.params), fmtNum(x.trainSharpe, 2), h('span', { class: signClass(x.testReturn) }, fmtPct(x.testReturn * 100))]))];
    }
    if (f.mode.value === 'split') {
      const s = splitTest(prices, strategy, opts);
      last = { kind: 'BACKTEST_SPLIT', asset: f.asset.value, strategy, opts, s };
      return [labelNote(hist), metricsTable([[tr('In-sample', 'Dentro de muestra'), s.inSample.metrics], [tr('In-sample benchmark', 'Referencia dentro'), s.inSample.benchmark], [tr('Out-of-sample', 'Fuera de muestra'), s.outOfSample.metrics], [tr('OOS benchmark', 'Referencia fuera'), s.outOfSample.benchmark]]),
        lineChart([{ name: 'IS', points: s.inSample.equity }, { name: 'OOS', points: s.outOfSample.equity }], { format: (v) => fmtNum(v, 2) })];
    }
    const r = runBacktest(prices, strategy, opts);
    last = { kind: r.kind, asset: f.asset.value, strategy, opts, r };
    return [labelNote(hist), r.filterCoverage !== null ? h('p', { class: 'small muted' }, `${tr('Macro filter data coverage', 'Cobertura del filtro macro')}: ${fmtPct(r.filterCoverage * 100, 0, false)} ${tr('(bars without published data are flat)', '(barras sin dato publicado quedan fuera)')}`) : null,
      metricsTable([[tr('Strategy', 'Estrategia'), r.metrics], [tr('Buy & hold benchmark', 'Referencia comprar y mantener'), r.benchmark]]),
      lineChart([{ name: tr('Strategy equity', 'Capital estrategia'), points: r.equity }, { name: 'Buy & hold', points: r.benchEq, dashed: true }], { format: (v) => fmtNum(v, 2) }),
      h('h4', null, `${tr('Trades', 'Operaciones')} (${r.trades.length})`),
      table([tr('Entry', 'Entrada'), tr('Entry px', 'Precio ent.'), tr('Exit', 'Salida'), tr('Exit px', 'Precio sal.'), tr('Return', 'Retorno')], r.trades.map((x) => [x.entryDate, fmtUsd(x.entryPrice), x.exitDate || tr('open', 'abierta'), fmtUsd(x.exitPrice), h('span', { class: signClass(x.ret) }, fmtPct(x.ret * 100))]))];
  });
  const saveBtn = h('button', { class: 'btn', onclick: () => {
    if (!last) return;
    const list = store('experiments', []);
    list.unshift({ name: `${last.asset} ${last.strategy.type} ${new Date().toISOString().slice(0, 16)}`, asset: last.asset, strategy: last.strategy, opts: { ...last.opts, macroFilter: last.opts.macroFilter ? { rule: last.opts.macroFilter.rule, publicationLagDays: last.opts.macroFilter.publicationLagDays } : null }, kind: last.kind, metrics: last.r?.metrics || last.wf?.metrics || last.s?.outOfSample.metrics, savedAt: new Date().toISOString() });
    persist('experiments', list.slice(0, 100));
    saveBtn.textContent = t('saved_ok');
  } }, t('save'));
  const exportBtn = h('button', { class: 'btn', onclick: () => {
    if (!last) return;
    if (last.r) download(`void-backtest-${last.asset}.csv`, toCSV(last.r), 'text/csv');
    download(`void-research-${last.asset}.json`, JSON.stringify({ ...last, r: last.r ? { ...last.r, returns: undefined } : undefined, exportedAt: new Date().toISOString(), label: 'BACKTESTED — not paper or live results' }, null, 2), 'application/json');
  } }, tr('Export CSV/JSON', 'Exportar CSV/JSON'));
  return h('div', null,
    pageHead(t('nav_lab'), t('lab_note')),
    h('div', { class: 'grid g-main' },
      panel(tr('Results', 'Resultados'), out),
      panel(tr('Experiment', 'Experimento'), h('div', { class: 'grid' },
        h('label', { class: 'f' }, tr('Asset', 'Activo'), f.asset), h('label', { class: 'f' }, tr('Strategy', 'Estrategia'), f.strategy), f.params,
        h('div', { class: 'controls' }, h('label', { class: 'f' }, tr('Fee (bps/side)', 'Comisión (pb/lado)'), f.cost), h('label', { class: 'f' }, tr('Slippage (bps)', 'Deslizamiento (pb)'), f.slip)),
        h('label', { class: 'f' }, tr('Macro filter (optional)', 'Filtro macro (opcional)'), f.filter), h('label', { class: 'f' }, tr('Publication lag (days)', 'Retraso de publicación (días)'), f.lag),
        h('label', { class: 'f' }, tr('Evaluation', 'Evaluación'), f.mode),
        h('div', { class: 'controls' }, h('button', { class: 'btn pri', onclick: run }, t('run')), saveBtn, exportBtn),
        h('p', { class: 'small muted' }, tr('Signals use only data up to each close and trade on the next bar. Long/flat only. Sample limited to the last 365 days of daily closes (free CoinGecko tier). No survivorship adjustment is needed for single-asset tests, but asset choice itself is a selection bias.', 'Las señales usan solo datos hasta cada cierre y operan en la barra siguiente. Solo largo/fuera. Muestra limitada a 365 días (CoinGecko gratuito). La elección del activo es en sí un sesgo de selección.'))))));
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const labelNote = (hist) => h('div', { class: 'controls', style: 'margin-bottom:8px' }, h('span', { class: 'badge st-estimated' }, 'BACKTEST'), h('span', { class: 'small muted' }, `${hist.points[0]?.date} → ${hist.points.at(-1)?.date} · ${hist.points.length} ${tr('daily closes', 'cierres diarios')} · CoinGecko`));
function metricsTable(rows) {
  const pct = (v) => (v === null || v === undefined ? '—' : fmtPct(v * 100));
  const upct = (v) => (v === null || v === undefined ? '—' : fmtPct(v * 100, 1, false));
  const n2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? (v === Infinity ? '∞' : '—') : fmtNum(v, 2));
  return table(['', tr('Total', 'Total'), tr('Annualized', 'Anualizado'), 'Max DD', 'Sharpe', 'Sortino', tr('Win rate', 'Acierto'), 'PF', tr('Avg trade', 'Media op.'), tr('Exposure', 'Exposición'), tr('Trades', 'Ops.'), 'Obs'],
    rows.map(([name, m]) => [h('b', null, name), h('span', { class: signClass(m.totalReturn) }, pct(m.totalReturn)), m.annualizedReturn === null ? h('span', { class: 'muted', title: tr('Not annualized: sample shorter than 1 year', 'No anualizado: muestra < 1 año') }, 'n/a') : pct(m.annualizedReturn),
      pct(m.maxDrawdown), n2(m.sharpe), n2(m.sortino), m.winRate === null ? '—' : upct(m.winRate), n2(m.profitFactor), m.avgTrade === null ? '—' : pct(m.avgTrade), m.exposure === undefined ? '—' : upct(m.exposure), m.trades, m.observations]));
}
