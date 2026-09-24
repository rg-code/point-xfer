import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, extractPromotions, extractBonus, extractEndDate } from '../scripts/lib/parse.mjs';
import { merge, isActive } from '../scripts/track-promos.mjs';

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
  const [p] = extractPromotions(item('Bilt Rent Day: up to 100% transfer bonus to World of Hyatt', 'Today only.', '2026-09-01T12:00:00Z'), valid);
  assert.equal(p.end, '2026-09-01');
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
