#!/usr/bin/env node
// Bundles index.html, CSS, JS, the three data files and egg images into dist/preview.html,
// a single file you can open straight from disk or share as an attachment.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (f) => readFile(path.join(ROOT, f), 'utf8');

const [html, css, advice, js, programs, transfers, promotions] = await Promise.all([
  r('index.html'), r('assets/styles.css'), r('assets/advice.js'), r('assets/app.js'),
  r('data/programs.json'), r('data/transfers.json'), r('data/promotions.json'),
]);

// Easter egg images are referenced from app.js; inline them so the single file keeps them.
const eggs = await Promise.all([...new Set(js.match(/assets\/eggs\/[\w.-]+\.webp/g) || [])].map(async (f) =>
  [f, `data:image/webp;base64,${(await readFile(path.join(ROOT, f))).toString('base64')}`]));
const jsInlined = eggs.reduce((s, [f, uri]) => s.replaceAll(f, uri), js);

const data = JSON.stringify({ programs: JSON.parse(programs), transfers: JSON.parse(transfers), promotions: JSON.parse(promotions) })
  .replace(/</g, '\\u003c');

const out = html
  .replace('<script>\n    // Apply a saved theme', '<script>\n    window.__NO_STORAGE__ = true;\n    // Apply a saved theme')
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, '')
  .replace('<link rel="stylesheet" href="assets/styles.css">', () => `<style>\n${css}</style>`)
  .replace('<script src="assets/advice.js" defer></script>', () => `<script>\n${advice}</script>`)
  .replace('<script src="assets/app.js" defer></script>', () => `<script>window.__TRANSFER_DATA__ = ${data};</script>\n  <script>\n${jsInlined}</script>`);

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
await writeFile(path.join(ROOT, 'dist/preview.html'), out);
console.log('Wrote dist/preview.html');
