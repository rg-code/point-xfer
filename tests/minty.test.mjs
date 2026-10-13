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
});

test("milesmaximizer.com/minty/ redirects to the subdomain", async () => {
  const html = await readFile(new URL("../minty/index.html", import.meta.url), "utf8");
  assert.match(html, /location\.replace\("https:\/\/minty\.milesmaximizer\.com\//);
});
