# Noticiero VOID — working agreement for Claude

The owner focuses on describing changes to the web app; Claude edits, tests, commits
and pushes on its own. Pushing to `main` deploys to production automatically
(`.github/workflows/deploy.yml`: tests → `wrangler deploy`).

## Standing authorization
- Claude may commit and push directly to `main` without asking, **after** the checks below pass.
- Never force-push, rewrite history, delete branches, or change secrets/repo settings.
- Ask first for: removing a module, changing data sources or their licensing terms,
  editing `wrangler.toml` bindings/crons, or anything that costs money (e.g. AI model/effort).

## Before every push
1. `npm test` (all tests pass) and `node --check` on changed JS files.
2. For UI changes: run `npx wrangler dev` and load the affected route(s) in headless
   Chromium (`/opt/pw-browsers`) at 1366px and 390px; no console errors.
3. Commit message in English, imperative, describing the user-visible change.
4. After pushing, check the "Test & Deploy" run for the commit; if it fails, fix and push again.

## Project rules (do not break)
- No fabricated data, consensus forecasts, citations or performance. Unavailable = say so.
- Every data widget shows status badge, unit, source link, last update (`metaLine`).
- News: headline + ≤240-char excerpt + link to the publisher; never reproduce article bodies.
  Publisher thumbnails from their own RSS feeds may be shown, always credited ("Image: Source"),
  except hosts in `NO_HOTLINK_IMAGES`. Article pages add only original VOID content (market data,
  conditional scenarios, AI analysis) and must keep the "Read the full story at …" link (shown at the bottom).
  The "VOID Report" (src/services/story.js, Workers AI, capped to the free tier) is an original story written
  only from feed facts (headline/excerpt of the item and same-story items); its guards drop copied wording,
  unsourced quotes and numbers absent from the sources. Never feed it scraped article bodies.
  Full text is shown ONLY for official releases in `OFFICIAL_HOSTS` (src/services/official.js: public domain
  or reuse-with-attribution terms); never for commercial publishers.
- Every user-facing string exists in English and Spanish (`public/js/i18n.js` or `tr(en, es)`).
- Shared analytics live in `public/js/shared/` and need unit tests in `test/`.
- Ads only through `public/js/ads.js` (Coinzilla), always labelled Advertisement/Publicidad.

## Data that must never be invented here
- Holders, wallet movements, alerts and calendar events always come from a named provider; when a provider
  or credential is missing, return an explicit limitation (see README "Quantum Lab & Intelligence Calendar").
- Never classify a transfer as a buy/sell, never attribute identity to an unlabelled wallet, never show
  probabilities without a calibrated model. D1 schema changes go in `migrations/` and must be applied remotely.

## Layout
- `public/` SPA (no build step): `js/app.js` router, `js/views.js` + `js/views2.js` pages,
  `js/charts.js`, `css/app.css` design tokens.
- `src/` Worker: `index.js` routes, `adapters/` providers, `services/` logic, `lib/core.js` infra.
- See README.md for API, configuration and deployment.
