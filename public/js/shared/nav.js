// Primary navigation: the ten top-level sections and how the current URL maps to them.
// Every href is an implemented route (section pages, /terminal, /prediction-markets, /newsletter).

export const NAV_ITEMS = [
  { key: 'ai', en: 'AI', es: 'IA', href: '/section/ai' },
  { key: 'web3', en: 'Web3', es: 'Web3', href: '/section/web3' },
  { key: 'crypto', en: 'Crypto', es: 'Cripto', href: '/section/crypto' },
  { key: 'stocks', en: 'Stocks', es: 'Bolsa', href: '/section/stocks' },
  { key: 'finance', en: 'Finance', es: 'Finanzas', href: '/section/finance' },
  { key: 'macro', en: 'Macro', es: 'Macro', href: '/section/macro', also: [/^\/macro(\/|$)/, /^\/section\/world$/] },
  { key: 'prediction-markets', en: 'Prediction Markets', es: 'Mercados de predicción', href: '/prediction-markets' },
  { key: 'technology', en: 'Technology', es: 'Tecnología', href: '/section/technology' },
  { key: 'markets', en: 'Markets', es: 'Mercados', href: '/terminal', also: [/^\/section\/(markets|commodities|fx)$/] },
  { key: 'newsletter', en: 'Newsletter', es: 'Newsletter', href: '/newsletter' },
];

// Secondary destinations that left the primary bar but stay reachable from the "More" menu.
export const MORE_ITEMS = [
  { href: '/news', en: 'Intel Feed', es: 'Feed de inteligencia' },
  { href: '/calendar', en: 'Calendar', es: 'Calendario' },
  { href: '/memecoins', en: 'Memecoins', es: 'Memecoins' },
  { href: '/lab', en: 'Quantum Lab', es: 'Laboratorio Cuántico' },
  { href: '/liquidity', en: 'Liquidity Lab', es: 'Laboratorio de liquidez' },
  { href: '/crypto-macro', en: 'Crypto Macro', es: 'Cripto macro' },
  { href: '/macro', en: 'Macro indicators', es: 'Indicadores macro' },
  { href: '/analyst', en: 'AI Analyst', es: 'Analista IA' },
  { href: '/saved', en: 'Saved', es: 'Guardados' },
  { href: '/status', en: 'Data status', es: 'Estado de datos' },
];

// Index of the active primary item for a pathname, or -1 (front page, articles, tools).
export function activeNavIndex(pathname) {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  return NAV_ITEMS.findIndex((it) => p === it.href || (it.also || []).some((re) => re.test(p)));
}
