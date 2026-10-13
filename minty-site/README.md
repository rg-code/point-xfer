# minty.milesmaximizer.com

The Minty landing page: a passphrase gate in front of the links to fork, download or clone
[rg-code/minty](https://github.com/rg-code/minty), and its Get started guide, with share buttons.
A Cloudflare Pages project (`minty-site`, live at https://minty-site-853.pages.dev); it isn't
part of this site's GitHub Pages build. `milesmaximizer.com/minty/` (`../minty/index.html`)
redirects here.

- `public/`: the page (`index.html`, no build step) and the Minty icons.
- `functions/api/check.js`: `POST /api/check {passphrase}`. It logs **every** passphrase entered to
  the D1 database `minty-gate` (table `entries`, see `schema.sql`), right or wrong, with the time
  and Cloudflare's country guess. It stores a hash of the visitor's IP only to allow 6 tries a
  minute; the IP itself isn't stored. A passphrase is right when it starts with an accepted
  prefix and a dash, ignoring case: `TLS-maria` for the prefix `TLS`. Only then are the links
  returned. It's a basic gate: the links point at a public repo.

## Change the accepted prefixes

They're the `GATE_PREFIXES` secret (comma-separated, e.g. `TLS,FRIENDS`), kept out of this
public repo:

    printf 'TLS,FRIENDS' | npx wrangler pages secret put GATE_PREFIXES --project-name minty-site

Then redeploy (below) for it to take effect.

## Read the log

Cloudflare dashboard → **Storage & databases → D1 → minty-gate → Console**:

    SELECT created_at, passphrase, matched, country FROM entries ORDER BY id DESC LIMIT 100;

Or from here: `npx wrangler d1 execute minty-gate --remote --command "SELECT …"`.

## Deploy

    cd minty-site && npx wrangler pages deploy public --project-name minty-site --branch main

## Custom domain (one-time)

1. Cloudflare dashboard → **Workers & Pages → minty-site → Custom domains → Set up a custom
   domain** → `minty.milesmaximizer.com`.
2. At NameSilo, in DNS for milesmaximizer.com, add a **CNAME**: host `minty`, value
   `minty-site-853.pages.dev`. (GRAZE's `graze.milesmaximizer.com` works the same way.)
3. Wait until Cloudflare shows the domain as **Active** (usually minutes).
