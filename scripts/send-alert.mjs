#!/usr/bin/env node
// Emails the alert subscribers through Inkling's Worker (rg-code/RInkU, /lists/xfer/send), which keeps
// the list and sends with Inkling's Resend account, within a daily budget it shares with Inkling.
//
//   node scripts/send-alert.mjs --digest [--dry-run]                      (the tracker's daily digest)
//   node scripts/send-alert.mjs --subject "..." --message "..." [--dry-run] (a hand-written map update)
//
// The digest goes out on the first tracker run from 9am US Eastern, at most once a day, and only when
// something is new; data/email-sent.json remembers what went out (the workflow commits it).
// Needs the XFER_ALERTS_TOKEN secret (the same value is set in rg-code/RInkU). MAIL_POSTAL_ADDRESS
// (variable, optional) adds a postal address to the footer. Without the token it says so and exits 0,
// so the tracker run never fails because email isn't set up.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { alertEmail, updateEmail, digest, digestDue } from './lib/email.mjs';
import { easternToday } from './track-promos.mjs';

export const ENDPOINT = 'https://inkling-mcp.soul-clutching.workers.dev/lists/xfer';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = (f) => path.join(ROOT, 'data', f);
const readJSON = async (f, fallback) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; }
};

async function main() {
  const { values: args } = parseArgs({
    options: { digest: { type: 'boolean' }, subject: { type: 'string' }, message: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const { XFER_ALERTS_TOKEN, MAIL_POSTAL_ADDRESS: postal = '' } = process.env;
  const dry = args['dry-run'];

  let mail;
  let idempotency;
  let state;
  let after = async () => {};
  if (args.digest) {
    const prev = await readJSON(DATA('email-sent.json'), null);
    const [{ promotions }, programs] = await Promise.all([
      readJSON(DATA('promotions.json'), { promotions: [] }),
      readJSON(DATA('programs.json'), { currencies: [], partners: [] }),
    ]);
    const today = dry ? easternToday() : digestDue(prev);
    if (!today) { console.log(`No digest due (last sent ${prev?.day || 'never'}; sends from 9am Eastern).`); return; }
    const d = digest(promotions, prev?.sent, today);
    state = { day: today, sent: d.sent };
    if (!prev) {
      // First run: everything listed now counts as sent, so nobody gets a backlog.
      if (dry) { console.log(`First run: would start data/email-sent.json with ${Object.keys(state.sent).length} bonuses, no email.`); return; }
      await writeFile(DATA('email-sent.json'), `${JSON.stringify(state, null, 2)}\n`);
      await output('sent=1');
      console.log('Started data/email-sent.json; the next new bonus goes out in a digest.');
      return;
    }
    const names = Object.fromEntries([...programs.currencies, ...programs.partners].map((p) => [p.id, p.name]));
    mail = alertEmail(d, names, { postal });
    if (!mail) { console.log(`Nothing new for ${today}.`); return; }
    idempotency = `digest-${today}`;
    after = async () => {
      await writeFile(DATA('email-sent.json'), `${JSON.stringify(state, null, 2)}\n`);
      await output('sent=1');
    };
  } else {
    mail = updateEmail(args.subject || '', args.message || '', { postal });
    if (!mail) { console.error('Nothing to send: need --digest, or --subject and --message.'); process.exit(1); }
    idempotency = `update-${process.env.GITHUB_RUN_ID || Date.now()}`;
  }

  if (dry) { console.log(`Subject: ${mail.subject}\n\n${mail.text}`); return; }
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
  await after();
}

async function output(line) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${line}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
