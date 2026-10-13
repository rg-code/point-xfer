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
