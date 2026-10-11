#!/usr/bin/env node
// Emails the alert subscribers through Inkling's Worker (rg-code/RInkU, /lists/xfer/send), which keeps
// the list and does the sending. Only for changes:
//
//   node scripts/send-alert.mjs --bonuses $RUNNER_TEMP/new-bonuses.json [--dry-run]
//       new bonuses the tracker found this run (track-promos.yml)
//   node scripts/send-alert.mjs --changes old-transfers.json [--old-programs old-programs.json] [--dry-run]
//       routes added, removed or re-rated in data/transfers.json since that version (email-changes.yml)
//
// Needs the XFER_ALERTS_TOKEN secret (the same value is set in rg-code/RInkU). MAIL_POSTAL_ADDRESS
// (variable, optional) adds a postal address to the footer. Without the token it says so and exits 0,
// so a workflow never fails because email isn't set up.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { bonusEmail, changeEmail, routeChanges } from './lib/email.mjs';

export const ENDPOINT = 'https://inkling-mcp.soul-clutching.workers.dev/lists/xfer';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = (f) => path.join(ROOT, 'data', f);
const readJSON = async (f, fallback) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; }
};
const namesOf = (...programs) => Object.fromEntries(programs.flatMap((p) => [...(p?.currencies || []), ...(p?.partners || [])]).map((p) => [p.id, p.name]));
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

async function main() {
  const { values: args } = parseArgs({
    options: { bonuses: { type: 'string' }, changes: { type: 'string' }, 'old-programs': { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const { XFER_ALERTS_TOKEN, MAIL_POSTAL_ADDRESS: postal = '' } = process.env;
  const programs = await readJSON(DATA('programs.json'), {});

  let mail;
  let idempotency;
  if (args.bonuses) {
    const found = await readJSON(args.bonuses, []);
    mail = bonusEmail(found, namesOf(programs), { postal });
    idempotency = `bonus-${hash(found.map((p) => p.id).sort().join(','))}`;
  } else if (args.changes) {
    const before = await readJSON(args.changes, null);
    if (!before) { console.log(`No earlier transfers.json at ${args.changes}, nothing to compare.`); return; }
    const oldPrograms = args['old-programs'] ? await readJSON(args['old-programs'], {}) : {};
    mail = changeEmail(routeChanges(before, await readJSON(DATA('transfers.json'), {})), namesOf(oldPrograms, programs), { postal });
    idempotency = `routes-${hash(mail?.text || '')}`;
  } else {
    console.error('Need --bonuses <file> or --changes <old transfers.json>.');
    process.exit(1);
  }
  if (!mail) { console.log('Nothing to email.'); return; }

  if (args['dry-run']) { console.log(`Subject: ${mail.subject}\n\n${mail.text}`); return; }
  if (!XFER_ALERTS_TOKEN) { console.log('Email alerts not configured (missing XFER_ALERTS_TOKEN), skipping.'); return; }

  const res = await fetch(`${process.env.ALERTS_ENDPOINT || ENDPOINT}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${XFER_ALERTS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...mail, idempotency }),
  });
  const body = await res.text();
  if (!res.ok) { console.log(`::warning::Email send failed (${res.status}): ${body.slice(0, 300)}`); process.exit(1); }
  console.log(`Sent "${mail.subject}": ${body}`);
  const r = JSON.parse(body);
  if (r.skipped) console.log(`::warning::${r.skipped} subscribers skipped: the list's daily email budget ran out.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
