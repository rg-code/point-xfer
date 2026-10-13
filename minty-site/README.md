# minty.milesmaximizer.com

The Minty landing page: links to fork, download or clone
[rg-code/minty](https://github.com/rg-code/minty) and its Get started guide, with share buttons.
A static Cloudflare Pages project (`minty-site`, live at https://minty-site-853.pages.dev),
not part of this site's GitHub Pages build. `milesmaximizer.com/minty/` (`../minty/index.html`)
redirects here. No forms, no data collected.

- `public/`: the page (`index.html`, no build step) and the Minty icons.

## Deploy

    cd minty-site && npx wrangler pages deploy public --project-name minty-site --branch main

## Custom domain (one-time)

1. Cloudflare dashboard → **Workers & Pages → minty-site → Custom domains → Set up a custom
   domain** → `minty.milesmaximizer.com`.
2. At NameSilo, in DNS for milesmaximizer.com, add a **CNAME**: host `minty`, value
   `minty-site-853.pages.dev`. (GRAZE's `graze.milesmaximizer.com` works the same way.)
3. Wait until Cloudflare shows the domain as **Active** (usually minutes).
