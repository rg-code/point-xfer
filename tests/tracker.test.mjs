import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, extractPromotions, extractBonus, extractEndDate } from '../scripts/lib/parse.mjs';
import { merge, isActive, easternToday } from '../scripts/track-promos.mjs';

const programs = JSON.parse(readFileSync(new URL('../data/programs.json', import.meta.url)));
const { transfers } = JSON.parse(readFileSync(new URL('../data/transfers.json', import.meta.url)));
const valid = new Set(transfers.map((t) => `${t.from}>${t.to}`));
const item = (title, summary = '', published = '2026-09-02T12:00:00Z') => ({ title, summary, published, link: 'https://example.com/x' });

test('headline with several Avios programs yields one promo each', () => {
  const r = extractPromotions(item('Amex: 30% Transfer Bonus To British Airways, Iberia & Aer Lingus (Through 9/27)'), valid);
  assert.deepEqual(r.map((p) => p.to).sort(), ['aerlingus', 'ba', 'iberia']);
  assert.ok(r.every((p) => p.from === 'amex' && p.bonus === 30 && p.end === '2026-09-27'));
});

test('named-month end date and "up to" bonuses', () => {
  const [p] = extractPromotions(item('Chase offering up to 30% transfer bonus to Air Canada Aeroplan', 'The offer runs through Sept. 30, 2026.'), valid);
  assert.equal(p.to, 'aeroplan');
  assert.equal(p.bonus, 30);
  assert.equal(p.end, '2026-09-30');
});

test('routes that do not exist are dropped', () => {
  // Chase does not transfer to Delta, so this must not produce a record.
  assert.equal(extractPromotions(item('Chase 25% transfer bonus to Delta SkyMiles'), valid).length, 0);
});

test('hotel-to-airline bonuses without a bank currency are ignored', () => {
  assert.equal(extractPromotions(item('Marriott 25% transfer bonus to Cathay Pacific Asia Miles'), valid).length, 0);
});

test('"from" phrasing still finds the source', () => {
  const [p] = extractPromotions(item('Get a 70% bonus transferring to Marriott Bonvoy from Chase Ultimate Rewards'), valid);
  assert.equal(p.from, 'chase');
  assert.equal(p.to, 'marriott');
});

test('American Express is not mistaken for American Airlines', () => {
  const r = extractPromotions(item('American Express 25% transfer bonus to Delta'), valid);
  assert.deepEqual(r.map((p) => [p.from, p.to]), [['amex', 'delta']]);
});

test('one-day offers end on their publish date', () => {
  const [p] = extractPromotions(item('Flash sale: 50% transfer bonus from Chase to World of Hyatt', 'Today only.', '2026-09-12T15:00:00Z'), valid);
  assert.deepEqual([p.start, p.end], [null, '2026-09-12']);
});

test('Rent Day is dated to the nearest 1st, including previews posted the evening before', () => {
  const rentDay = (published) => extractPromotions(item('Bilt Rent Day: up to 100% transfer bonus to World of Hyatt', 'Today only.', published), valid)[0];
  const on = (p) => [p.start, p.end];
  assert.deepEqual(on(rentDay('2026-09-01T12:00:00Z')), ['2026-09-01', '2026-09-01'], 'morning of');
  assert.deepEqual(on(rentDay('2026-09-30T22:00:00Z')), ['2026-10-01', '2026-10-01'], 'preview, 6pm ET the day before');
  assert.deepEqual(on(rentDay('2026-09-05T15:00:00Z')), ['2026-09-01', '2026-09-01'], 'recap a few days later');
  assert.deepEqual(on(rentDay('2026-12-31T20:00:00Z')), ['2027-01-01', '2027-01-01'], 'year rollover');
});

test('a Bilt preview naming the 1st counts as Rent Day without saying so', () => {
  const [p] = extractPromotions(item('Bilt Offers Up To 125% Amtrak Bonus October 1—Plus Instant Hilton Diamond For Platinum Members',
    "Platinum members can turn Bilt points into Amtrak points at 1:1, or make a small Hilton transfer for instant Diamond status. Hilton's bigger 200% transfer bonus still doesn't make its points a good speculative transfer.",
    '2026-09-25T13:33:17Z'), valid);
  assert.deepEqual([p.from, p.to, p.bonus, p.start, p.end], ['bilt', 'hilton', 200, '2026-10-01', '2026-10-01']);
  const [q] = extractPromotions(item('Chase 30% transfer bonus to Hyatt through October 1'), valid);
  assert.equal(q.start, null, 'only Bilt headlines get the Rent Day treatment');
});

test('a Rent Day post dates a bonus already stored as open-ended', () => {
  const stored = { id: 'bilt-hilton-200', from: 'bilt', to: 'hilton', bonus: 200, start: null, end: null, assumedEnd: '2026-10-25', firstSeen: '2026-09-25', sources: [] };
  const c = { from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01', published: '2026-09-25T13:33:17Z', title: 't', url: 'https://viewfromthewing.com/x', source: 'View from the Wing' };
  const [p] = merge({ existing: { promotions: [stored] }, candidates: [c], manual: {}, day: '2026-09-26' }).promotions;
  assert.deepEqual([p.start, p.end, p.assumedEnd], ['2026-10-01', '2026-10-01', undefined]);
  assert.ok(!isActive(p, '2026-09-26'), 'hidden until Rent Day');
});

test('a bonus announced ahead gets one go-live post, on the Eastern date, exactly once', () => {
  const preview = { from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01', published: '2026-09-25T13:33:17Z', title: 't', url: 'https://viewfromthewing.com/x', source: 'View from the Wing' };
  const run = (existing, day, liveDay = day) => merge({ existing, candidates: [preview], manual: {}, day, liveDay });
  const r1 = run({}, '2026-09-25');
  assert.deepEqual([r1.newlyFound.length, r1.goingLive.length], [1, 0], 'announced');
  const r2 = run(r1, '2026-10-01', '2026-09-30');
  assert.equal(r2.goingLive.length, 0, '02:17 UTC is still Sept 30 in New York');
  const r3 = run(r2, '2026-10-01');
  assert.deepEqual(r3.goingLive.map((p) => p.id), ['bilt-hilton-200'], 'live post');
  assert.equal(r3.promotions[0].livePosted, true);
  const r4 = run(r3, '2026-10-01');
  assert.equal(r4.goingLive.length, 0, 'not posted twice');
});

test('one post only when announced on the day, found late, or already over', () => {
  const onDay = { from: 'bilt', to: 'hilton', bonus: 200, start: '2026-10-01', end: '2026-10-01', published: '2026-10-01T13:00:00Z', title: 't', url: 'u', source: 's' };
  const a = merge({ existing: {}, candidates: [onDay], manual: {}, day: '2026-10-01' });
  assert.deepEqual([a.newlyFound.length, a.goingLive.length], [1, 0], 'announced the day it starts');
  assert.equal(merge({ existing: a, candidates: [onDay], manual: {}, day: '2026-10-01' }).goingLive.length, 0);

  const late = { ...onDay, published: '2026-09-30T13:00:00Z' };
  const b = merge({ existing: {}, candidates: [late], manual: {}, day: '2026-10-01' });
  assert.deepEqual([b.newlyFound.length, b.goingLive.length], [1, 0], 'preview first seen once already live');

  const c1 = merge({ existing: {}, candidates: [late], manual: {}, day: '2026-09-30' });
  const c2 = merge({ existing: c1, candidates: [], manual: {}, day: '2026-10-02' });
  assert.equal(c2.goingLive.length, 0, 'runs missed until after it ended');
});

test('easternToday switches at midnight New York time', () => {
  assert.equal(easternToday(new Date('2026-10-01T02:17:00Z')), '2026-09-30');
  assert.equal(easternToday(new Date('2026-10-01T04:17:00Z')), '2026-10-01');
});

test('an upcoming Rent Day stays live-listed, is reported once, and ignores last month at the same %', () => {
  const preview = { from: 'bilt', to: 'hyatt', bonus: 100, start: '2026-10-01', end: '2026-10-01', published: '2026-09-30T22:00:00Z', title: 'preview', url: 'https://frequentmiler.com/oct', source: 'Frequent Miler' };
  const lastMonth = { ...preview, start: '2026-09-01', end: '2026-09-01', published: '2026-09-01T12:00:00Z', title: 'sep', url: 'https://awardwallet.com/blog/sep', source: 'AwardWallet' };
  const r1 = merge({ existing: {}, candidates: [preview, lastMonth], manual: {}, day: '2026-09-30' });
  assert.deepEqual(r1.promotions.map((p) => [p.start, p.end]), [['2026-10-01', '2026-10-01']], 'not filed as history, end not overwritten by September');
  assert.equal(r1.newlyFound.length, 1);
  assert.ok(!isActive(r1.promotions[0], '2026-09-30') && isActive(r1.promotions[0], '2026-10-01'));
  const r2 = merge({ existing: { promotions: r1.promotions, history: r1.history }, candidates: [preview, lastMonth], manual: {}, day: '2026-09-30' });
  assert.equal(r2.newlyFound.length, 0, 'not reported again on the next run');
});

test('devaluations and ratio changes are never bonuses', () => {
  // The real TPG post that triggered a false "+33%" alert on Oct 1, 2026.
  const tpg = { ...item('Another Hyatt transfer change is coming — this time from Bilt',
    "Bilt members will soon need 33% more points to get the same number of World of Hyatt points. Here's what's changing on Jan. 1.",
    '2026-10-01T13:00:17Z'), link: 'https://thepointsguy.com/news/bilt-hyatt-transfer-devaluation/' };
  assert.deepEqual(extractPromotions(tpg, valid), []);
  assert.deepEqual(extractPromotions({ ...tpg, link: 'https://example.com/x', title: 'Bilt news: Hyatt transfers' }, valid), [], '"need 33% more" alone is not a bonus');
  for (const t of ['Bilt devalues World of Hyatt transfers', 'Citi cuts Choice Privileges transfer ratio', 'Chase Hyatt transfers go from 1:1 to 4:3 for Sapphire Preferred', 'Amex Hilton transfer ratio change: worse for members']) {
    assert.deepEqual(extractPromotions(item(t, 'Transfers now need 25% more points.'), valid), [], t);
  }
  assert.equal(extractBonus('You will need 33% more points'), null);
  assert.equal(extractBonus('It now costs 25% more points'), null);
});

test('real bonus phrasing still counts next to the devaluation guard', () => {
  assert.equal(extractBonus('Get 100% more points when you transfer'), 100);
  const [p] = extractPromotions(item('Bilt Rent Day: Get 100% more points when you transfer to Turkish', 'No longer need to wait for a bonus: transfer today.', '2026-10-01T13:00:00Z'), valid);
  assert.deepEqual([p.from, p.to, p.bonus], ['bilt', 'turkish', 100], '"no longer" in the summary does not block a real bonus');
  const [q] = extractPromotions(item('Amex 30% transfer bonus to Hilton', 'This reduces the points you need for a free night.'), valid);
  assert.equal(q.bonus, 30, '"reduces" in the summary does not block a real bonus');
});

test('U.S. Bank headlines and Ethiopian are recognized', () => {
  const [a] = extractPromotions(item('U.S. Bank: 25% transfer bonus to Air France-KLM Flying Blue through October 31'), valid);
  assert.deepEqual([a.from, a.to, a.bonus, a.end], ['usbank', 'flyingblue', 25, '2026-10-31']);
  const [b] = extractPromotions(item('US Bank Altitude Reserve 30% bonus transferring to Ethiopian ShebaMiles'), valid);
  assert.deepEqual([b.from, b.to, b.bonus], ['usbank', 'ethiopian', 30]);
  const [c] = extractPromotions(item('FlexPerks points: 20% transfer bonus to Qantas'), valid);
  assert.deepEqual([c.from, c.to], ['usbank', 'qantas']);
  // "us bank" inside other words is not U.S. Bank.
  assert.deepEqual(extractPromotions(item('Bonus bank: 25% transfer bonus to Qantas, plus bank holiday deals'), valid), []);
  // U.S. Bank doesn't transfer to United, so this route is dropped.
  assert.deepEqual(extractPromotions(item('U.S. Bank 25% transfer bonus to United MileagePlus'), valid), []);
});

test('Rove headlines and Rove-only partners are recognized', () => {
  const [p] = extractPromotions(item('Rove Adds Copa Airlines ConnectMiles as 1:1 Transfer Partner, Plus 40% Transfer Bonus', 'Transfers completed by September 30, 2026 get the bonus.'), valid);
  assert.deepEqual([p.from, p.to, p.bonus, p.end], ['rove', 'copa', 40, '2026-09-30']);
  const [q] = extractPromotions(item('Rove: 20% transfer bonus to SAS EuroBonus through April 8'), valid);
  assert.equal(q.to, 'sas');
});

test('Land Rover and similar words are not read as Rove', () => {
  assert.equal(extractPromotions(item('Win a Land Rover: 30% transfer bonus to Flying Blue from Roverpoints'), valid).length, 0);
});

test('expired notices are flagged', () => {
  const [p] = extractPromotions(item('[Expired] Capital One 30% Transfer Bonus To JAL'), valid);
  assert.equal(p.expired, true);
});

test('unrelated percentages are ignored', () => {
  assert.equal(extractBonus('Save 20% on hotel stays'), null);
  assert.equal(extractPromotions(item('Hilton 50% off sale'), valid).length, 0);
});

test('end dates roll into next year when needed', () => {
  assert.equal(extractEndDate('valid through January 15', '2026-12-20T00:00:00Z'), '2027-01-15');
  assert.equal(extractEndDate('no date here', '2026-12-20T00:00:00Z'), null);
});

test('RSS parsing handles CDATA and entities', () => {
  const xml = `<rss><channel><item><title><![CDATA[Citi 25% Transfer Bonus to Turkish Miles&amp;Smiles]]></title>
    <link>https://example.com/a</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate>
    <description>Ends October 5.</description></item></channel></rss>`;
  const [it] = parseFeed(xml);
  assert.equal(it.title, 'Citi 25% Transfer Bonus to Turkish Miles&Smiles');
  const [p] = extractPromotions(it, valid);
  assert.equal(p.to, 'turkish');
  assert.equal(p.end, '2026-10-05');
});

test('merge keeps one live promo per route and archives ended ones', () => {
  const existing = { promotions: [{ id: 'amex-virgin-30', from: 'amex', to: 'virgin', bonus: 30, end: '2026-08-31', firstSeen: '2026-08-01' }], history: [] };
  const candidates = [{ from: 'amex', to: 'virgin', bonus: 40, end: '2026-10-31', published: '2026-09-10T00:00:00Z', title: 't', url: 'u', source: 's' }];
  const r = merge({ existing, candidates, manual: {}, day: '2026-09-22' });
  assert.equal(r.promotions.length, 1);
  assert.equal(r.promotions[0].bonus, 40);
  assert.equal(r.history[0].bonus, 30);
  assert.equal(r.newlyFound.length, 1);
});

test('bonuses without an end date expire on an assumed date', () => {
  const candidates = [{ from: 'bilt', to: 'hyatt', bonus: 50, end: null, published: '2026-08-01T00:00:00Z', title: 't', url: 'u', source: 's' }];
  const r = merge({ existing: {}, candidates, manual: {}, day: '2026-09-22' });
  assert.equal(r.promotions.length, 0, 'assumed end of Aug 31 has passed');
});

test('manual suppress hides false positives', () => {
  const candidates = [{ from: 'wf', to: 'choice', bonus: 25, end: '2026-12-31', published: '2026-09-10T00:00:00Z', title: 't', url: 'u', source: 's' }];
  const r = merge({ existing: {}, candidates, manual: { suppress: ['wf-choice-25'] }, day: '2026-09-22' });
  assert.equal(r.promotions.length, 0);
});

test('isActive respects inclusive end dates', () => {
  assert.equal(isActive({ end: '2026-09-30' }, '2026-09-30'), true);
  assert.equal(isActive({ end: '2026-09-30' }, '2026-10-01'), false);
});

test('dataset: every transfer references known programs and has a sane ratio', () => {
  const cur = new Set(programs.currencies.map((c) => c.id));
  const par = new Set(programs.partners.map((p) => p.id));
  const seen = new Set();
  for (const t of transfers) {
    assert.ok(cur.has(t.from), `unknown currency ${t.from}`);
    assert.ok(par.has(t.to), `unknown partner ${t.to}`);
    assert.ok(t.ratio[0] > 0 && t.ratio[1] > 0, `bad ratio ${t.from}>${t.to}`);
    assert.ok(!seen.has(`${t.from}>${t.to}`), `duplicate ${t.from}>${t.to}`);
    seen.add(`${t.from}>${t.to}`);
  }
});

test('dataset: every partner is reachable and belongs to a known group', () => {
  const groups = new Set(programs.groups.map((g) => g.id));
  for (const p of programs.partners) {
    assert.ok(groups.has(p.group), `bad group for ${p.id}`);
    assert.ok(transfers.some((t) => t.to === p.id), `${p.id} has no transfer route`);
  }
});
