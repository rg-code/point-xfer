import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matches } from "../minty-site/functions/api/check.js";

test("the Minty gate accepts <prefix>-<anything>, ignoring case, and nothing else", () => {
  assert.equal(matches("TLS-maria", "TLS"), true);
  assert.equal(matches("tls-maria", "TLS"), true);
  assert.equal(matches("  TLS-x  ", "TLS"), true);
  assert.equal(matches("FRIENDS-1", "TLS, FRIENDS"), true);
  assert.equal(matches("TLS-", "TLS"), false);         // a name after the dash is needed
  assert.equal(matches("TLS", "TLS"), false);
  assert.equal(matches("TLSmaria", "TLS"), false);
  assert.equal(matches("XTLS-maria", "TLS"), false);
  assert.equal(matches("TLS-maria", ""), false);       // no prefixes set: nobody gets in
  assert.equal(matches("TLS-maria", undefined), false);
});

test("the landing page keeps the accepted prefixes and links out of its source", async () => {
  const html = await readFile(new URL("../minty-site/public/index.html", import.meta.url), "utf8");
  assert.match(html, /fetch\("\/api\/check"/);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(html, /TLS/);
  assert.doesNotMatch(html, /github\.com\/rg-code\/minty/);   // the links come from the gate
});

test("milesmaximizer.com/minty/ redirects to the subdomain", async () => {
  const html = await readFile(new URL("../minty/index.html", import.meta.url), "utf8");
  assert.match(html, /location\.replace\("https:\/\/minty\.milesmaximizer\.com\//);
});
