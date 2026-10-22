# Noticiero VOID — VOID TERMINAL

**SEE THE SIGNAL BEFORE THE MARKET MOVES.**

A bilingual (English first, full Spanish) financial-intelligence newsroom and terminal. It covers macro, crypto, liquidity, memecoin market regimes and quantitative research, with Coinzilla ad slots built in. It runs entirely on **Cloudflare Workers** (Workers Static Assets for the SPA and a Worker for the API), with optional KV, D1 and Cron Triggers.

> Español: ver la sección [Guía rápida en español](#guía-rápida-en-español) al final.

---

## What's inside

| Module | Route | What it does | Data |
|---|---|---|---|
| Newsroom | `#/` | Lead story, top stories (max 2 per publisher), latest feed, market sidebar, macro snapshot, ad slots | RSS feeds, CoinGecko, FRED |
| Command Center | `#/terminal` | Crypto watchlist (saved per browser), rates/FX/equities/VIX table, interactive price chart, OKX funding/OI, rule-based macro regime | CoinGecko, FRED, OKX |
| Macro Intelligence | `#/macro`, `#/macro/:id` | 36 official series grouped by theme: latest, previous, change, 5-year percentile/range, history chart, implications, source link | FRED (Fed, BLS, BEA, Treasury, ECB, BoJ, ICE BofA, Chicago Fed via FRED) |
| Intel Feed | `#/news` | Aggregated EN/ES headlines: categories, asset/country tags, de-duplication, breaking flags, relevance ranking, search, saved articles, per-article AI analysis, D1 archive search | 12 publisher/official feeds |
| AI Analyst | `#/analyst` | Daily briefing + on-demand reports: executive summary, regime analysis, bull/base/bear scenarios, cited evidence | Claude API over a retrieved evidence pack |
| Calendar | `#/calendar` | FOMC & ECB decisions, Treasury auctions, BLS/BEA releases with previous/actual; consensus deliberately blank | Fed/ECB calendars, FiscalData, FRED releases |
| Liquidity Lab | `#/liquidity` | Fed net liquidity (measured), TGA, RRP, reserves, ECB/BoJ assets, M2, SOFR, real yields, dollar, stablecoins; documented composite score + sensitivity | FRED, DefiLlama |
| Crypto Macro | `#/crypto-macro` | Correlations with significance bounds, rolling correlation, realized vol, conditional returns, FOMC event study, lead–lag, stablecoins/TVL | CoinGecko, FRED, DefiLlama |
| Memecoins | `#/memecoins` | FAVORABLE / SELECTIVE / HIGH RISK / DEFENSIVE regime from configurable rules, Solana DEX volume, stablecoins, fees, trending and new pools | CoinGecko, DefiLlama, GeckoTerminal, Solana RPC |
| Quant Lab | `#/lab` | Causal backtests (SMA cross, RSI, momentum, breakout, buy & hold), costs/slippage, optional macro filter with publication lag, 70/30 split, walk-forward, trade list, CSV/JSON export, saved experiments | CoinGecko |
| Data Status | `#/status` | Provider health, feed status, configuration | — |

Every data widget shows its **status badge** (`LIVE`, `DELAYED`, `HISTORICAL`, `ESTIMATED`, `UNAVAILABLE`, `STALE`), its unit, source link and last successful update. Nothing on the site is real-time streaming, so nothing is labelled `LIVE`.

## Data-integrity rules built into the code

- **No fabricated values.** If a provider fails, the widget says *Unavailable* with the error. A previously fetched real value may be shown, but it is marked `STALE`.
- **Monthly/weekly statistics are labelled `HISTORICAL`**, and FRED daily values are labelled `DELAYED` (end of day). Observation dates are always shown.
- **Year-over-year is matched by calendar date.** Missing months (e.g. the unpublished October 2025 CPI) never pair the wrong months.
- **Consensus forecasts are never shown.** No free official source publishes them.
- **Gold:** no free official spot source is integrated. The terminal shows the **PAXG token** price labelled `ESTIMATED / token proxy, not spot`.
- **Liquidity composite** is labelled *Analytical estimate*. Inputs, weights, rolling (past-only) z-score normalization, missing-data rule and leave-one-out sensitivity are all displayed. Series with different units are never summed. Net liquidity is the only arithmetic combination, and its components are all USD balance-sheet items of the Fed.
- **Backtests** compute each signal at close *t* and apply it to the return of bar *t+1*. Macro filters are shifted by a publication lag. Walk-forward optimizes only on past windows. Annualized return is withheld for samples shorter than a year. Results are labelled `BACKTEST`.
- **AI output** is generated only from a numbered evidence pack. The model must cite `[E#]` ids, and responses citing non-existent evidence are rejected. Results are labelled *AI-generated interpretation*.
- **Copyright:** the feed stores only headline, a ≤240-character excerpt, publisher, timestamp and link. No publisher images are hot-linked, and every item links to the original article.

## Architecture

```
public/                 SPA (vanilla ES modules, no build step)
  index.html, css/app.css, assets/logo.svg
  js/app.js             router, language switch, ticker, keyboard nav
  js/views.js, views2.js  module views
  js/charts.js          dependency-free SVG charts (tooltips, keyboard inspection)
  js/ads.js             Coinzilla integration
  js/i18n.js            EN / ES strings
  js/shared/            pure analytics shared by browser, Worker and tests
    stats.js backtest.js news.js regime.js liquidity.js
src/                    Cloudflare Worker
  index.js              router, CSP, Coinzilla meta injection, cron
  lib/core.js           fetch w/ timeout+retry, KV/memory cache w/ stale fallback,
                        provider health, rate limiting, structured logs
  adapters/             fred.js crypto.js sources.js  (add providers here)
  services/             news macro calendar liquidity meme ai
migrations/0001_articles.sql   D1 schema for the news archive
test/                   node:test suites (39 tests)
```

**Adding a provider:** write an adapter in `src/adapters/` using `upstream()` (which gives you timeout, retries and health tracking). Wrap calls in `cached()` with a TTL that matches the provider's publication frequency, and return `{date, value}` series so the shared analytics work unchanged.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars    # optional: add keys
npm test                          # 39 unit tests
npm run dev                       # http://127.0.0.1:8787
```

## Deploy to Cloudflare

```bash
npx wrangler login
# Optional but recommended: KV cache (persists cache across isolates, serves stale data on outages)
npx wrangler kv namespace create CACHE        # paste id into wrangler.toml [[kv_namespaces]]
# Optional: D1 news archive (historical search)
npx wrangler d1 create noticiero-void         # paste id into wrangler.toml [[d1_databases]]
npm run db:migrate:remote
# Secrets (never commit them)
npx wrangler secret put ANTHROPIC_API_KEY     # enables AI Analyst + article analysis
npx wrangler secret put FRED_API_KEY          # recommended: official API, higher limits, release calendar
npx wrangler secret put ADMIN_TOKEN           # protects POST /api/admin/ingest
npx wrangler secret put COINGECKO_API_KEY     # optional (set COINGECKO_PLAN=pro for pro keys)
npm run deploy
```

Cron triggers (in `wrangler.toml`): news ingestion into D1 runs every 15 minutes. Every 6 hours the cron also warms the FRED cache and pre-generates the EN/ES AI briefings.

### Configuration reference

| Name | Type | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | AI Analyst. Without it the AI features return a clear 503 and the rule-based regime still works |
| `AI_MODEL` / `AI_EFFORT` | var | Defaults `claude-opus-5-5` / `medium`. Server-side refusal fallback is on; set `AI_FALLBACKS=off` to disable |
| `FRED_API_KEY` | secret | Official FRED API + release calendar. Without it the public FRED CSV is used (throttled, no data-release calendar) |
| `COINGECKO_API_KEY`, `COINGECKO_PLAN` | secret/var | Higher CoinGecko limits; `pro` unlocks >365 days of history |
| `SOLANA_RPC_URL` | var | Your own Solana RPC (the public endpoint often returns 403 to datacenter IPs) |
| `ADMIN_TOKEN` | secret | Bearer token for `POST /api/admin/ingest` |
| `CACHE` | KV binding | Shared cache + stale fallback |
| `DB` | D1 binding | News archive (`/api/news/archive`) |
| `RATE_LIMITER` | rate-limit binding | Global limit for AI endpoints (otherwise per-isolate limiter) |

## Coinzilla ads

1. Create your zones in the Coinzilla publisher dashboard (728×90 leaderboard, 300×250 rectangle, optionally 320×100 mobile and a sticky zone).
2. Copy the zone IDs (the part after `C-`) into `wrangler.toml` `[vars]`:
   `COINZILLA_ZONE_LEADERBOARD`, `COINZILLA_ZONE_RECTANGLE`, `COINZILLA_ZONE_MOBILE`, `COINZILLA_STICKY_ZONE`.
3. If Coinzilla gives you a site-verification code, put it in `COINZILLA_VERIFICATION`. The Worker injects `<meta name="coinzilla" content="…">` into every page.
4. Deploy. Slots appear at the top of every page, inside the news feed, in sidebars and on module pages. All are labelled **Advertisement / Publicidad**.
5. To preview slot positions before configuring zones, add `?adsdebug=1` to the URL.

The Content-Security-Policy already allows `coinzillatag.com`, `*.coinzilla.com` and `*.czilladx.com`.

## API

`GET /api/config`, `/api/health`, `/api/markets/overview`, `/api/markets/history?asset=bitcoin&days=365`, `/api/macro/catalog`, `/api/macro/series?id=DGS10&start=2020-01-01`, `/api/macro/indicators?group=rates`, `/api/macro/regime`, `/api/liquidity`, `/api/crypto/derivatives`, `/api/crypto/defi`, `/api/meme/regime` (POST to override rules), `/api/news?lang=en|es|all&category=&q=&sort=time`, `/api/news/archive?q=&from=&to=`, `/api/calendar?from=&to=`, `/api/ai/briefing?lang=es`. `POST /api/ai/report {question, lang}`, `POST /api/news/analyze {id, lang}`, `POST /api/admin/ingest` (Bearer `ADMIN_TOKEN`).

## Verified in this build

- `npm test`: **39/39 passing** (statistics, causality of backtests, cost handling, walk-forward separation, macro-filter publication lag, RSS/Atom parsing, de-duplication, classification, regime rules, liquidity units, rolling z-score, composite coverage, AI citation validation, FRED CSV parsing, rule-override validation).
- Ran `wrangler dev` locally. Every API route returned real data from FRED, CoinGecko, DefiLlama, GeckoTerminal, OKX, U.S. Treasury and the RSS feeds. The exceptions were the public Solana RPC (HTTP 403, shown as unavailable) and the AI routes (no API key in this environment, so they returned the documented 503).
- Loaded all 13 routes in headless Chromium at 1366px and 390px with zero JavaScript errors.

## Known limitations

- **Not deployed by this build.** Deployment requires your Cloudflare account (`npm run deploy`).
- **AI Analyst not exercised end-to-end** without an API key. The request code, evidence pack and validation are implemented and unit-tested.
- **Public FRED CSV is throttled.** The first visit to the Macro page fetches 36 series 4 at a time and takes a while. A `FRED_API_KEY` plus the KV binding makes this fast, and the 6-hourly cron keeps it warm.
- **Free CoinGecko** limits history to 365 days, so backtests and correlations use about one year of data.
- **No licensed sources:** no consensus forecasts, ISM PMI (proprietary), spot gold or exchange-aggregated derivatives (OKX only).
- **Not tracked:** Treasury issuance totals and ECB/BoJ policy statements beyond what appears in the feeds/FRED.
- **Local storage only:** watchlists, saved articles and saved experiments live in the browser (no user accounts).
- **Calendar actual vs previous:** "actual" for a past release is the latest FRED observation and may include later revisions (FRED vintages/ALFRED not integrated).
- **Rate limiting:** without the `RATE_LIMITER` binding, rate limits are per isolate.

---

## Guía rápida en español

**Noticiero VOID** es una plataforma de inteligencia financiera bilingüe (inglés principal, español completo) sobre Cloudflare Workers. Botón **EN/ES** arriba a la derecha.

1. `npm install` y `npm test` (39 pruebas).
2. `npm run dev` para probar en local (http://127.0.0.1:8787).
3. Para publicar: `npx wrangler login`, añade los secretos (`ANTHROPIC_API_KEY` para el analista IA y `FRED_API_KEY`, recomendado) y ejecuta `npm run deploy`.
4. **Coinzilla:** crea tus zonas en el panel de Coinzilla y pega los IDs (lo que va después de `C-`) en `wrangler.toml` (`COINZILLA_ZONE_LEADERBOARD`, `COINZILLA_ZONE_RECTANGLE`, `COINZILLA_ZONE_MOBILE`, `COINZILLA_STICKY_ZONE`). El código de verificación va en `COINZILLA_VERIFICATION`. Añade `?adsdebug=1` a la URL para ver dónde aparecen los anuncios antes de configurarlos.
5. Recomendado: crea el KV `CACHE` y la base D1 `DB` (instrucciones arriba) para caché compartida y archivo histórico de noticias.

**Integridad de datos:** no se inventan datos, previsiones de consenso ni citas. Cada widget muestra fuente, unidad, estado y última actualización. Las noticias muestran solo titular, extracto breve y enlace al medio original.

*Solo información e investigación. No es asesoramiento de inversión.*
