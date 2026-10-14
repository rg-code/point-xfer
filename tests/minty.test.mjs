import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the Minty landing page links to the repo and the guide, with no gate", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.match(html, /href="https:\/\/github\.com\/rg-code\/minty\/blob\/main\/GET-STARTED\.md"/);
  assert.match(html, /href="https:\/\/github\.com\/rg-code\/minty\/fork"/);
  assert.match(html, /href="https:\/\/github\.com\/rg-code\/minty\/archive\/refs\/heads\/main\.zip"/);
  assert.match(html, /git clone https:\/\/github\.com\/rg-code\/minty\.git/);
  assert.doesNotMatch(html, /passphrase|\/api\//i);     // no gate, nothing logged
  assert.match(html, /id="copyLink"/);                   // share buttons
  assert.match(html, /id="shareReddit"/);
  assert.doesNotMatch(html, /id="shareText"/);
});

test("the Minty landing page is always the light mint theme, whatever the system theme", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /prefers-color-scheme/);
  assert.match(html, /<meta name="color-scheme" content="only light" \/>/);
  assert.match(html, /--bg: #f2f8f5/);
});

test("Get started opens the latest guide in a panel, and stays a GitHub link without JavaScript", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.match(html, /<a class="btn" id="getStarted" href="https:\/\/github\.com\/rg-code\/minty\/blob\/main\/GET-STARTED\.md"/);
  assert.match(html, /<dialog class="panel" id="guide"/);
  assert.match(html, /https:\/\/raw\.githubusercontent\.com\/rg-code\/minty\/main\/GET-STARTED\.md/);
  assert.match(html, /DOMPurify\.sanitize\(marked\.parse/);  // the guide is sanitized before it's shown
  for (const m of html.matchAll(/"(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)", "(sha512-[^"]+)"/g)) assert.match(m[1], /\/\d+\.\d+\.\d+\//);
  assert.equal([...html.matchAll(/"https:\/\/cdnjs\.cloudflare\.com\/[^"]+", "sha512-/g)].length, 2);
});

test("the Minty landing page counts visits in GoatCounter under its own host, with a no-JavaScript pixel", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.match(html, /window\.goatcounter = \{ path: \(p\) => location\.host \+ p \}/);
  assert.match(html, /data-goatcounter="https:\/\/rg-code\.goatcounter\.com\/count"/);
  assert.match(html, /<noscript><img src="https:\/\/rg-code\.goatcounter\.com\/count\?p=minty\.milesmaximizer\.com\//);
  for (const m of html.matchAll(/data-goatcounter-click="([^"]+)"/g)) assert.match(m[1], /^minty-/);
});

test("the Minty footer links the other projects, with the coin between them", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  const nav = html.match(/<nav class="projects"[\s\S]*?<\/nav>/)[0];
  for (const url of ["https://milesmaximizer.com/?", "https://milesmaximizer.com/inkling/?", "https://milesmaximizer.com/museum_problem/?", "https://graze.milesmaximizer.com/?"])
    assert.ok(nav.includes(`href="${url}utm_source=minty"`), url);
  assert.equal([...nav.matchAll(/class="sep" src="\/favicon\.svg"/g)].length, 3);
});

test("milesmaximizer.com/minty/ redirects to the subdomain", async () => {
  const html = await readFile(new URL("../minty/index.html", import.meta.url), "utf8");
  assert.match(html, /location\.replace\("https:\/\/minty\.milesmaximizer\.com\//);
});

test("Try the live demo opens /demo/ in a side panel, built at deploy time and never committed", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.match(html, /<a class="btn demo" id="demoOpen" href="\/demo\/" data-goatcounter-click="minty-demo-open">/);
  assert.match(html, /<dialog class="panel wide" id="demo"/);
  assert.match(html, /<iframe class="panel-frame" id="demoFrame"/);
  assert.match(html, /location\.hash === "#demo"/);
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^minty-site\/public\/demo\/$/m);
});

test("under the main card: Share, Support and Contact cards; a Support Minty menu at the top right", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.equal([...html.matchAll(/<section class="card[^"]*" aria-labelledby="(shareTitle|supportTitle|contactTitle)"/g)].length, 3);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);           // a third each
  assert.match(html, /id="supportBtn"[^>]*aria-controls="supportMenu"/);
  for (const what of ["minty-support-paypal", "minty-support-coffee", "minty-support-inkind", "minty-support-cards", "minty-support-star", "minty-support-share-repo"])
    assert.ok(html.includes(`data-goatcounter-click="${what}"`), what);
  assert.match(html, /paypal\.me\/soulrg/);
  assert.match(html, /coffee: "https:\/\/buymeacoffee\.com\/functionR"/);
  assert.match(html, /app\.inkind\.com\/refer\//);
});

test("Contact me posts to Inkling's Worker and shows no email address of the owner's", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.match(html, /const CONTACT_URL = "https:\/\/inkling-mcp\.soul-clutching\.workers\.dev\/contact"/);
  assert.match(html, /<label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1"/);   // honeypot
  assert.doesNotMatch(html, /mailto:[a-z0-9._-]+@/i);
  assert.doesNotMatch(html.replace(/you@example\.com|pat@example\.com/g, ""), /[a-z0-9._-]+@(gmail|stanford|milesmaximizer|outlook|yahoo)\./i);
});
