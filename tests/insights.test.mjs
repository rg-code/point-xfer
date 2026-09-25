import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, extractPromotions } from '../scripts/lib/parse.mjs';
import { rankSources, sourceRank, isOfficial } from '../scripts/lib/sources.mjs';
import { merge, dedupeHistory } from '../scripts/track-promos.mjs';
import '../assets/advice.js';

const { advise, chanceOfBonus } = globalThis.transferAdvice;
const programs = JSON.parse(readFileSync(new URL('../data/programs.json', import.meta.url)));
const { transfers } = JSON.parse(readFileSync(new URL('../data/transfers.json', import.meta.url)));
const valid = new Set(transfers.map((t) => `${t.from}>${t.to}`));

// ---------- Source priority ----------

test('sources rank official, then AwardWallet, then Frequent Miler and Doctor of Credit, then others', () => {
  const ranked = rankSources([
    { url: 'https://thepointsguy.com/a' },
    { url: 'https://www.doctorofcredit.com/d' },
    { url: 'https://frequentmiler.com/b' },
    { url: 'https://awardwallet.com/blog/c' },
    { url: 'https://global.americanexpress.com/offer' },
    { url: 'https://frequentmiler.com/b' },
  ]);
  assert.deepEqual(ranked.map((s) => sourceRank(s.url)), [0, 1, 2, 2, 3]);
  assert.equal(ranked[2].url, 'https://www.doctorofcredit.com/d', 'ties keep feed order');
  assert.equal(ranked.length, 5, 'duplicate URL dropped');
});

test('a tied source does not override the other on the end date', () => {
  const fm = { from: 'amex', to: 'ba', bonus: 30, end: '2026-09-27', published: '2026-09-02T00:00:00Z', title: 'fm', url: 'https://frequentmiler.com/x', source: 'Frequent Miler' };
  const doc = { ...fm, end: '2026-09-30', published: '2026-09-01T00:00:00Z', title: 'doc', url: 'https://www.doctorofcredit.com/x', source: 'Doctor of Credit' };
  const tpg = { ...fm, end: '2026-10-05', published: '2026-09-03T00:00:00Z', title: 'tpg', url: 'https://thepointsguy.com/x', source: 'The Points Guy' };
  const [p] = merge({ existing: {}, candidates: [tpg, fm, doc], manual: {}, day: '2026-09-10' }).promotions;
  assert.equal(p.end, '2026-09-27', 'Frequent Miler (newer of the tied pair) beats TPG and is not overridden by Doctor of Credit');
});

test('official detection matches subdomains but not lookalikes', () => {
  assert.ok(isOfficial('https://www.britishairways.com/x', ['ba']));
  assert.ok(!isOfficial('https://notchase.com/x', ['chase']));
  assert.ok(!isOfficial('https://www.hyatt.com/x', ['chase', 'marriott']), 'only the promo’s own programs');
});

test('feed items carry official offer links for the promo’s programs only', () => {
  const xml = `<rss><channel><item><title>Amex 30% Transfer Bonus to British Airways</title>
    <link>https://awardwallet.com/blog/amex-ba</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate>
    <content:encoded><![CDATA[<p>Details on <a href="https://global.americanexpress.com/rewards/transfer">Amex</a>,
    <a href="https://www.hyatt.com/promo">unrelated</a>. Ends 9/27.</p>]]></content:encoded></item></channel></rss>`;
  const [it] = parseFeed(xml);
  const [p] = extractPromotions(it, valid);
  assert.deepEqual(p.official, ['https://global.americanexpress.com/rewards/transfer']);
});

test('merge puts the official page first and lets a better source settle the end date', () => {
  const blog = { from: 'amex', to: 'ba', bonus: 30, end: '2026-09-30', published: '2026-09-02T00:00:00Z', title: 'tpg', url: 'https://thepointsguy.com/x', source: 'The Points Guy' };
  const aw = { ...blog, end: '2026-09-27', published: '2026-09-01T00:00:00Z', title: 'aw', url: 'https://awardwallet.com/blog/x', source: 'AwardWallet', official: ['https://global.americanexpress.com/offer'] };
  const r = merge({ existing: {}, candidates: [blog, aw], manual: {}, day: '2026-09-10' });
  const [p] = r.promotions;
  assert.equal(p.end, '2026-09-27', 'AwardWallet outranks TPG on the end date');
  assert.deepEqual(p.sources.map((s) => sourceRank(s.url)), [0, 1, 3]);
});

// ---------- Archive and history ----------

test('archive records land in history; running ones are left to the live list', () => {
  const archive = { since: '2023-01-01', records: [
    { from: 'amex', to: 'virgin', bonus: 30, start: '2025-03-01', end: '2025-03-31', sources: [] },
    { from: 'amex', to: 'ba', bonus: 30, start: '2026-09-01', end: '2026-09-27', sources: [] },
  ] };
  const r = merge({ existing: {}, candidates: [], manual: {}, archive, day: '2026-09-10' });
  assert.deepEqual(r.history.map((h) => h.id), ['amex-virgin-30']);
  assert.equal(r.history[0].archived, true);
});

test('curated history wins over an overlapping tracker record for the same route', () => {
  const tracked = { id: 'amex-virgin-30', from: 'amex', to: 'virgin', bonus: 30, firstSeen: '2025-03-03', end: '2025-04-02' };
  const curated = { id: 'amex-virgin-30', from: 'amex', to: 'virgin', bonus: 30, start: '2025-03-01', end: '2025-03-31', archived: true };
  const other = { id: 'chase-virgin-30', from: 'chase', to: 'virgin', bonus: 30, start: '2025-03-01', end: '2025-03-31', archived: true };
  const kept = dedupeHistory([tracked, curated, other]);
  assert.equal(kept.length, 2);
  assert.ok(kept.includes(curated) && kept.includes(other));
});

// ---------- Go / wait advice ----------

// A route with a 30% bonus every ~4 months, each lasting a month, from 2023.
const regular = [];
for (let m = 0; m < 44; m += 4) {
  const y = 2023 + Math.floor(m / 12);
  const mo = String((m % 12) + 1).padStart(2, '0');
  regular.push({ bonus: 30, start: `${y}-${mo}-01`, end: `${y}-${mo}-28` });
}
const since = '2023-01-01';

test('no live bonus on a route with frequent bonuses: wait', () => {
  // Last bonus ended 2026-05-28; the next one is due around September.
  const a = advise({ history: regular, live: null, since, day: '2026-08-15' });
  assert.equal(a.verdict, 'wait');
  assert.ok(a.stats.chance > 0.5);
  assert.match(a.record, /11 past bonuses since 2023, typically \+30%, about every 4 months/);
});

test('history text names the month when the window starts at a route launch', () => {
  const a = advise({ history: [], live: { bonus: 30 }, since: '2026-09-20', day: '2026-09-24' });
  assert.match(a.reason, /launch bonus/);
  assert.equal(a.record, 'No past bonuses since Sep 2026.');
  const b = advise({ history: [], live: { bonus: 30 }, since: '2025-04-28', day: '2026-09-24' });
  assert.match(b.reason, /first bonus on record for this route since Apr 2025/);
});

test('a bonus that just ended makes another one soon less likely', () => {
  const ps = regular.map((h) => ({ start: Date.parse(h.start) / 864e5, end: Date.parse(h.end) / 864e5 }));
  const day = (iso) => Date.parse(iso) / 864e5;
  const justEnded = chanceOfBonus(ps, day(since), day('2026-06-01'), 30);
  const overdue = chanceOfBonus(ps, day(since), day('2026-08-15'), 30);
  assert.ok(justEnded < overdue, `${justEnded} should be below ${overdue}`);
});

test('live bonus at the usual size: go', () => {
  const a = advise({ history: regular, live: { bonus: 30 }, since, day: '2026-09-10' });
  assert.equal(a.verdict, 'go');
  assert.match(a.reason, /matches the best on record/);
});

test('small live bonus on a route that often does better: wait', () => {
  const history = regular.map((h) => ({ ...h, bonus: 40 }));
  const a = advise({ history, live: { bonus: 10 }, since, day: '2026-08-15' });
  assert.equal(a.verdict, 'wait');
});

test('routes that rarely or never have bonuses: go', () => {
  assert.equal(advise({ history: [], live: null, since, day: '2026-09-10' }).verdict, 'go');
  const rare = [{ bonus: 25, start: '2023-06-01', end: '2023-06-30' }];
  const a = advise({ history: rare, live: null, since, day: '2026-09-10' });
  assert.equal(a.verdict, 'go');
  assert.ok(a.stats.chance < 0.2);
});

test('a long shot at a huge bonus is not a reason to wait', () => {
  // Two one-day 100%+ bonuses in almost four years: big expected value, small chance.
  const rare = [{ bonus: 100, start: '2024-05-01', end: '2024-05-01' }, { bonus: 125, start: '2025-09-01', end: '2025-09-01' }];
  const a = advise({ history: rare, live: null, since, day: '2026-09-24' });
  assert.ok(a.stats.waitValue >= 10 && a.stats.chance < 0.4);
  assert.equal(a.verdict, 'go');
});

test('a few gaps never produce a 0% or 100% chance', () => {
  const d = (iso) => Date.parse(iso) / 864e5;
  const ps = [['2023-03-01', '2023-03-31'], ['2024-03-01', '2024-03-31'], ['2025-03-01', '2025-03-31'], ['2026-03-01', '2026-03-31']]
    .map(([s, e]) => ({ start: d(s), end: d(e) }));
  const p = chanceOfBonus(ps, d(since), d('2026-05-01'), 90);
  assert.ok(p > 0 && p < 1, `got ${p}`);
});

test('targeted offers are left out of the advice', () => {
  const a = advise({ history: regular.map((h) => ({ ...h, targeted: true })), live: null, since, day: '2026-08-15' });
  assert.equal(a.stats.count, 0);
  assert.equal(a.verdict, 'go');
});

test('first-ever bonus on a route: go', () => {
  const a = advise({ history: [], live: { bonus: 40 }, since, day: '2026-09-10' });
  assert.equal(a.verdict, 'go');
  assert.match(a.reason, /first bonus on record/);
});

// ---------- Dataset: transfer time and minimums ----------

test('dataset: transfer times and minimums are well formed', () => {
  const units = new Set(['minutes', 'hours', 'days']);
  for (const c of programs.currencies) {
    assert.ok(c.minTransfer >= 1, `${c.id} minTransfer`);
    assert.ok(c.increment >= 1, `${c.id} increment`);
  }
  for (const t of transfers) {
    if (t.time) {
      assert.ok(units.has(t.time.unit), `${t.from}>${t.to} time unit`);
      assert.ok(t.time.min >= 0 && t.time.max >= t.time.min, `${t.from}>${t.to} time range`);
    }
    if (t.min != null) assert.ok(t.min >= 1, `${t.from}>${t.to} min`);
    if (t.increment != null) assert.ok(t.increment >= 1, `${t.from}>${t.to} increment`);
    if (t.added != null) assert.match(t.added, /^\d{4}-\d{2}-\d{2}$/, `${t.from}>${t.to} added`);
  }
});

test('dataset: archived bonuses reference real routes and valid dates', () => {
  let archive;
  try { archive = JSON.parse(readFileSync(new URL('../data/promotions.archive.json', import.meta.url))); } catch { return; }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  assert.match(archive.since, iso);
  for (const r of archive.records) {
    const k = `${r.from}>${r.to}`;
    assert.ok(valid.has(k), `archive route ${k} not in transfers.json`);
    assert.ok(r.bonus > 0 && r.bonus <= 200, `${k} bonus`);
    assert.match(r.start, iso, `${k} start`);
    if (r.end) assert.ok(iso.test(r.end) && r.end >= r.start, `${k} end ${r.end}`);
    assert.ok(r.sources?.length, `${k} ${r.start} needs a source`);
  }
});
