# point-xfer

Mobile-first web app that maps credit card and loyalty point transfer partners, plus a GitHub Action that tracks live transfer bonuses from public blog RSS feeds. Static site on GitHub Pages; no build step, no runtime dependencies.

## Commands

```sh
npm test               # node:test suite (parser, merge logic, dataset integrity). Run after every change.
npm run serve          # local server; index.html can't be opened from disk (fetch of local JSON is blocked)
npm run preview        # dist/preview.html: single self-contained file with data, CSS and JS inlined
npm run track          # fetch feeds and update data/promotions.json
npm run track:dry      # same, print only
npm run track:offline  # re-merge data/promotions.manual.json and prune expired, no network
```

Node 20+ (CI uses 22). There is no package install step; keep it that way unless there's a strong reason.

## Layout

- `index.html` app shell. Loads D3 7.9.0 from cdnjs and B612 from Google Fonts. Contains a small pre-paint script that applies the saved theme.
- `assets/app.js` single IIFE, vanilla JS. Sections: data loading and indexing, URL state, controls, bonus strip, route view (D3 rail), compare view (D3 matrix), detail sheet (calculator), partner search, theme toggle. URL params: `view`, `from`, `type`, `bonus`, `partner` (open detail sheet, so partners are linkable).
- `assets/styles.css` design tokens at the top, mobile-first, `@media (min-width: 720px)` and `1000px` breakpoints, dark mode.
- `data/programs.json` currencies (dropdown order = column order in Compare), alliance groups, partners.
- `data/transfers.json` every route. `ratio` is `[points sent, points received]`; `[5, 4]` means 1,000 → 800. Optional `note` and `variants` (card-dependent ratios, see chase → hyatt). Bump `verifiedOn` when you re-check the list.
- `data/promotions.json` written by the tracker. Don't hand-edit; edit `promotions.manual.json` and run `npm run track:offline`.
- `data/promotions.manual.json` `add` (hand-entered bonuses, always win while active) and `suppress` (promo ids to hide false positives, e.g. `citi-turkish-25`).
- `data/sources.json` RSS feeds the tracker reads.
- `scripts/lib/parse.mjs` feed parsing and bonus extraction: alias tables for currencies and partners, bonus %, end-date parsing.
- `scripts/track-promos.mjs` tracker entry point and `merge()` logic (exported for tests).
- `scripts/build-preview.mjs` builds the single-file preview.
- `tests/tracker.test.mjs` all tests.
- `.github/workflows/track-promos.yml` cron every 6 hours: test, track, commit if changed, open an issue for new bonuses.
- `.github/workflows/pages.yml` deploy on push and on tracker completion.

## How the tracker decides what's a bonus

1. Headline must mention transfer/convert, contain a `NN% bonus`, and name a currency.
2. Targets come from the part of the headline after " to " / " into " / "→".
3. Every (currency, partner) pair must exist in `transfers.json`, otherwise it's dropped. This is the main false-positive filter, so adding a route also teaches the tracker about it.
4. End date from "through Sept. 30", "until October 15", "ends 9/30". One-day offers ("today only", "Rent Day") end on the publish date. No date found → kept 30 days (`assumedEnd`).
5. `[Expired]` headlines close out a matching bonus. Manual entries are not closed by feed results.
6. Writes only when data changes, so the Action doesn't make noise commits.

When adding a partner or currency, add aliases in `parse.mjs` and a test with a realistic headline. Watch for collisions: "American Express" vs American Airlines, "Rove" vs "Rover", "Miles & More" vs "Miles&Smiles", case-sensitive `ANA`, `BA`, `EVA`, `TAP`, `SAS`, `JAL`.

## Design rules

- Subject vernacular is airline route maps: each currency is a trunk line, partners are stops. Branch stroke weight = partner points per 1,000 sent (log scale, `weight` in app.js). Compare view dot area = same value (sqrt scale, `dotR`).
- One accent: taxiway yellow `--bonus` marks live bonuses only. Don't use it for anything else.
- Typeface is B612 (Airbus cockpit font) at 400/700 only. Type scale uses the `--step-*` tokens.
- Tokens live in `:root`; dark values are duplicated in `[data-theme="dark"]` and the `prefers-color-scheme` block. Change both.
- Mobile first. Tap targets ≥ 44px, the currency picker is a native `<select>` (18px font so iOS doesn't zoom), controls are sticky, detail view is a `<dialog>` bottom sheet with swipe-to-close.
- Partner search is a top-pinned `<dialog>` (so the on-screen keyboard doesn't cover results) opened from the button beside the view tabs or `/`. It's an ARIA combobox matching word prefixes in partner name, id and `note`, so notes double as search keywords ("Avios", "Alaska"). Picking a result opens the detail sheet.
- One orchestrated animation (rail draws on currency change). Respect `prefers-reduced-motion`.
- Prose UI copy: sentence case, no middle-dot separators, no eyebrow labels.

## Gotchas

- The preview build sets `window.__NO_STORAGE__ = true`; the app must work without `localStorage` (Claude.ai artifact sandboxes block it). Guard any new storage use the same way.
- The rail is drawn from measured DOM row positions. Anything that changes row height after render (fonts, wrapping) needs `drawRail(false)`. Redraw on resize only fires on width changes, deliberately, so the intro animation isn't cancelled.
- `history.replaceState` is wrapped in try/catch for sandboxed previews.
- Commits made by `GITHUB_TOKEN` don't trigger `push` workflows. `pages.yml` listens for `workflow_run` of "Track transfer bonuses"; if you rename that workflow, update the reference.
- GitHub Pages on a private repo needs a paid plan. Scheduled workflows pause after 60 days of repo inactivity.
- Browsers compute "live" bonuses using the visitor's local date, so an expired bonus disappears on time even if the Action hasn't run.

## Data sources

Ratios were verified on 2026-09-23 against issuer pages and recent coverage (The Points Guy, Upgraded Points, One Mile at a Time, Frequent Miler, AwardWallet, Rove's own site). Recent changes worth remembering: Citi added JAL (Sep 20, 2026) and cut I Prefer to 1:2 and Choice to 1:1.5 (Apr 19, 2026); Citi dropped Aeromexico (Jan 2026); Amex dropped Etihad (Jun 30, 2026); Chase dropped Emirates and moved Hyatt to 4:3 on Sapphire Preferred / Ink Preferred. Transfers are irreversible, so accuracy beats coverage: when unsure, leave a route out and add a `note`.

## Inspiration and license

Concept inspired by Wings of the Points (uscreditcardguide.github.io), which is CC BY-NC-ND. Don't copy its code or data.

## Ideas not yet built

- "My cards" filter in Compare that dims currencies you don't hold (URL param, no storage required).
- Bonus history chart per route from `promotions.json` `history`.
- Transfer time and minimum per route in the detail sheet.
- Optional LLM extraction in the tracker when `ANTHROPIC_API_KEY` is set, with the regex parser as fallback.
- Hotel-to-airline routes (Marriott, Accor) as an optional layer.
