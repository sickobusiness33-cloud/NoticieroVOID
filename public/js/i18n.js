// English is the primary language; Spanish is fully supported.
const STR = {
  en: {
    tagline: 'SEE THE SIGNAL BEFORE THE MARKET MOVES.',
    sub: 'Decode the forces moving global markets.',
    nav_home: 'News', nav_terminal: 'Command Center', nav_macro: 'Macro', nav_news: 'Intel Feed', nav_analyst: 'AI Analyst',
    nav_liquidity: 'Liquidity Lab', nav_cryptomacro: 'Crypto Macro', nav_meme: 'Memecoins', nav_lab: 'Quantum Lab',
    nav_calendar: 'Calendar', nav_status: 'Data Status', nav_saved: 'Saved', not_found: 'Page not found',
    ad: 'Advertisement', loading: 'Loading…', retry: 'Retry', unavailable: 'Unavailable', source: 'Source', updated: 'Updated',
    observed: 'Observed', previous: 'Previous', latest: 'Latest', change: 'Change', unit: 'Unit', frequency: 'Frequency',
    st_live: 'LIVE', st_delayed: 'DELAYED', st_historical: 'HISTORICAL', st_estimated: 'ESTIMATED', st_unavailable: 'UNAVAILABLE', st_stale: 'STALE',
    top_stories: 'Top stories', latest_news: 'Latest', macro_snapshot: 'Macro snapshot', markets: 'Markets', breaking: 'BREAKING',
    read_at: 'Read at', also: 'Also reported by', analyze: 'AI analysis', save: 'Save', saved_ok: 'Saved', remove: 'Remove',
    search: 'Search…', all: 'All', category: 'Category', language: 'Language', sort_rel: 'Relevance', sort_time: 'Newest',
    regime: 'Regime', rule_based: 'RULE-BASED (deterministic, not AI)', ai_generated: 'AI-GENERATED INTERPRETATION',
    evidence: 'Evidence', confidence: 'Confidence', insufficient: 'insufficient evidence',
    watchlist: 'Watchlist', add: 'Add', range: 'Range', no_data: 'No data available.',
    disclaimer: 'Research and information only. Not investment advice. Data may be delayed; check sources before acting.',
    ai_off: 'The AI analyst is not configured on this deployment (missing ANTHROPIC_API_KEY). The rule-based regime below is computed from official data.',
    gen_briefing: 'Daily briefing', ask: 'Ask a research question', ask_ph: 'e.g. How could a stronger dollar affect BTC this month?', run: 'Run',
    exec_summary: 'Executive summary', regime_analysis: 'Regime analysis', scenarios: 'Scenarios', gaps: 'Evidence gaps',
    triggers: 'Triggers', transmission: 'Transmission', affected: 'Affected assets', invalidation: 'Invalidation', limitations: 'Limitations',
    calendar_note: 'Consensus forecasts are not shown: no free official source publishes them, and we do not fabricate them.',
    upcoming: 'Upcoming', past: 'Recent', importance: 'Importance', region: 'Region', event: 'Event', actual: 'Actual', consensus: 'Consensus',
    meme_disclaimer: 'Market-wide regime only — it does not predict any individual token. Pool data may include wash trading.',
    lab_note: 'BACKTESTED results on historical data. Not paper-trading or live results. Past performance does not predict future returns.',
    measured: 'MEASURED', estimate: 'ANALYTICAL ESTIMATE',
  },
  es: {
    tagline: 'VE LA SEÑAL ANTES DE QUE SE MUEVA EL MERCADO.',
    sub: 'Descifra las fuerzas que mueven los mercados globales.',
    nav_home: 'Noticias', nav_terminal: 'Centro de mando', nav_macro: 'Macro', nav_news: 'Feed de inteligencia', nav_analyst: 'Analista IA',
    nav_liquidity: 'Laboratorio de liquidez', nav_cryptomacro: 'Cripto macro', nav_meme: 'Memecoins', nav_lab: 'Laboratorio Cuántico',
    nav_calendar: 'Calendario', nav_status: 'Estado de datos', nav_saved: 'Guardados', not_found: 'Página no encontrada',
    ad: 'Publicidad', loading: 'Cargando…', retry: 'Reintentar', unavailable: 'No disponible', source: 'Fuente', updated: 'Actualizado',
    observed: 'Observado', previous: 'Anterior', latest: 'Último', change: 'Cambio', unit: 'Unidad', frequency: 'Frecuencia',
    st_live: 'EN VIVO', st_delayed: 'DIFERIDO', st_historical: 'HISTÓRICO', st_estimated: 'ESTIMADO', st_unavailable: 'NO DISPONIBLE', st_stale: 'DESACTUALIZADO',
    top_stories: 'Destacadas', latest_news: 'Lo último', macro_snapshot: 'Panorama macro', markets: 'Mercados', breaking: 'ÚLTIMA HORA',
    read_at: 'Leer en', also: 'También publicado por', analyze: 'Análisis IA', save: 'Guardar', saved_ok: 'Guardado', remove: 'Quitar',
    search: 'Buscar…', all: 'Todos', category: 'Categoría', language: 'Idioma', sort_rel: 'Relevancia', sort_time: 'Más recientes',
    regime: 'Régimen', rule_based: 'BASADO EN REGLAS (determinista, no IA)', ai_generated: 'INTERPRETACIÓN GENERADA POR IA',
    evidence: 'Evidencia', confidence: 'Confianza', insufficient: 'evidencia insuficiente',
    watchlist: 'Lista de seguimiento', add: 'Añadir', range: 'Rango', no_data: 'No hay datos disponibles.',
    disclaimer: 'Solo investigación e información. No es asesoramiento de inversión. Los datos pueden estar diferidos; verifica las fuentes.',
    ai_off: 'El analista IA no está configurado en este despliegue (falta ANTHROPIC_API_KEY). El régimen basado en reglas se calcula con datos oficiales.',
    gen_briefing: 'Informe diario', ask: 'Haz una pregunta de investigación', ask_ph: 'p. ej. ¿Cómo podría afectar un dólar más fuerte al BTC este mes?', run: 'Ejecutar',
    exec_summary: 'Resumen ejecutivo', regime_analysis: 'Análisis de régimen', scenarios: 'Escenarios', gaps: 'Lagunas de evidencia',
    triggers: 'Detonantes', transmission: 'Transmisión', affected: 'Activos afectados', invalidation: 'Invalidación', limitations: 'Limitaciones',
    calendar_note: 'No mostramos previsiones de consenso: ninguna fuente oficial gratuita las publica y no las inventamos.',
    upcoming: 'Próximos', past: 'Recientes', importance: 'Importancia', region: 'Región', event: 'Evento', actual: 'Dato', consensus: 'Consenso',
    meme_disclaimer: 'Régimen del mercado en conjunto: no predice ningún token individual. Los datos de pools pueden incluir wash trading.',
    lab_note: 'Resultados de BACKTEST sobre datos históricos. No son resultados de paper trading ni reales. El rendimiento pasado no predice el futuro.',
    measured: 'MEDIDO', estimate: 'ESTIMACIÓN ANALÍTICA',
  },
};

let lang = 'en';
try { lang = localStorage.getItem('void.lang') || (navigator.language?.startsWith('es') ? 'es' : 'en'); } catch { /* storage blocked */ }

export function getLang() { return lang; }
export function setLang(l) { lang = l === 'es' ? 'es' : 'en'; try { localStorage.setItem('void.lang', lang); } catch { /* ignore */ } document.documentElement.lang = lang; }
export function t(key) { return STR[lang][key] ?? STR.en[key] ?? key; }
// Inline bilingual literal for one-off strings: tr('English', 'Español').
export function tr(en, es) { return lang === 'es' ? es : en; }
