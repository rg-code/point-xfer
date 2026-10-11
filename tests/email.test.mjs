import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusEmail, changeEmail, routeChanges, STOP } from '../scripts/lib/email.mjs';

const names = { chase: 'Chase Ultimate Rewards', marriott: 'Marriott Bonvoy', bilt: 'Bilt Points', hilton: 'Hilton Honors', amex: 'Amex', lufthansa: 'Miles & More', citi: 'Citi', jal: 'JAL', hyatt: 'Hyatt', etihad: 'Etihad' };

test('bonus email: subject, map links only, stop link', () => {
  const one = bonusEmail([{ from: 'chase', to: 'marriott', bonus: 70, end: '2026-10-15' }], names);
  assert.equal(one.subject, 'New transfer bonus: Chase Ultimate Rewards → Marriott Bonvoy +70%');
  for (const part of [one.html, one.text]) {
    assert.ok(part.includes(STOP), 'the Worker fills in each stop link here, and refuses mail without it');
    assert.ok(part.includes('https://milesmaximizer.com/?partner=marriott'));
    assert.ok(part.includes('through Oct 15'));
  }
  assert.ok(!/frequentmiler|awardwallet|thepointsguy/.test(one.html), 'no blog links');

  const many = bonusEmail([
    { from: 'amex', to: 'lufthansa', bonus: 25, end: null },
    { from: 'bilt', to: 'hilton', bonus: 200, start: '2026-11-01', end: '2026-11-01' },
  ], names);
  assert.equal(many.subject, '2 new transfer bonuses: Amex → Miles & More +25% and more');
  assert.match(many.html, /Miles &amp; More/, 'names are escaped in HTML');
  assert.match(many.text, /Bilt Points → Hilton Honors: \+200% on Nov 1 only/);
  assert.equal(bonusEmail([], names), null);
});

test('route changes: added, removed and re-rated routes; notes and times ignored', () => {
  const before = { transfers: [
    { from: 'amex', to: 'etihad', ratio: [1, 1] },
    { from: 'chase', to: 'hyatt', ratio: [1, 1], time: { min: 0, max: 0 } },
    { from: 'chase', to: 'marriott', ratio: [1, 1], note: 'old' },
  ] };
  const after = { transfers: [
    { from: 'chase', to: 'hyatt', ratio: [4, 3], time: { min: 0, max: 0 } },
    { from: 'chase', to: 'marriott', ratio: [1, 1], note: 'new note', time: { min: 1, max: 2, unit: 'days' } },
    { from: 'citi', to: 'jal', ratio: [1, 1] },
  ] };
  const c = routeChanges(before, after);
  assert.deepEqual([c.added.map((t) => t.to), c.removed.map((t) => t.to), c.changed.map((t) => t.to)], [['jal'], ['etihad'], ['hyatt']]);

  const m = changeEmail(c, names);
  assert.equal(m.subject, '3 transfer partner changes');
  assert.match(m.text, /Citi adds JAL at 1,000 → 1,000\./);
  assert.match(m.text, /Amex drops Etihad\./);
  assert.match(m.text, /Chase Ultimate Rewards → Hyatt goes from 1,000 → 1,000 to 1,000 → 750\./);
  assert.ok(m.html.includes(STOP) && m.text.includes(STOP));

  assert.equal(changeEmail(routeChanges(before, before), names), null, 'no change, no email');
  assert.equal(changeEmail(routeChanges({ transfers: [{ from: 'citi', to: 'jal', ratio: [1, 1] }] }, { transfers: [{ from: 'citi', to: 'jal', ratio: [1, 1], note: 'x' }] }), names), null);
  assert.equal(changeEmail({ added: [{ from: 'citi', to: 'jal', ratio: [1, 2] }] }, names).subject, 'Transfer partner change: Citi adds JAL at 1,000 → 2,000');
});

test('card-specific rate changes are announced too', () => {
  const v = (r) => ({ transfers: [{ from: 'chase', to: 'hyatt', ratio: [1, 1], variants: [{ label: 'Preferred', ratio: r }] }] });
  const m = changeEmail(routeChanges(v([1, 1]), v([4, 3])), names);
  assert.match(m.text, /Chase Ultimate Rewards → Hyatt changes its card-specific rates\./);
});

test('postal address is optional and escaped', () => {
  const found = [{ from: 'chase', to: 'marriott', bonus: 70, end: '2026-10-15' }];
  assert.ok(bonusEmail(found, names).text.endsWith(`Unsubscribe: ${STOP}`));
  const withIt = bonusEmail(found, names, { postal: 'PO Box 1 & Co, Palo Alto CA' });
  assert.ok(withIt.html.includes('PO Box 1 &amp; Co') && withIt.text.endsWith('PO Box 1 & Co, Palo Alto CA'));
});
