import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE, LINES, PERSONAL, LIVE_LINES, opener, slackMessage, slackMessages } from '../scripts/lib/slack.mjs';

// Deterministic "random": returns the given values in turn.
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('every opener is addressed to someone on the list', () => {
  for (const l of [...LINES, ...LIVE_LINES]) assert.ok(l.includes('{name}'), l);
  for (const [who, lines] of Object.entries(PERSONAL)) {
    assert.ok(PEOPLE.includes(who), who);
    for (const l of lines) assert.ok(l.includes(who), l);
  }
  for (let k = 0; k < 500; k++) {
    const line = opener();
    assert.ok(PEOPLE.some((p) => new RegExp(`\\b${p}\\b`).test(line)), line);
    assert.ok(!line.includes('{name}'), line);
  }
});

test('the requested examples can all come up', () => {
  const all = new Set();
  // Walk every person × line choice.
  for (let p = 0; p < PEOPLE.length; p++) {
    const choices = LINES.length + (PERSONAL[PEOPLE[p]]?.length || 0);
    for (let l = 0; l < choices; l++) all.add(opener(seq((p + 0.5) / PEOPLE.length, (l + 0.5) / choices)));
  }
  for (const want of [
    'Time to book that western Europe trip, Robin. New bonus just dropped.',
    'Hold my beer, DanC. A new bonus was spotted.',
    "Japan called, Chantal hasn't been there in two weeks. This new bonus might help.",
    "Maui isn't the same without you, Paul. Use this bonus to get back.",
  ]) assert.ok(all.has(want), want);
});

test('personal lines only go to their person', () => {
  for (let k = 0; k < 500; k++) {
    const line = opener();
    if (line.startsWith('Japan called')) assert.match(line, /Chantal/);
    if (line.startsWith('Maui')) assert.match(line, /Paul/);
  }
});

test('message lists each bonus with dates, source and map link, escaped for Slack', () => {
  const names = { chase: 'Chase Ultimate Rewards', marriott: 'Marriott Bonvoy', bilt: 'Bilt Points', hilton: 'Hilton Honors', amex: 'Amex', lufthansa: 'Miles & More' };
  const m = slackMessage([
    { from: 'chase', to: 'marriott', bonus: 70, end: '2026-10-15', sources: [{ url: 'https://frequentmiler.com/x', feed: 'Frequent Miler' }] },
    { from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01', sources: [] },
    { from: 'amex', to: 'lufthansa', bonus: 25, end: null },
  ], names, { rand: seq(0) });
  const [first, ...rows] = m.text.split('\n');
  assert.equal(first, LINES[0].replaceAll('{name}', PEOPLE[0]));
  assert.equal(rows[0], '• *Chase Ultimate Rewards → Marriott Bonvoy: +70%* through Oct 15 (<https://frequentmiler.com/x|Frequent Miler>) <https://milesmaximizer.com/?partner=marriott|map>');
  assert.match(rows[1], /\+200%\* on Oct 1 only <https:\/\/milesmaximizer\.com\/\?partner=hilton\|map>$/);
  assert.match(rows[2], /Miles &amp; More: \+25%\* \(no end date yet\)/);
  assert.equal(m.unfurl_links, false);
});

test('go-live post uses its own openers and says "today only"', () => {
  const names = { bilt: 'Bilt Points', hilton: 'Hilton Honors' };
  const rentDay = { from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01', sources: [] };
  const posts = slackMessages({ found: [], live: [rentDay] }, names, { rand: seq(0) });
  assert.equal(posts.length, 1);
  const [first, row] = posts[0].text.split('\n');
  assert.equal(first, LIVE_LINES[0].replaceAll('{name}', PEOPLE[0]));
  assert.match(row, /\+200%\* today only/);
  assert.equal(slackMessages({ found: [rentDay], live: [rentDay] }, names).length, 2, 'announcement, then go-live');
  assert.equal(slackMessages({}, names).length, 0);
});
