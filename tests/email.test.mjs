import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertEmail, updateEmail, digest, digestDue, STOP } from '../scripts/lib/email.mjs';

const names = { chase: 'Chase Ultimate Rewards', marriott: 'Marriott Bonvoy', bilt: 'Bilt Points', hilton: 'Hilton Honors', amex: 'Amex', lufthansa: 'Miles & More' };

test('alert email: subject, sections, map links only, stop link', () => {
  const one = alertEmail({ found: [{ from: 'chase', to: 'marriott', bonus: 70, end: '2026-10-15' }] }, names);
  assert.equal(one.subject, 'New transfer bonus: Chase Ultimate Rewards → Marriott Bonvoy +70%');
  for (const part of [one.html, one.text]) {
    assert.ok(part.includes(STOP), 'the Worker fills in each stop link here, and refuses mail without it');
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

test('postal address is optional and escaped', () => {
  const without = updateEmail('s', 'body');
  assert.ok(without.text.endsWith(`Unsubscribe: ${STOP}`));
  const withIt = updateEmail('s', 'body', { postal: 'PO Box 1 & Co, Palo Alto CA' });
  assert.ok(withIt.html.includes('PO Box 1 &amp; Co') && withIt.text.endsWith('PO Box 1 & Co, Palo Alto CA'));
});

test('map update email keeps paragraphs and escapes HTML', () => {
  const m = updateEmail('Bilt → Hyatt goes to 4:3', 'Bilt is changing Hyatt <transfers>.\n\nTransfer before Jan 1 to keep 1:1.');
  assert.equal((m.html.match(/<p>/g) || []).length, 3, 'two message paragraphs plus the map link');
  assert.match(m.html, /&lt;transfers&gt;/);
  assert.ok(m.text.startsWith('Bilt is changing Hyatt <transfers>.\n\nTransfer before Jan 1'));
  assert.equal(updateEmail('', 'body'), null);
  assert.equal(updateEmail('s', '  '), null);
});

test('digest: new bonuses once, announced ones again when they go live, expired ones forgotten', () => {
  const running = { id: 'a', start: null, end: '2026-10-31' };
  const upcoming = { id: 'b', start: '2026-11-01', end: '2026-11-01' };
  const ended = { id: 'c', start: null, end: '2026-10-09' };

  let d = digest([running, upcoming, ended], {}, '2026-10-10');
  assert.deepEqual(d.found.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(d.live, []);
  assert.deepEqual(d.sent, { a: 'live', b: 'upcoming' });

  d = digest([running, upcoming], d.sent, '2026-10-11');
  assert.deepEqual([d.found, d.live], [[], []], 'nothing new the next day');

  d = digest([running, upcoming], d.sent, '2026-11-01');
  assert.deepEqual(d.live.map((p) => p.id), ['b'], 'live on its day');
  assert.deepEqual(d.sent, { b: 'live' }, 'a ended and is dropped');

  d = digest([upcoming], d.sent, '2026-11-01');
  assert.deepEqual([d.found, d.live], [[], []], 'live goes out once');

  const late = digest([{ id: 'x', start: '2026-10-01', end: '2026-10-20' }], {}, '2026-10-10');
  assert.deepEqual([late.found.length, late.live.length], [1, 0], 'found already running: one mention');
});

test('digest is due once a day, from 9am US Eastern', () => {
  const at = (iso) => new Date(iso);
  assert.equal(digestDue(null, at('2026-10-10T12:59:00Z')), null, '8:59am EDT');
  assert.equal(digestDue(null, at('2026-10-10T13:17:00Z')), '2026-10-10', '9:17am EDT');
  assert.equal(digestDue({ day: '2026-10-10' }, at('2026-10-10T20:00:00Z')), null, 'already sent today');
  assert.equal(digestDue({ day: '2026-10-10' }, at('2026-10-11T03:30:00Z')), null, '11:30pm EDT is still the 10th');
  assert.equal(digestDue({ day: '2026-12-01' }, at('2026-12-02T14:17:00Z')), '2026-12-02', '9:17am EST');
});
