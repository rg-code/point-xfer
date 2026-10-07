import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertEmail, updateEmail, withPostal, UNSUBSCRIBE, POSTAL } from '../scripts/lib/email.mjs';
import worker, { sign, verify, b64url, unb64url, validEmail, normalizeEmail } from '../worker/src/index.js';

const names = { chase: 'Chase Ultimate Rewards', marriott: 'Marriott Bonvoy', bilt: 'Bilt Points', hilton: 'Hilton Honors', amex: 'Amex', lufthansa: 'Miles & More' };

// ---------- Alert emails ----------

test('alert email: subject, sections, map links only, unsubscribe and postal placeholders', () => {
  const one = alertEmail({ found: [{ from: 'chase', to: 'marriott', bonus: 70, end: '2026-10-15' }] }, names);
  assert.equal(one.subject, 'New transfer bonus: Chase Ultimate Rewards → Marriott Bonvoy +70%');
  for (const part of [one.html, one.text]) {
    assert.ok(part.includes(UNSUBSCRIBE), 'unsubscribe link');
    assert.ok(part.includes(POSTAL), 'postal address placeholder');
    assert.ok(part.includes('https://milesmaximizer.com/?partner=marriott'));
    assert.ok(part.includes('through Oct 15'));
  }
  assert.ok(!/frequentmiler|awardwallet|thepointsguy/.test(one.html), 'no blog links');

  const many = alertEmail({
    found: [{ from: 'amex', to: 'lufthansa', bonus: 25, end: null }],
    live: [{ from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01' }],
  }, names);
  assert.equal(many.subject, '2 transfer bonuses: Amex → Miles & More +25% and more');
  assert.match(many.html, /Miles &amp; More/, 'names are escaped in HTML');
  assert.match(many.text, /Live today\n- Bilt Points → Hilton Honors: \+200% today only/);
  assert.equal(alertEmail({}, names), null);
  assert.equal(alertEmail({ live: [{ from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01' }] }, names).subject,
    'Live today: Bilt Points → Hilton Honors +200%');
});

test('map update email keeps paragraphs and escapes HTML', () => {
  const m = updateEmail('Bilt → Hyatt goes to 4:3', 'Bilt is changing Hyatt <transfers>.\n\nTransfer before Jan 1 to keep 1:1.');
  assert.equal((m.html.match(/<p>/g) || []).length, 3, 'two message paragraphs plus the map link');
  assert.match(m.html, /&lt;transfers&gt;/);
  assert.ok(m.text.startsWith('Bilt is changing Hyatt <transfers>.\n\nTransfer before Jan 1'));
});

test('no email goes out without a postal address (CAN-SPAM)', () => {
  const m = updateEmail('s', 'body');
  assert.throws(() => withPostal(m, ''), /MAIL_POSTAL_ADDRESS/);
  const filled = withPostal(m, 'PO Box 1 & Co, Palo Alto CA');
  assert.ok(filled.html.includes('PO Box 1 &amp; Co') && filled.text.includes('PO Box 1 & Co'));
  assert.ok(!filled.html.includes(POSTAL));
});

// ---------- Worker helpers ----------

test('worker signing round-trips and rejects tampering', async () => {
  const sig = await sign('s3cret', 'a@b.co|123');
  assert.ok(await verify('s3cret', 'a@b.co|123', sig));
  assert.equal(await verify('s3cret', 'a@b.co|124', sig), false, 'other data');
  assert.equal(await verify('other', 'a@b.co|123', sig), false, 'other secret');
  assert.equal(await verify('s3cret', 'a@b.co|123', 'not-base64!!'), false);
  assert.equal(unb64url(b64url('rené+tag@exämple.com')), 'rené+tag@exämple.com');
  assert.equal(unb64url('%%%'), '');
});

test('worker email validation', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.org']) assert.ok(validEmail(normalizeEmail(ok)), ok);
  for (const bad of ['', 'a@b', 'no-at.example.com', 'a b@c.com', '<x>@y.com', `${'a'.repeat(250)}@b.com`]) assert.equal(validEmail(normalizeEmail(bad)), false, bad);
  assert.equal(normalizeEmail('  Me@Example.COM '), 'me@example.com');
});

// ---------- Worker flow, with Resend faked ----------

const env = {
  RESEND_API_KEY: 're_test', SIGNING_SECRET: 'test-secret', RESEND_SEGMENT_ID: 'seg_1',
  ALLOWED_ORIGIN: 'https://milesmaximizer.com', SITE_URL: 'https://milesmaximizer.com',
  FROM_ADDRESS: 'Miles Maximizer <alerts@milesmaximizer.com>', POSTAL_ADDRESS: 'PO Box 1',
};
const W = 'https://point-xfer-alerts.example.workers.dev';

function fakeResend(responses = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const status = responses[`${init.method} ${path}`] ?? 200;
    return new Response(JSON.stringify({ id: 'x' }), { status });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const post = (body, origin = env.ALLOWED_ORIGIN) => new Request(`${W}/subscribe`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('signup: origin check, honeypot, bad email, then a confirmation email with a signed link', async () => {
  const r = fakeResend();
  try {
    assert.equal((await worker.fetch(post({ email: 'a@b.co' }, 'https://evil.example'), env)).status, 403);
    assert.equal((await worker.fetch(post({ email: 'a@b.co', website: 'spam' }), env)).status, 202);
    assert.equal((await worker.fetch(post({ email: 'nope' }), env)).status, 400);
    assert.equal(r.calls.length, 0, 'nothing sent so far');

    const res = await worker.fetch(post({ email: ' Reader@Example.com ' }), env);
    assert.equal(res.status, 202);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
    const [mail] = r.calls;
    assert.equal(mail.path, '/emails');
    assert.deepEqual(mail.body.to, ['reader@example.com']);
    assert.match(mail.body.text, /PO Box 1/);
    assert.match(mail.body.html, new RegExp(`${W}/confirm\\?e=`));
  } finally { r.restore(); }
});

test('confirm: a valid link adds the contact to the segment; a tampered one is turned away', async () => {
  const r = fakeResend();
  try {
    await worker.fetch(post({ email: 'reader@example.com' }), env);
    const link = r.calls[0].body.text.match(/https:\/\/\S+\/confirm\?\S+/)[0];

    const ok = await worker.fetch(new Request(link), env);
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('Location'), 'https://milesmaximizer.com/?alerts=subscribed');
    assert.deepEqual(r.calls[1], { path: '/contacts', method: 'POST', body: { email: 'reader@example.com', unsubscribed: false, segments: [{ id: 'seg_1' }] } });

    const bad = await worker.fetch(new Request(link.replace(/t=[^&]+/, 't=AAAA')), env);
    assert.equal(bad.headers.get('Location'), 'https://milesmaximizer.com/?alerts=expired');
    const other = await worker.fetch(new Request(link.replace(/e=[^&]+/, `e=${b64url('someone@else.com')}`)), env);
    assert.equal(other.headers.get('Location'), 'https://milesmaximizer.com/?alerts=expired', 'link is bound to its address');
    assert.equal(r.calls.length, 2, 'bad links never reach Resend');
  } finally { r.restore(); }
});

test('confirm: an existing contact is re-subscribed and added to the segment', async () => {
  const r = fakeResend({ 'POST /contacts': 422 });
  try {
    await worker.fetch(post({ email: 'back@example.com' }), env);
    const link = r.calls[0].body.text.match(/https:\/\/\S+\/confirm\?\S+/)[0];
    const res = await worker.fetch(new Request(link), env);
    assert.equal(res.headers.get('Location'), 'https://milesmaximizer.com/?alerts=subscribed');
    assert.deepEqual(r.calls.slice(2).map((c) => `${c.method} ${c.path}`), ['PATCH /contacts/back%40example.com', 'POST /contacts/back%40example.com/segments/seg_1']);
  } finally { r.restore(); }
});

test('confirm: an expired link is turned away', async () => {
  const x = Math.floor(Date.now() / 1000) - 10;
  const t = await sign(env.SIGNING_SECRET, `old@example.com|${x}`);
  const res = await worker.fetch(new Request(`${W}/confirm?e=${b64url('old@example.com')}&x=${x}&t=${t}`), env);
  assert.equal(res.headers.get('Location'), 'https://milesmaximizer.com/?alerts=expired');
});
