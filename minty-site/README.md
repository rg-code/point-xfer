# minty.milesmaximizer.com

The Minty landing page: links to fork, download or clone
[rg-code/minty](https://github.com/rg-code/minty), share buttons, and a footer linking the other
projects (Miles Maximizer, Inkling, the museum finder, GRAZE) with the Minty coin between them.
A static Cloudflare Pages project (`minty-site`, live at https://minty-site-853.pages.dev),
not part of this site's GitHub Pages build. `milesmaximizer.com/minty/` (`../minty/index.html`)
redirects here. No forms.

- **Get started** opens a side panel (full width on phones) with the latest `GET-STARTED.md`,
  fetched from raw.githubusercontent.com when it opens and rendered with marked + DOMPurify
  (cdnjs, pinned with SRI). Relative links point to the repo on GitHub. `#get-started` opens it
  directly. Without JavaScript, or if loading fails, the button goes to the guide on GitHub.
- **Try the live demo** opens a wide side panel (full screen on phones) with `/demo/` in a frame:
  Minty itself with made-up data, running in the visitor's browser (the real dashboard and Worker
  over sql.js; nothing is sent anywhere). It's built from rg-code/minty by `deploy.mjs` into
  `public/demo/`, which isn't committed here; see Minty's `docs/demo.md`. `#demo` opens it
  directly, and the frame starts loading when the button is hovered or focused.
- **Under the main card:** three cards, a third of its width each (stacked on phones): **Share Minty**,
  **Support Minty** (PayPal, the inKind referral, and Buy Me a Coffee and card referrals once they
  have a link: `SUPPORT` in the page script) and **Contact me**.
- **Support Minty** (top right) opens a menu: PayPal, Buy Me a Coffee, the inKind referral, card
  referrals, Star on GitHub, and sharing the repo's link. Empty links stay hidden.
- **Contact me** opens a small form that posts to Inkling's Worker (rg-code/RInkU, `POST /contact`).
  It emails the owner with the visitor's address as Reply-To, so no address of the owner's is on
  this page. It has a honeypot field and daily limits (3 per visitor, 20 in all), and only counts are kept.
- **GoatCounter** (the shared `rg-code` site, no cookies, no personal data) counts visits with
  the host in the path, as GRAZE does (`minty.milesmaximizer.com/`), plus a `<noscript>` pixel.
  Click events are named `minty-*`.

- `public/`: the page (`index.html`, no build step) and the Minty icons.

## Deploy

Builds the live demo from a Minty checkout (an up-to-date main; default `../../minty`), then
publishes `public/`. Redeploy after Minty dashboard changes so the demo follows them.

    cd minty-site && node deploy.mjs [--minty ../../minty] [--preview]

`--preview` publishes to https://preview.minty-site-853.pages.dev instead of the live site.

## Custom domain (one-time)

1. Cloudflare dashboard → **Workers & Pages → minty-site → Custom domains → Set up a custom
   domain** → `minty.milesmaximizer.com`.
2. At NameSilo, in DNS for milesmaximizer.com, add a **CNAME**: host `minty`, value
   `minty-site-853.pages.dev`. (GRAZE's `graze.milesmaximizer.com` works the same way.)
3. Wait until Cloudflare shows the domain as **Active** (usually minutes).
