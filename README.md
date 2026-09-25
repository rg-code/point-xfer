# point-xfer

A mobile-first map of where credit card points can go. Pick a card currency from the dropdown to see every airline and hotel partner drawn as a route line, or switch to **Compare cards** to see all seven currencies side by side. Tap the search button (or press `/`) to jump straight to any airline or hotel program and see every card that transfers to it. Live transfer bonuses are tracked automatically by a GitHub Action and highlighted in yellow. Each partner's detail sheet shows transfer time and minimums, a chart of past bonuses for every card, and a go or wait call on transferring now.

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

The live site is at [milesmaximizer.com](https://milesmaximizer.com). For a custom domain of your own, point the apex at GitHub's Pages A/AAAA records and `www` at `<user>.github.io`, set the domain in **Settings → Pages**, and tick **Enforce HTTPS** once the certificate is issued.

The footer's "Report a mistake" link fills in your username and repo automatically when the site runs on `github.io`. On a custom domain, add it to `CUSTOM_DOMAINS` in `assets/app.js`.

After that the tracker runs every 2 hours. Each run that changes the bonus list commits `data/promotions.json`, redeploys the site, and opens an issue listing the new bonuses so you can sanity-check them.

## How bonus tracking works

`scripts/track-promos.mjs` reads the RSS feeds in `data/sources.json` (AwardWallet, Frequent Miler, Doctor of Credit, One Mile at a Time, The Points Guy, Upgraded Points, View from the Wing). For each headline it looks for a bonus percentage, a card currency, and one or more partners, then checks the route against `data/transfers.json`. A headline claiming "Chase 25% bonus to Delta" is discarded because Chase doesn't transfer to Delta, which removes most false positives.

End dates come from phrases like "through Sept. 30", "until October 15" or "ends 9/30". Bilt Rent Day bonuses (a post saying "Rent Day", or a Bilt headline naming the 1st) are dated to the nearest 1st of the month, so a preview posted days ahead shows up on the day itself; other one-day offers end on their publish date. If no end date is found, the bonus is kept for 30 days after it was first seen and the site shows "end date not listed." Headlines marked `[Expired]` close out a bonus early. The site also filters by date in the browser, so an expired bonus disappears on time even if the Action hasn't run.

Sources are ranked: the issuer's or partner's own offer page first (picked up from links inside blog posts), then AwardWallet, then Frequent Miler and Doctor of Credit (tied), then everything else. The detail sheet lists them in that order, and when two sources disagree on an end date the better-ranked one wins; between tied sources, the newest post wins.

A feed that fails (timeouts, bot blocking) is logged and skipped; the run still succeeds. The script has no dependencies and only commits when the data actually changes.

### Slack

Each run that finds new bonuses also posts them to Slack as you. The post opens with a one-liner to someone picked at random ("Hold my beer, DanC. A new bonus was spotted."), then lists each bonus with its dates and a link to it on milesmaximizer.com (no blog links; those stay on the site and in the GitHub issue). A bonus announced ahead of its start date, like a Bilt Rent Day preview, gets a second post on the morning it goes live (the first run after midnight Eastern). Bonuses that are live when first found get one post. Edit the names and lines in `scripts/lib/slack.mjs`.

It needs a Slack app with the **User Token Scope** `chat:write`, installed by you, with the user token stored as the repo secret `SLACK_USER_TOKEN` and the channel ID as the repo variable `SLACK_CHANNEL_ID`. Without them the step is skipped. A failed post shows as a warning in the Actions log and never blocks the deploy. To stop posting, delete the secret or revoke the token in the Slack app's **OAuth & Permissions** page. To test the stored token, run **Actions → Slack check** (posts to your own DM by default).

### Fixing mistakes by hand

`data/promotions.manual.json` has two lists:

- `add`: bonuses you enter yourself. While active, these always win over feed results. Useful for offers blogs haven't covered, or for adding a note like "30% with the Aeroplan card."
- `suppress`: promo ids (such as `citi-turkish-25`) to hide a false positive. The id appears in each tracker issue.

Run `npm run track:offline` after editing to rebuild `promotions.json` without touching the network.

### Bonus history and go or wait

`data/promotions.archive.json` holds hand-researched past bonuses back to its `since` date. The tracker folds them into the `history` in `promotions.json`, preferring them over overlapping records it found itself. `assets/advice.js` then looks at each route's history: how often bonuses come, how big they usually are, and how long it has been since the last one. From that it estimates the chance of a bonus in the next 90 days and the extra points waiting is likely to earn. The call is **Go** when a live bonus beats that, or when waiting isn't worth much, and **Wait** when a bonus is likely (40% or better) and worth at least 10% on average. Targeted offers show faded in the chart and don't count. Routes launched after the archive starts (`added` in `transfers.json`) are judged on their own lifetime.

## Updating transfer ratios

Partners change a few times a year. Edit `data/transfers.json`, where `ratio` is `[points sent, points received]`: `[5, 4]` means 1,000 points become 800. For card-dependent ratios, add `variants` (see Chase to Hyatt), and for caveats add a `note`. Transfer time is `time: { min, max, unit }` (`unit` is minutes, hours or days; `max: 0` means instant) with an optional `timeNote`. Minimums default to the currency's `minTransfer` and `increment` in `programs.json`; override per route with `min`, `increment` and `minNote`. New partners go in `data/programs.json`. `npm test` fails if a route points at an unknown program, a ratio is invalid, a route is duplicated, or a partner has no route. Update `verifiedOn` when you've checked the list.

## Project layout

```
index.html                 app shell
assets/app.js              state, D3 route rail, comparison matrix, detail sheet, search
assets/advice.js           go or wait advice from a route's bonus history
assets/styles.css          design tokens, mobile-first layout, dark mode
data/programs.json         currencies, alliance groups, partners
data/transfers.json        every route and ratio
data/promotions.json       live and past bonuses (written by the tracker)
data/promotions.manual.json  hand overrides
data/promotions.archive.json researched past bonuses (history backfill)
data/sources.json          feeds the tracker reads
scripts/track-promos.mjs   tracker entry point
scripts/lib/parse.mjs      feed parsing and bonus extraction
scripts/lib/sources.mjs    official domains and source ranking
scripts/build-preview.mjs  single-file build
tests/*.test.mjs           node:test suites (tracker, insights)
.github/workflows/         track-promos.yml (cron), pages.yml (deploy)
```

## Things to know

- GitHub pauses scheduled workflows in public repos after 60 days with no repository activity. If that happens, re-enable it from the Actions tab.
- Scheduled runs can start late during busy periods on GitHub's side.
- Commits made by the Action don't trigger `push` workflows, so `pages.yml` also listens for the tracker finishing (`workflow_run`). That's what keeps the live site current.
- Transfers are irreversible. The ratios here were verified on the date in `transfers.json`, but always confirm with the issuer before moving points.
