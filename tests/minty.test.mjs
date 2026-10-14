import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The Minty landing page itself lives in rg-code/minty-site (private); only this redirect is here.
test("milesmaximizer.com/minty/ redirects to the subdomain", async () => {
  const html = await readFile(new URL("../minty/index.html", import.meta.url), "utf8");
  assert.match(html, /location\.replace\("https:\/\/minty\.milesmaximizer\.com\//);
});
