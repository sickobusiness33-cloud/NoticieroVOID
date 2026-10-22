// Views: newsroom, command center, macro, intel feed, AI analyst, calendar, saved, status.
import { t, tr, getLang } from './i18n.js';
import { h, api, async, panel, metaLine, statusBadge, fmtNum, fmtUsd, fmtPct, fmtCompact, fmtTime, ago, signClass, table, segmented, store, persist } from './ui.js';
import { lineChart, sliceRange, bars } from './charts.js';
import { adSlot } from './ads.js';

const pageHead = (title, sub, ...right) => h('div', { class: 'page-h' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'controls' }, ...right));
const CATS = ['central-banks', 'inflation', 'labor', 'growth', 'rates-bonds', 'fx-dollar', 'geopolitics', 'regulation', 'etf-flows', 'defi', 'stablecoins', 'memecoins', 'markets'];
const CAT_ES = { 'central-banks': 'bancos centrales', inflation: 'inflación', labor: 'empleo', growth: 'crecimiento', 'rates-bonds': 'tipos y bonos', 'fx-dollar': 'divisas/dólar', geopolitics: 'geopolítica', regulation: 'regulación', 'etf-flows': 'flujos ETF', defi: 'DeFi', stablecoins: 'stablecoins', memecoins: 'memecoins', markets: 'mercados', general: 'general' };
const catName = (c) => (getLang() === 'es' ? CAT_ES[c] || c : c.replace('-', ' '));

// ---------- saved articles (per browser) ----------
const savedList = () => store('saved', []);
function toggleSave(item, btn) {
  const list = savedList();
  const i = list.findIndex((x) => x.url === item.url);
  if (i >= 0) list.splice(i, 1); else list.unshift({ id: item.id, url: item.url, title: item.title, source: item.source, publishedAt: item.publishedAt, lang: item.lang, savedAt: new Date().toISOString() });
  persist('saved', list.slice(0, 300));
  if (btn) btn.textContent = i >= 0 ? t('save') : t('saved_ok');
}

function storyNode(it, { excerpt = true, ai = true } = {}) {
  const box = h('div');
  const isSaved = savedList().some((x) => x.url === it.url);
  const saveBtn = h('button', { class: 'btn sm', onclick: (e) => toggleSave(it, e.currentTarget) }, isSaved ? t('saved_ok') : t('save'));
  const aiBtn = ai ? h('button', { class: 'btn sm', onclick: () => analyzeInto(it, box, aiBtn) }, t('analyze')) : null;
  return h('article', { class: 'story' },
    h('div', { class: 'by' }, it.breaking ? h('span', { class: 'tag hot' }, t('breaking')) : null, it.official ? h('span', { class: 'tag vio' }, tr('OFFICIAL', 'OFICIAL')) : null,
      h('b', null, it.source), h('span', { title: it.publishedAt }, ago(it.publishedAt)), h('span', { class: 'tag' }, it.lang.toUpperCase())),
    h('h3', null, h('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.title)),
    excerpt && it.excerpt ? h('p', null, it.excerpt) : null,
    h('div', null, it.categories.filter((c) => c !== 'general').slice(0, 3).map((c) => h('a', { class: 'tag', href: `#/news?category=${c}` }, catName(c))), it.assets.slice(0, 4).map((a) => h('span', { class: 'tag vio' }, a))),
    it.alsoReportedBy?.length ? h('div', { class: 'by' }, `${t('also')}: `, it.alsoReportedBy.slice(0, 4).map((r) => h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.source))) : null,
    h('div', { class: 'story-actions' }, h('a', { class: 'btn sm', href: it.url, target: '_blank', rel: 'noopener', style: 'margin-left:0' }, `${t('read_at')} ${it.source} ↗`), saveBtn, aiBtn),
    box);
}

async function analyzeInto(it, box, btn) {
  btn.disabled = true;
  box.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin' }), t('loading')));
  try {
    const r = await api('/api/news/analyze', { method: 'POST', body: { id: it.id, lang: getLang() } });
    const a = r.analysis;
    const list = (xs) => h('ul', null, (xs || []).map((x) => h('li', null, x)));
    box.replaceChildren(h('div', { class: 'ai-box' },
      h('span', { class: 'label-ai' }, t('ai_generated')), ' ', h('span', { class: 'small muted' }, `${r.model} · ${t('confidence')}: ${a.confidence}`),
      h('h4', null, tr('Reported (from headline/excerpt)', 'Lo informado (titular/extracto)')), h('p', null, a.facts.whatHappened),
      h('h4', null, tr('Versus expectations', 'Frente a expectativas')), h('p', null, a.analysis.vsExpectations),
      h('h4', null, tr('Why it matters', 'Por qué importa')), h('p', null, a.analysis.whyItMatters),
      h('h4', null, tr('Markets possibly affected', 'Mercados posiblemente afectados')), list(a.analysis.marketsAffected),
      h('h4', null, t('evidence')), list(a.analysis.supportingEvidence),
      h('h4', null, t('invalidation')), list(a.analysis.invalidation),
      h('p', { class: 'small muted' }, `${t('limitations')}: ${a.limitations}`),
      h('details', null, h('summary', { class: 'small' }, tr('Evidence pack sent to the model', 'Evidencia enviada al modelo')), list(r.evidence.map((e) => `[${e.id}] ${e.text}`)))));
  } catch (e) {
    box.replaceChildren(h('div', { class: 'notice warn' }, e.code === 'ai_not_configured' ? t('ai_off') : e.message));
  } finally { btn.disabled = false; }
}

// ================= NEWSROOM HOME =================
export async function home() {
  const lang = getLang();
  const root = h('div');
  const heroBox = h('div'), latestBox = h('div'), sideBox = h('div'), macroBox = h('div');
  root.append(
    h('div', { class: 'hero' }, heroBox, h('div', null, panel(t('markets'), sideBox))),
    h('div', { class: 'grid g-main', style: 'margin-top:14px' },
      panel(t('latest_news'), latestBox),
      h('div', { class: 'grid' }, panel(t('macro_snapshot'), macroBox), adSlot('rectangle'), panel(tr('Explore the terminal', 'Explora la terminal'), h('div', { class: 'grid' },
        ...[['terminal', 'nav_terminal'], ['analyst', 'nav_analyst'], ['liquidity', 'nav_liquidity'], ['memecoins', 'nav_meme'], ['lab', 'nav_lab'], ['calendar', 'nav_calendar']].map(([r, k]) => h('a', { class: 'card', href: `#/${r}` }, h('b', null, t(k)), ' →')))))),
  );
  async(heroBox, async () => {
    const d = await api(`/api/news?lang=${lang}&limit=60`);
    const items = d.items;
    if (!items.length) return h('div', { class: 'notice' }, t('no_data'));
    // Source diversity: at most two top stories per publisher.
    const perSource = {};
    const diverse = items.filter((i) => (perSource[i.source] = (perSource[i.source] || 0) + 1) <= 2);
    const lead = diverse[0];
    const rest = diverse.slice(1, 6);
    async(latestBox, async () => {
      const recent = (await api(`/api/news?lang=${lang}&limit=40&sort=time`)).items;
      const nodes = recent.slice(0, 24).map((i) => storyNode(i));
      nodes.splice(8, 0, adSlot('leaderboard'));
      return [...nodes, metaLine(d.meta)];
    });
    return h('div', { class: 'grid' },
      // Original VOID artwork instead of hot-linking publisher images.
      h('div', { class: 'lead' }, h('div', { class: 'lead-art', 'aria-hidden': 'true' }),
        h('div', { class: 'lead-b' }, h('div', { class: 'by' }, lead.breaking ? h('span', { class: 'tag hot' }, t('breaking')) : null, h('b', null, lead.source), h('span', null, ago(lead.publishedAt))),
          h('h2', null, h('a', { href: lead.url, target: '_blank', rel: 'noopener' }, lead.title)), h('p', { class: 'muted' }, lead.excerpt))),
      panel(t('top_stories'), ...rest.map((i) => storyNode(i, { excerpt: false }))));
  });
  async(sideBox, async () => {
    const d = await api(`/api/markets/overview?lang=${lang}`);
    const rows = d.crypto.rows.slice(0, 10).map((r) => [h('span', null, h('b', null, r.symbol), ' ', h('span', { class: 'muted small' }, r.name)), h('span', { class: 'num' }, fmtUsd(r.price)), h('span', { class: `num ${signClass(r.change24h)}` }, fmtPct(r.change24h))]);
    return [table(['', tr('Price', 'Precio'), '24h'], rows), metaLine(d.crypto.meta)];
  });
  async(macroBox, async () => {
    const d = await api(`/api/markets/overview?lang=${lang}`);
    const pick = d.tradfi.filter((x) => x.latest).slice(0, 8);
    return [h('div', { class: 'grid g2' }, pick.map((x) => h('a', { class: 'kpi', href: `#/macro/${x.id}` },
      h('span', { class: 'k' }, x.name), h('span', { class: 'v' }, fmtNum(x.latest.value, 2)), h('span', { class: 'd muted' }, `${x.unit} · ${x.latest.date}`)))),
    h('div', { class: 'meta' }, statusBadge('delayed'), 'FRED · ', tr('end-of-day values, not real-time', 'valores de cierre, no en tiempo real'))];
  });
  return root;
}

// ================= COMMAND CENTER =================
const DEFAULT_WATCH = ['bitcoin', 'ethereum', 'solana', 'ripple', 'binancecoin', 'dogecoin'];
export async function terminal() {
  const lang = getLang();
  const root = h('div');
  const cryptoBox = h('div'), tradBox = h('div'), chartBox = h('div'), derivBox = h('div'), regimeBox = h('div'), globalBox = h('div', { class: 'grid g4' });
  let watch = store('watch', DEFAULT_WATCH);
  const addInput = h('input', { class: 'input', placeholder: 'coingecko id (e.g. chainlink)', 'aria-label': t('add') });
  root.append(
    pageHead(t('nav_terminal'), t('sub'), addInput, h('button', { class: 'btn', onclick: () => {
      const v = addInput.value.trim().toLowerCase();
      if (/^[a-z0-9-]{2,60}$/.test(v) && !watch.includes(v)) { watch = [...watch, v]; persist('watch', watch); renderCrypto(); }
      addInput.value = '';
    } }, `+ ${t('watchlist')}`)),
    globalBox,
    h('div', { class: 'grid g2', style: 'margin-top:14px' }, panel(`${t('watchlist')} — crypto`, cryptoBox), panel(tr('Rates, FX, equities, volatility', 'Tipos, divisas, acciones, volatilidad'), tradBox)),
    h('div', { style: 'margin-top:14px' }, panel(tr('Chart', 'Gráfico'), chartBox)),
    h('div', { class: 'grid g2', style: 'margin-top:14px' }, panel(tr('Derivatives (OKX perpetuals)', 'Derivados (perpetuos OKX)'), derivBox), panel(`${t('regime')} — macro`, regimeBox)),
  );
  let overview;
  const load = async () => (overview ||= await api(`/api/markets/overview?lang=${lang}`));
  const renderCrypto = () => async(cryptoBox, async () => {
    const d = await api(`/api/markets/overview?lang=${lang}`);
    const rows = d.crypto.rows.filter((r) => watch.includes(r.id));
    const missing = watch.filter((w) => !d.crypto.rows.some((r) => r.id === w));
    return [table(['', tr('Price', 'Precio'), '1h', '24h', '7d', tr('Mkt cap', 'Capitaliz.'), ''], rows.map((r) => [
      h('button', { class: 'btn sm', style: 'margin:0', onclick: () => showChart(r.id, r.name) }, r.symbol), h('span', { class: 'num' }, fmtUsd(r.price)),
      h('span', { class: `num ${signClass(r.change1h)}` }, fmtPct(r.change1h)), h('span', { class: `num ${signClass(r.change24h)}` }, fmtPct(r.change24h)),
      h('span', { class: `num ${signClass(r.change7d)}` }, fmtPct(r.change7d)), h('span', { class: 'num' }, fmtCompact(r.marketCap)),
      h('button', { class: 'btn sm', 'aria-label': t('remove'), onclick: () => { watch = watch.filter((w) => w !== r.id); persist('watch', watch); renderCrypto(); } }, '×')])),
    missing.length ? h('p', { class: 'small muted' }, tr('Not in top-50 market list (not shown): ', 'Fuera del top 50 (no se muestran): '), missing.join(', ')) : null,
    metaLine(d.crypto.meta)];
  });
  renderCrypto();
  async(globalBox, async () => {
    const d = await load();
    const g = d.global;
    if (!g.totalMarketCap) return h('div', { class: 'error-box' }, tr('Global stats unavailable', 'Datos globales no disponibles'));
    const k = (label, v, d2) => panel(null, h('div', { class: 'kpi' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, v), d2), metaLine(g.meta));
    return [
      k(tr('Crypto market cap', 'Capitalización cripto'), '$' + fmtCompact(g.totalMarketCap), h('span', { class: `d ${signClass(g.marketCapChange24h)}` }, fmtPct(g.marketCapChange24h) + ' 24h')),
      k(tr('24h volume', 'Volumen 24h'), '$' + fmtCompact(g.totalVolume), null),
      k(tr('BTC dominance', 'Dominancia BTC'), fmtPct(g.btcDominance, 1, false), null),
      k(tr('Gold (PAXG proxy)', 'Oro (proxy PAXG)'), d.goldProxy.price ? fmtUsd(d.goldProxy.price) : '—', h('span', { class: 'd' }, statusBadge(d.goldProxy.meta.status), ' ', h('span', { class: 'small muted', title: d.goldProxy.meta.note }, tr('token proxy, not spot', 'proxy de token, no spot')))),
    ];
  });
  async(tradBox, async () => {
    const d = await load();
    return table([tr('Indicator', 'Indicador'), t('latest'), t('change'), t('observed'), ''], d.tradfi.map((x) => x.latest
      ? [h('a', { href: `#/macro/${x.id}` }, x.name), h('span', { class: 'num' }, `${fmtNum(x.latest.value, 2)} ${x.unit === '%' ? '%' : ''}`), h('span', { class: `num ${signClass(x.change)}` }, fmtNum(x.change, 2)), h('span', { class: 'num small' }, x.latest.date), statusBadge(x.meta.status)]
      : [x.id, '—', '—', '—', statusBadge('unavailable')]));
  });
  let range = '1y';
  const showChart = (id, name) => async(chartBox, async () => {
    const d = await api(`/api/markets/history?asset=${id}&days=365`);
    const pts = d.points;
    return [h('div', { class: 'controls' }, h('b', null, name), segmented([['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['1y', '1Y']], range, (r) => { range = r; showChart(id, name); })),
      lineChart([{ name: `${name} (USD)`, points: sliceRange(pts, range) }], { format: (v) => fmtCompact(v) }), metaLine(d.meta)];
  });
  showChart('bitcoin', 'Bitcoin');
  async(derivBox, async () => {
    const d = await api('/api/crypto/derivatives');
    return [table([tr('Contract', 'Contrato'), tr('Funding (per 8h)', 'Funding (cada 8h)'), tr('Open interest', 'Interés abierto'), tr('Next funding', 'Próximo funding')], d.rows.map((r) => [
      r.instId, h('span', { class: `num ${signClass(r.fundingRate)}` }, fmtPct(r.fundingRate * 100, 4)), h('span', { class: 'num' }, '$' + fmtCompact(r.openInterestUsd)), h('span', { class: 'small' }, fmtTime(r.nextFundingTime))])), metaLine(d.meta)];
  });
  async(regimeBox, () => regimeNode());
  return root;
}

export async function regimeNode() {
  const r = await api('/api/macro/regime');
  return h('div', null, h('span', { class: 'label-rule' }, t('rule_based')),
    r.dimensions.map((d) => h('div', { class: 'dim' },
      h('div', { class: 'dim-h' }, h('b', null, d.key.replace(/([A-Z])/g, ' $1')), h('span', null, h('b', { class: 'mono' }, d.label), ' · ', h('span', { class: 'muted small' }, `${t('confidence')}: ${d.confidence}`))),
      h('ul', null, d.evidence.map((e) => h('li', null, `${e.label}: ${fmtNum(e.latest.value, 2)} (${e.latest.date})`, e.comparison ? ` vs ${fmtNum(e.comparison.value, 2)} (${e.comparison.date})` : ''))))),
    r.missingInputs?.length ? h('p', { class: 'small down' }, `Missing: ${r.missingInputs.join(', ')}`) : null,
    h('p', { class: 'small muted' }, tr('Thresholds are documented in public/js/shared/regime.js. Mixed signals are reported as such.', 'Los umbrales están documentados en public/js/shared/regime.js. Las señales mixtas se indican como tales.')));
}

// ================= MACRO =================
const GROUPS = [['policy', 'Central banks', 'Bancos centrales'], ['inflation', 'Inflation', 'Inflación'], ['growth', 'Growth', 'Crecimiento'], ['labor', 'Labor', 'Empleo'], ['rates', 'Rates & curve', 'Tipos y curva'], ['funding', 'Funding', 'Financiación'], ['liquidity', 'Liquidity', 'Liquidez'], ['credit', 'Credit & conditions', 'Crédito y condiciones'], ['fx', 'Dollar', 'Dólar'], ['commodities', 'Commodities', 'Materias primas'], ['equities', 'Equities', 'Acciones'], ['risk', 'Volatility', 'Volatilidad']];

const IMPLICATIONS = {
  policy: ['Higher policy rates raise the discount rate and the opportunity cost of holding non-yielding assets; cuts work the other way. Market reaction depends on the surprise versus expectations, not the level.', 'Tipos oficiales más altos elevan la tasa de descuento y el coste de oportunidad de activos sin rendimiento; los recortes actúan al revés. La reacción depende de la sorpresa frente a lo esperado.'],
  inflation: ['Inflation running above target tends to keep central banks restrictive; sustained disinflation creates room for easing. Monthly data are revised and noisy.', 'Una inflación por encima del objetivo suele mantener a los bancos centrales restrictivos; la desinflación sostenida abre espacio para relajar. Los datos mensuales se revisan y son ruidosos.'],
  growth: ['Growth surprises shift earnings expectations and policy paths. A single quarter rarely defines a trend.', 'Las sorpresas de crecimiento cambian expectativas de beneficios y de política. Un solo trimestre rara vez define una tendencia.'],
  labor: ['Labor-market cooling is a key input for the Fed. Rising unemployment has historically accompanied slowdowns, but thresholds are not reliable predictors.', 'El enfriamiento laboral es clave para la Fed. El aumento del desempleo ha acompañado históricamente a desaceleraciones, pero los umbrales no son predictores fiables.'],
  rates: ['Yields and curve shape summarize expected policy and term premia. Inversions have preceded past recessions with long and variable lags.', 'Los rendimientos y la forma de la curva resumen la política esperada y la prima a plazo. Las inversiones han precedido recesiones con retrasos largos y variables.'],
  funding: ['Short-term funding rates reflect money-market conditions; spikes can signal reserve scarcity.', 'Los tipos de financiación a corto plazo reflejan condiciones del mercado monetario; los picos pueden indicar escasez de reservas.'],
  liquidity: ['Central-bank balance sheets, TGA and reverse repo balances affect bank reserves. Their link to asset prices is debated and unstable over time.', 'Los balances de bancos centrales, la TGA y el repo inverso afectan a las reservas bancarias. Su relación con los precios de activos es debatida e inestable.'],
  credit: ['Widening credit spreads and tighter financial conditions typically accompany risk aversion.', 'Diferenciales de crédito más amplios y condiciones financieras más estrictas suelen acompañar a la aversión al riesgo.'],
  fx: ['A stronger dollar tightens global financial conditions; it has often coincided with weaker crypto and EM assets, though not consistently.', 'Un dólar más fuerte endurece las condiciones financieras globales; a menudo ha coincidido con cripto y emergentes más débiles, aunque no siempre.'],
  commodities: ['Oil feeds into headline inflation and inflation expectations with a lag.', 'El petróleo se traslada a la inflación general y a las expectativas con retraso.'],
  equities: ['Equity indices reflect growth and discount-rate expectations; correlations with crypto vary by regime.', 'Los índices bursátiles reflejan crecimiento y tasas de descuento; su correlación con cripto varía según el régimen.'],
  risk: ['Implied volatility measures the price of protection; elevated VIX coincides with risk-off episodes.', 'La volatilidad implícita mide el precio de la protección; un VIX elevado coincide con episodios de aversión al riesgo.'],
};

export async function macro({ params }) {
  if (params[0]) return macroDetail(params[0]);
  const lang = getLang();
  const root = h('div', null, pageHead(t('nav_macro'), tr('Official statistics: latest published value, previous value, history and context.', 'Estadísticas oficiales: último valor publicado, anterior, historia y contexto.')));
  const box = h('div');
  root.append(box);
  async(box, async () => {
    const { indicators } = await api(`/api/macro/indicators?lang=${lang}`);
    return GROUPS.map(([g, en, es]) => {
      const list = indicators.filter((i) => i.group === g || (!i.group && false));
      if (!list.length) return null;
      return h('div', { style: 'margin-bottom:14px' }, panel(tr(en, es), h('p', { class: 'small muted', style: 'margin-top:0' }, tr(...IMPLICATIONS[g])), h('div', { class: 'cards' }, list.map((i) => h('a', { class: 'card', href: `#/macro/${i.id}` },
        h('div', { class: 'kpi' }, h('span', { class: 'k' }, i.name), h('span', { class: 'v' }, i.latest ? fmtNum(i.latest.value, 2) : '—'),
          i.latest ? h('span', { class: `d ${signClass(i.change)}` }, `${t('previous')}: ${i.previous ? fmtNum(i.previous.value, 2) : '—'}  (${i.change >= 0 ? '+' : ''}${fmtNum(i.change, 2)})`) : null,
          h('span', { class: 'd muted' }, `${i.unit || ''} · ${i.frequency || ''}`)),
        h('div', { class: 'meta' }, statusBadge(i.meta.status), i.latest ? `${t('observed')}: ${i.latest.date}` : (i.meta.error || '')))))));
    });
  });
  return root;
}

async function macroDetail(id) {
  const lang = getLang();
  const root = h('div');
  const box = h('div');
  root.append(pageHead(id, h('a', { href: '#/macro' }, '← Macro')), box);
  let range = '5y';
  const draw = () => async(box, async () => {
    const [{ indicators }, s] = await Promise.all([api(`/api/macro/indicators?lang=${lang}`), api(`/api/macro/series?id=${encodeURIComponent(id)}&start=1990-01-01`)]);
    const ind = indicators.find((i) => i.id === id);
    root.querySelector('h1').textContent = ind?.name || id;
    const pts = sliceRange(s.points, range);
    return h('div', { class: 'grid g-main' },
      panel(h('div', { class: 'controls' }, h('h2', null, ind?.name || id), segmented([['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y'], ['10y', '10Y'], ['max', 'MAX']], range, (r) => { range = r; draw(); })),
        lineChart([{ name: `${ind?.name || id} (${s.meta.unit})`, points: pts }], { zero: true, maxGapDays: s.catalog.freq === 'daily' ? 10 : 400 }), metaLine({ ...s.meta, sourceUrl: `https://fred.stlouisfed.org/series/${id}` })),
      panel(tr('Context', 'Contexto'), ind?.latest ? h('div', { class: 'grid' },
        h('div', { class: 'grid g2' },
          kv(t('latest'), `${fmtNum(ind.latest.value, 3)} ${ind.unit}`, ind.latest.date), kv(t('previous'), ind.previous ? `${fmtNum(ind.previous.value, 3)}` : '—', ind.previous?.date),
          kv(tr('5y percentile', 'Percentil 5 años'), fmtNum(ind.context.percentile5y * 100, 0) + '%'), kv(tr('5y range', 'Rango 5 años'), `${fmtNum(ind.context.min5y, 2)} – ${fmtNum(ind.context.max5y, 2)}`),
          kv(t('frequency'), ind.frequency), kv(t('unit'), ind.unit)),
        h('p', { class: 'small muted' }, tr(...IMPLICATIONS[ind.group] || ['', ''])),
        h('p', { class: 'small muted' }, ind.meta.note),
        metaLine(ind.meta)) : h('div', { class: 'notice' }, t('no_data'))));
  });
  draw();
  return root;
}
const kv = (k, v, sub) => h('div', { class: 'kpi' }, h('span', { class: 'k' }, k), h('span', { class: 'v', style: 'font-size:16px' }, v), sub ? h('span', { class: 'd muted' }, sub) : null);

// ================= INTEL FEED =================
export async function newsFeed({ query }) {
  const state = { lang: query.get('lang') || getLang(), category: query.get('category') || '', q: query.get('q') || '', sort: 'relevance', archive: false };
  const list = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: t('search'), value: state.q, 'aria-label': t('search') });
  const cat = h('select', { class: 'input', 'aria-label': t('category') }, h('option', { value: '' }, `${t('category')}: ${t('all')}`), CATS.map((c) => h('option', { value: c, selected: c === state.category ? true : null }, catName(c))));
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; load(); }, 300); });
  cat.addEventListener('change', () => { state.category = cat.value; load(); });
  const archiveToggle = h('label', { class: 'small muted' }, h('input', { type: 'checkbox', onchange: (e) => { state.archive = e.target.checked; load(); } }), ' ', tr('Search archive (D1)', 'Buscar en archivo (D1)'));
  const load = () => async(list, async () => {
    if (state.archive) {
      const d = await api(`/api/news/archive?q=${encodeURIComponent(state.q)}&lang=${state.lang}&limit=60`);
      return d.items.length ? d.items.map((i) => storyNode({ ...i, alsoReportedBy: [] }, { ai: false })) : h('div', { class: 'notice' }, t('no_data'));
    }
    const p = new URLSearchParams({ lang: state.lang, q: state.q, limit: '100', sort: state.sort });
    if (state.category) p.set('category', state.category);
    const d = await api(`/api/news?${p}`);
    const failed = d.feeds.filter((f) => !f.ok);
    const nodes = d.items.map((i) => storyNode(i));
    for (let k = 10; k < nodes.length; k += 15) nodes.splice(k, 0, adSlot('leaderboard'));
    return [failed.length ? h('div', { class: 'notice warn' }, tr('Some feeds failed: ', 'Algunos feeds fallaron: '), failed.map((f) => f.source).join(', ')) : null,
      ...(nodes.length ? nodes : [h('div', { class: 'notice' }, t('no_data'))]), metaLine(d.meta)];
  });
  load();
  return h('div', null,
    pageHead(t('nav_news'), tr('Aggregated from official institutions and publishers. Headlines and short excerpts only — always read the original.', 'Agregado de instituciones oficiales y medios. Solo titulares y extractos breves: lee siempre el original.'),
      search, cat,
      segmented([['all', t('all')], ['en', 'EN'], ['es', 'ES']], state.lang, (v) => { state.lang = v; load(); }),
      segmented([['relevance', t('sort_rel')], ['time', t('sort_time')]], state.sort, (v) => { state.sort = v; load(); }), archiveToggle),
    h('div', { class: 'grid g-main' }, panel(null, list), h('div', null, adSlot('rectangle'), panel(tr('How ranking works', 'Cómo se ordena'), h('p', { class: 'small muted' },
      tr('Score = recency decay (18h half-scale) + 0.25 if macro category + 0.3 if official source + 0.1 per corroborating outlet (max 0.3). Near-duplicate headlines (Jaccard ≥ 0.6) are merged; the earliest report is shown.',
        'Puntuación = decaimiento por antigüedad (escala 18h) + 0,25 si es macro + 0,3 si es fuente oficial + 0,1 por medio que corrobora (máx. 0,3). Los titulares casi duplicados (Jaccard ≥ 0,6) se agrupan; se muestra el primero.'))))));
}

// ================= AI ANALYST =================
export async function analyst({ app }) {
  const lang = getLang();
  const out = h('div'), regimeBox = h('div');
  const q = h('textarea', { class: 'input', rows: 2, placeholder: t('ask_ph'), maxlength: 500, 'aria-label': t('ask') });
  const runBtn = h('button', { class: 'btn pri', onclick: async () => {
    runBtn.disabled = true;
    await async(out, async () => reportNode(await api('/api/ai/report', { method: 'POST', body: { question: q.value, lang } })));
    runBtn.disabled = false;
  } }, t('run'));
  const root = h('div', null,
    pageHead(t('nav_analyst'), tr('Reasoning over retrieved data only. Every claim cites the evidence pack.', 'Razonamiento solo sobre datos obtenidos. Cada afirmación cita la evidencia.')),
    app.config?.ai ? null : h('div', { class: 'notice warn', style: 'margin-bottom:14px' }, t('ai_off')),
    h('div', { class: 'grid g-main' },
      h('div', { class: 'grid' }, app.config?.ai ? panel(t('ask'), q, h('div', { class: 'controls', style: 'margin-top:8px' }, runBtn, h('button', { class: 'btn', onclick: () => async(out, async () => reportNode(await api(`/api/ai/briefing?lang=${lang}`))) }, t('gen_briefing')))) : null, out),
      panel(`${t('regime')} — ${tr('rule-based baseline', 'línea base por reglas')}`, regimeBox)));
  async(regimeBox, () => regimeNode());
  if (app.config?.ai) async(out, async () => reportNode(await api(`/api/ai/briefing?lang=${lang}`)));
  return root;
}

function reportNode(r) {
  const rep = r.report;
  const list = (xs) => h('ul', null, (xs || []).map((x) => h('li', null, x)));
  const es = rep.executiveSummary || {}, ra = rep.regimeAnalysis || {};
  return h('div', { class: 'grid' },
    panel(h('div', { class: 'controls' }, h('h2', null, t('exec_summary')), h('span', { class: 'label-ai' }, t('ai_generated'))),
      h('p', null, h('b', null, `${t('regime')}: `), es.regime),
      h('h4', null, tr('Key developments', 'Novedades clave')), list(es.keyDevelopments), h('h4', null, tr('Shifts in expectations', 'Cambios de expectativas')), list(es.expectationShifts),
      h('h4', null, tr('Upcoming catalysts', 'Próximos catalizadores')), list(es.upcomingCatalysts), h('h4', null, tr('Principal risks', 'Riesgos principales')), list(es.principalRisks),
      h('p', { class: 'small muted' }, `${r.model} · ${fmtTime(r.generatedAt)}`)),
    panel(t('regime_analysis'), h('div', { class: 'grid g2' }, Object.entries(ra).filter(([k]) => k !== 'mixedSignals').map(([k, v]) => h('div', null, h('b', { class: 'small' }, k), h('p', { class: 'small' }, v)))), ra.mixedSignals?.length ? [h('h4', null, tr('Mixed signals', 'Señales mixtas')), list(ra.mixedSignals)] : null),
    panel(t('scenarios'), h('div', { class: 'grid g3' }, (rep.scenarios || []).map((s) => h('div', { class: 'card', style: 'cursor:default' },
      h('b', { class: s.name === 'bullish' ? 'up' : s.name === 'bearish' ? 'down' : '' }, s.name.toUpperCase()), ` · ${t('confidence')}: ${s.confidence}`,
      h('p', { class: 'small' }, s.thesis), h('h4', null, t('evidence')), list(s.supportingEvidence), h('h4', null, t('triggers')), list(s.triggers),
      h('h4', null, t('transmission')), h('p', { class: 'small' }, s.transmission), h('h4', null, t('affected')), h('p', { class: 'small' }, (s.affectedAssets || []).join(', ')),
      h('h4', null, t('invalidation')), list(s.invalidation), h('p', { class: 'small muted' }, `${t('limitations')}: ${s.limitations}`))))),
    rep.evidenceGaps?.length ? panel(t('gaps'), list(rep.evidenceGaps)) : null,
    panel(t('evidence'), h('ol', { class: 'small' }, r.evidence.map((e) => h('li', null, h('b', null, `[${e.id}] `), e.text, e.ref ? [' ', h('a', { href: e.ref, target: '_blank', rel: 'noopener' }, '↗')] : null)))));
}

// ================= CALENDAR =================
export async function calendarView() {
  const lang = getLang();
  const box = h('div');
  const state = { region: '', imp: '', offset: 0 };
  const draw = () => async(box, async () => {
    const from = new Date(Date.now() + (state.offset - 14) * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + (state.offset + 45) * 86400000).toISOString().slice(0, 10);
    const d = await api(`/api/calendar?from=${from}&to=${to}`);
    const today = new Date().toISOString().slice(0, 10);
    let ev = d.events;
    if (state.region) ev = ev.filter((e) => e.region === state.region);
    if (state.imp) ev = ev.filter((e) => e.importance === state.imp);
    const fmtV = (v) => (v ? `${fmtNum(v.value, 2)} ${v.unit || ''} (${v.date})` : '—');
    const row = (e) => [h('span', { class: 'num' }, e.date), h('span', { class: 'small' }, `${e.time || ''} ${e.tz ? e.tz.split('/')[1].replace('_', ' ') : ''}`), e.region,
      h('span', null, lang === 'es' ? e.eventEs || e.event : e.event, e.date === today ? h('span', { class: 'tag hot', style: 'margin-left:6px' }, tr('TODAY', 'HOY')) : null),
      h('span', { class: `tag ${e.importance === 'high' ? 'hot' : ''}` }, e.importance), h('span', { class: 'small' }, fmtV(e.previous)), h('span', { class: 'small muted', title: t('calendar_note') }, '—'), h('span', { class: 'small' }, fmtV(e.actual)),
      h('span', { class: 'small' }, (e.markets || []).join(' ')), h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener', class: 'small' }, e.source)];
    const head = [tr('Date', 'Fecha'), tr('Time', 'Hora'), t('region'), t('event'), t('importance'), t('previous'), t('consensus'), t('actual'), tr('Markets', 'Mercados'), t('source')];
    return [
      panel(t('upcoming'), table(head, ev.filter((e) => e.date >= today).map(row))),
      h('div', { style: 'margin-top:14px' }, panel(t('past'), table(head, ev.filter((e) => e.date < today).reverse().map(row)))),
      h('div', { class: 'notice', style: 'margin-top:14px' }, t('calendar_note')),
      panel(tr('Sources', 'Fuentes'), h('ul', { class: 'small' }, d.sources.map((s) => h('li', { class: s.ok ? '' : 'down' }, `${s.name}: ${s.ok ? 'OK' : s.error}`)))),
    ];
  });
  draw();
  const sel = (opts, key) => { const s = h('select', { class: 'input' }, opts.map(([v, l]) => h('option', { value: v }, l))); s.addEventListener('change', () => { state[key] = s.value; draw(); }); return s; };
  return h('div', null, pageHead(t('nav_calendar'), tr('Times shown in the event’s local timezone.', 'Horas en la zona horaria local del evento.'),
    h('button', { class: 'btn', onclick: () => { state.offset -= 30; draw(); } }, '←'), h('button', { class: 'btn', onclick: () => { state.offset = 0; draw(); } }, tr('Today', 'Hoy')), h('button', { class: 'btn', onclick: () => { state.offset += 30; draw(); } }, '→'),
    sel([['', `${t('region')}: ${t('all')}`], ['US', 'US'], ['EU', 'EU']], 'region'), sel([['', `${t('importance')}: ${t('all')}`], ['high', 'high'], ['medium', 'medium'], ['low', 'low']], 'imp')), box);
}

// ================= SAVED / STATUS =================
export async function saved() {
  const list = savedList();
  return h('div', null, pageHead(t('nav_saved'), tr('Stored in this browser only.', 'Guardado solo en este navegador.')),
    panel(null, list.length ? list.map((i) => h('div', { class: 'story' }, h('div', { class: 'by' }, h('b', null, i.source), fmtTime(i.publishedAt)), h('h3', null, h('a', { href: i.url, target: '_blank', rel: 'noopener' }, i.title)),
      h('div', null, h('button', { class: 'btn sm', style: 'margin:0', onclick: (e) => { toggleSave(i); e.currentTarget.closest('.story').remove(); } }, t('remove'))))) : h('p', { class: 'muted' }, t('no_data'))),
    h('div', { style: 'margin-top:14px' }, panel(tr('Saved research (Quant Lab)', 'Investigación guardada (Lab cuant)'), (store('experiments', []).length ? table([tr('Name', 'Nombre'), tr('Strategy', 'Estrategia'), tr('Asset', 'Activo'), tr('Saved', 'Guardado')], store('experiments', []).map((x) => [x.name, x.strategy.type, x.asset, fmtTime(x.savedAt)])) : h('p', { class: 'muted' }, t('no_data'))))));
}

export async function status() {
  const box = h('div');
  async(box, async () => {
    // Warm a few providers so the snapshot is meaningful, then read health.
    await Promise.allSettled([api('/api/markets/overview'), api('/api/news?limit=1'), api('/api/crypto/derivatives')]);
    const [hlth, cfg, nw] = await Promise.all([api('/api/health'), api('/api/config'), api('/api/news?limit=1')]);
    return h('div', { class: 'grid g2' },
      panel(tr('Providers (this Worker isolate)', 'Proveedores (este isolate)'), table(['Provider', 'Status', 'OK', 'Fail', tr('Last success', 'Último éxito'), tr('Last error', 'Último error')],
        hlth.providers.sort((a, b) => a.provider.localeCompare(b.provider)).map((p) => [p.provider, statusBadge(p.status === 'ok' ? 'live' : 'stale'), p.okCount, p.failCount, p.lastSuccess ? ago(p.lastSuccess) : '—', h('span', { class: 'small down' }, p.lastError || '')]))),
      h('div', { class: 'grid' },
        panel(tr('Configuration', 'Configuración'), table(['', ''], [
          ['AI analyst (ANTHROPIC_API_KEY)', cfg.ai ? 'ON' : 'OFF'], ['FRED API key (release calendar)', cfg.fredKey ? 'ON' : tr('OFF — public CSV used', 'OFF — se usa CSV público')],
          ['D1 archive (DB)', cfg.archive ? 'ON' : 'OFF'], ['KV cache (CACHE)', hlth.bindings.kv ? 'ON' : tr('OFF — in-memory cache', 'OFF — caché en memoria')],
          ['Coinzilla zones', Object.entries(cfg.coinzilla || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none']])),
        panel(tr('News feeds', 'Feeds de noticias'), table(['Feed', 'Lang', 'Items', 'Status'], nw.feeds.map((f) => [f.source, f.lang, f.count, f.ok ? statusBadge('delayed') : h('span', { class: 'down small' }, f.error)])))));
  });
  return h('div', null, pageHead(t('nav_status'), tr('Provider health, freshness and configuration.', 'Salud de proveedores, frescura y configuración.')), box);
}

export { storyNode, bars };
