#!/usr/bin/env node
// Sends an email to every bonus-alert subscriber as one Resend broadcast.
//
//   node scripts/send-alert.mjs --file $RUNNER_TEMP/alert-email.json      (the tracker's new-bonus email)
//   node scripts/send-alert.mjs --subject "..." --message "..." [--dry-run] (a hand-written map update)
//
// Needs RESEND_API_KEY (secret), RESEND_SEGMENT_ID, MAIL_FROM and MAIL_POSTAL_ADDRESS (variables).
// Without them it says so and exits 0, so the tracker run never fails because email isn't set up.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { updateEmail, withPostal } from './lib/email.mjs';

const { values: args } = parseArgs({
  options: { file: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' }, 'dry-run': { type: 'boolean' } },
});
const { RESEND_API_KEY, RESEND_SEGMENT_ID, MAIL_FROM, MAIL_POSTAL_ADDRESS } = process.env;

const mail = args.file
  ? JSON.parse(await readFile(args.file, 'utf8'))
  : updateEmail(args.subject || '', args.message || '');
if (!mail?.subject || !mail.html) { console.error('Nothing to send: need --file, or --subject and --message.'); process.exit(1); }

if (args['dry-run']) {
  console.log(`Subject: ${mail.subject}\n\n${(MAIL_POSTAL_ADDRESS ? withPostal(mail, MAIL_POSTAL_ADDRESS) : mail).text}`);
  process.exit(0);
}
const missing = Object.entries({ RESEND_API_KEY, RESEND_SEGMENT_ID, MAIL_FROM, MAIL_POSTAL_ADDRESS }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.log(`Email alerts not configured (missing ${missing.join(', ')}), skipping.`); process.exit(0); }

const res = await fetch('https://api.resend.com/broadcasts', {
  method: 'POST',
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ segment_id: RESEND_SEGMENT_ID, from: MAIL_FROM, name: mail.subject.slice(0, 80), send: true, ...withPostal(mail, MAIL_POSTAL_ADDRESS) }),
});
const body = await res.text();
if (!res.ok) { console.log(`::warning::Email broadcast failed (${res.status}): ${body}`); process.exit(1); }
console.log(`Sent "${mail.subject}" to the subscriber segment: ${body}`);
