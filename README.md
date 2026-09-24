# point-xfer

A mobile-first map of where credit card points can go. Pick a card currency from the dropdown to see every airline and hotel partner drawn as a route line, or switch to **Compare cards** to see all seven currencies side by side. Live transfer bonuses are tracked automatically by a GitHub Action and highlighted in yellow.

Covers Amex Membership Rewards, Chase Ultimate Rewards, Citi ThankYou, Capital One Miles, Bilt, Wells Fargo Rewards and Rove Miles (a free, card-free currency): 44 partner programs, 133 routes.

Inspired by [Wings of the Points](https://uscreditcardguide.github.io/Wings-of-the-Points/). That project is CC BY-NC-ND, so no code or data was copied; everything here was written and sourced independently.

## Run it locally

```sh
npm run serve          # serves the folder; open the printed URL
npm test               # parser, merge logic and dataset checks
npm run preview        # builds dist/preview.html, a single file that opens from disk
```

Opening `index.html` directly from disk won't work because browsers block `fetch()` of local JSON. Use `npm run serve` or the preview build.

## Deploy to GitHub Pages

1. Push this folder to `main` (for example, `gh repo create point-xfer --private --source=. --remote=origin --push`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**. Pages on a private repo requires a paid GitHub plan (Pro, Team or Enterprise); on the free plan, make the repo public or host the site elsewhere.
3. In **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions** (needed if your account or org defaults to read-only).
4. Open the **Actions** tab, pick **Track transfer bonuses**, and click **Run workflow** once to confirm everything works.

The footer's "Report a mistake" link fills in your username and repo automatically when the site runs on `github.io`.

After that the tracker runs every 6 hours. Each run that changes the bonus list commits `data/promotions.json`, redeploys the site, and opens an issue listing the new bonuses so you can sanity-check them.

## How bonus tracking works

`scripts/track-promos.mjs` reads the RSS feeds in `data/sources.json` (Doctor of Credit, Frequent Miler, One Mile at a Time, The Points Guy, Upgraded Points, View from the Wing). For each headline it looks for a bonus percentage, a card currency, and one or more partners, then checks the route against `data/transfers.json`. A headline claiming "Chase 25% bonus to Delta" is discarded because Chase doesn't transfer to Delta, which removes most false positives.

End dates come from phrases like "through Sept. 30", "until October 15" or "ends 9/30". One-day offers such as Bilt Rent Day end on their publish date. If no end date is found, the bonus is kept for 30 days after it was first seen and the site shows "end date not listed." Headlines marked `[Expired]` close out a bonus early. The site also filters by date in the browser, so an expired bonus disappears on time even if the Action hasn't run.

A feed that fails (timeouts, bot blocking) is logged and skipped; the run still succeeds. The script has no dependencies and only commits when the data actually changes.

### Fixing mistakes by hand

`data/promotions.manual.json` has two lists:

- `add`: bonuses you enter yourself. While active, these always win over feed results. Useful for offers blogs haven't covered, or for adding a note like "30% with the Aeroplan card."
- `suppress`: promo ids (such as `citi-turkish-25`) to hide a false positive. The id appears in each tracker issue.

Run `npm run track:offline` after editing to rebuild `promotions.json` without touching the network.

## Updating transfer ratios

Partners change a few times a year. Edit `data/transfers.json`, where `ratio` is `[points sent, points received]`: `[5, 4]` means 1,000 points become 800. For card-dependent ratios, add `variants` (see Chase to Hyatt), and for caveats add a `note`. New partners go in `data/programs.json`. `npm test` fails if a route points at an unknown program, a ratio is invalid, a route is duplicated, or a partner has no route. Update `verifiedOn` when you've checked the list.

## Project layout

```
index.html                 app shell
assets/app.js              state, D3 route rail, comparison matrix, detail sheet
assets/styles.css          design tokens, mobile-first layout, dark mode
data/programs.json         currencies, alliance groups, partners
data/transfers.json        every route and ratio
data/promotions.json       live and past bonuses (written by the tracker)
data/promotions.manual.json  hand overrides
data/sources.json          feeds the tracker reads
scripts/track-promos.mjs   tracker entry point
scripts/lib/parse.mjs      feed parsing and bonus extraction
scripts/build-preview.mjs  single-file build
tests/tracker.test.mjs     node:test suite
.github/workflows/         track-promos.yml (cron), pages.yml (deploy)
```

## Things to know

- GitHub pauses scheduled workflows in public repos after 60 days with no repository activity. If that happens, re-enable it from the Actions tab.
- Scheduled runs can start late during busy periods on GitHub's side.
- Commits made by the Action don't trigger `push` workflows, so `pages.yml` also listens for the tracker finishing (`workflow_run`). That's what keeps the live site current.
- Transfers are irreversible. The ratios here were verified on the date in `transfers.json`, but always confirm with the issuer before moving points.
