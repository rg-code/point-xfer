#!/usr/bin/env node
// Deploys minty.milesmaximizer.com: builds Minty's live demo from a Minty checkout into
// public/demo/ (not committed), then publishes public/ to the minty-site Pages project.
//
//   node deploy.mjs [--minty ../../minty] [--preview]
//
// --minty: the rg-code/minty checkout to build the demo from (use an up-to-date main).
// --preview: publish to https://preview.minty-site-853.pages.dev instead of the live site.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const minty = resolve(here, arg("minty", "../../minty"));
const branch = process.argv.includes("--preview") ? "preview" : "main";
const demo = join(here, "public/demo");

if (!existsSync(join(minty, "scripts/build-demo.mjs"))) throw new Error(`no Minty checkout with scripts/build-demo.mjs at ${minty} (pass --minty)`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run("npm", ["run", "--silent", "build:demo", "--", "--out", demo, "--goatcounter", "https://rg-code.goatcounter.com/count"], minty);
for (const f of ["index.html", "demo.js", "demo.css", "abc.js", "abc.css"]) {
  if (!existsSync(join(demo, f)) || statSync(join(demo, f)).size === 0) throw new Error(`demo build is missing ${f}`);
}
try {
  run("npx", ["wrangler", "pages", "deploy", "public", "--project-name", "minty-site", "--branch", branch, "--commit-dirty=true"], here);
} finally {
  rmSync(join(here, ".wrangler"), { recursive: true, force: true });   // wrangler's cache holds account details
}
