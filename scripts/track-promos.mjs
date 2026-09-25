#!/usr/bin/env node
// Checks points-and-miles blog feeds for new transfer bonuses and updates data/promotions.json.
//
//   node scripts/track-promos.mjs            fetch feeds, merge, write
//   node scripts/track-promos.mjs --offline  skip network; re-merge manual entries and prune
//   node scripts/track-promos.mjs --dry-run  print the result without writing
//
// When run inside GitHub Actions it also writes `new_count` to $GITHUB_OUTPUT and a
// Markdown summary of newly found bonuses to $RUNNER_TEMP/new-promos.md for the issue step.

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseFeed, extractPromotions, promoId } from './lib/parse.mjs';
import { rankSources, sourceRank } from './lib/sources.mjs';
import { slackMessage } from './lib/slack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = (f) => path.join(ROOT, 'data', f);
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline');
const DRY = args.has('--dry-run');

const LOOKBACK_DAYS = 45;       // ignore feed items older than this
const UNKNOWN_END_DAYS = 30;    // keep a bonus with no stated end date this long after first seen
const HISTORY_LIMIT = 2000;

const readJSON = async (f, fallback) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; }
};
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * 864e5).toISOString().slice(0, 10);

async function fetchFeed(source) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(source.url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'transfer-map-bot/1.0 (+https://github.com/; tracks public transfer bonus posts)',
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text());
    console.log(`✓ ${source.name}: ${items.length} items`);
    return items.map((it) => ({ ...it, source: source.name }));
  } catch (err) {
    console.warn(`✗ ${source.name}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Active on `day` if it has started and hasn't ended (end date inclusive). */
export function isActive(p, day = today()) {
  if (p.start && p.start > day) return false;
  const end = p.end || p.assumedEnd;
  return !end || end >= day;
}

// The blog post plus any issuer/partner offer pages it links to.
const sourcesOf = (c) => [
  { title: c.title, url: c.url, feed: c.source },
  ...(c.official || []).map((url) => ({ title: 'Offer page', url, feed: new URL(url).hostname.replace(/^www\./, '') })),
];

const span = (h) => {
  const s = h.start || h.firstSeen || h.end;
  return [s, h.end || h.assumedEnd || s];
};

/** One record per bonus period: curated (archive, manual) records win over overlapping tracker ones. */
export function dedupeHistory(list) {
  const pri = (h) => (h.archived || h.manual ? 0 : 1);
  const taken = new Map();
  const kept = [];
  for (const h of [...list].sort((a, b) => pri(a) - pri(b))) {
    const key = `${h.from}>${h.to}`;
    const [s, e] = span(h);
    const spans = taken.get(key) || [];
    if (spans.some(([s2, e2]) => s <= e2 && s2 <= e)) continue;
    spans.push([s, e]);
    taken.set(key, spans);
    kept.push(h);
  }
  return kept;
}

export function merge({ existing, candidates, manual, archive = {}, day = today() }) {
  const byPair = new Map(); // one live promo per from>to route
  const history = [...(existing.history || [])];
  const newlyFound = [];

  for (const p of existing.promotions || []) byPair.set(`${p.from}>${p.to}`, { ...p });

  // Newest first so the latest article wins.
  candidates.sort((a, b) => (b.published || '').localeCompare(a.published || ''));

  for (const c of candidates) {
    const key = `${c.from}>${c.to}`;
    const cur = byPair.get(key);
    const seen = (c.published || day).slice(0, 10);

    if (c.expired) {
      if (cur && cur.bonus === c.bonus && !cur.manual) cur.end = cur.end && cur.end < seen ? cur.end : seen;
      continue;
    }
    // Same bonus, unless both have start dates that differ (last month's Rent Day at the same %).
    if (cur && cur.bonus === c.bonus && (!c.start || !cur.start || c.start === cur.start)) {
      // A Rent Day post dates a bonus that was stored open-ended.
      if (c.start && !cur.start && !cur.manual) { cur.start = c.start; cur.end = c.end; cur.endSource = c.url; delete cur.assumedEnd; }
      else if (c.end && !cur.end) { cur.end = c.end; cur.endSource = c.url; delete cur.assumedEnd; }
      // A better-ranked source (official, then AwardWallet, then Frequent Miler / Doctor of Credit) settles
      // end-date disagreements. Tied sources keep the date already set, i.e. the newest post.
      else if (c.end && c.end !== cur.end && !cur.manual && sourceRank(c.url) < sourceRank(cur.endSource || cur.sources?.[0]?.url)) {
        cur.end = c.end;
        cur.endSource = c.url;
      }
      cur.sources = [...(cur.sources || []), ...sourcesOf(c)];
      continue;
    }
    if (cur && cur.firstSeen > seen) continue; // an older article about a previous bonus

    if (cur) history.push({ ...cur, end: cur.end || seen });
    const promo = {
      id: promoId(c),
      from: c.from,
      to: c.to,
      bonus: c.bonus,
      start: c.start || null,
      end: c.end,
      ...(c.end ? {} : { assumedEnd: addDays(seen, UNKNOWN_END_DAYS) }),
      firstSeen: seen,
      ...(c.end ? { endSource: c.url } : {}),
      sources: sourcesOf(c),
    };
    byPair.set(key, promo);
    newlyFound.push(promo);
  }

  // Not started yet (a Rent Day preview, say): stays in the live list, which browsers filter by
  // start date, so it isn't filed as a past bonus or reported as new again on every run.
  const current = (p) => isActive(p, day) || (p.start && p.start > day);

  // Manual entries always win; suppressions remove false positives.
  for (const m of manual.add || []) {
    if (!current(m)) { history.push({ id: m.id || promoId(m), ...m, manual: true }); continue; }
    const key = `${m.from}>${m.to}`;
    const cur = byPair.get(key);
    byPair.set(key, {
      id: m.id || promoId(m),
      start: null,
      firstSeen: cur?.firstSeen || day,
      ...m,
      manual: true,
    });
  }
  const suppressed = new Set(manual.suppress || []);

  // Hand-researched past bonuses. Anything still running is covered by the live list.
  for (const a of archive.records || []) {
    if ((a.end || a.start) >= day) continue;
    history.push({ id: promoId(a), ...a, archived: true });
  }

  const promotions = [];
  for (const p of byPair.values()) {
    if (suppressed.has(p.id)) continue;
    if (current(p)) promotions.push(p);
    else history.push(p);
  }

  const hist = dedupeHistory(history)
    .sort((a, b) => (b.end || b.start || '').localeCompare(a.end || a.start || ''))
    .slice(0, HISTORY_LIMIT);
  for (const p of [...promotions, ...hist]) if (p.sources) p.sources = rankSources(p.sources);

  promotions.sort((a, b) => (a.end || a.assumedEnd || '9999').localeCompare(b.end || b.assumedEnd || '9999'));
  return { promotions, history: hist, newlyFound: newlyFound.filter((n) => promotions.some((p) => p.id === n.id)) };
}

async function main() {
  const [transfers, programs, existing, manual, archive, sources] = await Promise.all([
    readJSON(DATA('transfers.json'), { transfers: [] }),
    readJSON(DATA('programs.json'), { currencies: [], partners: [] }),
    readJSON(DATA('promotions.json'), { promotions: [], history: [] }),
    readJSON(DATA('promotions.manual.json'), { add: [], suppress: [] }),
    readJSON(DATA('promotions.archive.json'), { records: [] }),
    readJSON(DATA('sources.json'), { feeds: [] }),
  ]);
  const validPairs = new Set(transfers.transfers.map((t) => `${t.from}>${t.to}`));

  let candidates = [];
  if (!OFFLINE) {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
    const items = (await Promise.all(sources.feeds.map(fetchFeed))).flat();
    candidates = items
      .filter((it) => !it.published || it.published >= cutoff)
      .flatMap((it) => extractPromotions(it, validPairs).map((c) => ({ ...c, source: it.source })));
    console.log(`Found ${candidates.length} bonus mentions across ${items.length} items`);
  }

  const { promotions, history, newlyFound } = merge({ existing, candidates, manual, archive });

  const next = { updatedAt: existing.updatedAt, historySince: archive.since || null, promotions, history };
  const changed = JSON.stringify({ s: existing.historySince, p: existing.promotions, h: existing.history })
    !== JSON.stringify({ s: next.historySince, p: promotions, h: history });
  if (changed) next.updatedAt = new Date().toISOString();

  const names = Object.fromEntries([...programs.currencies, ...programs.partners].map((p) => [p.id, p.name]));
  console.log(`\nActive bonuses (${promotions.length}):`);
  for (const p of promotions) console.log(`  ${names[p.from]} → ${names[p.to]}  +${p.bonus}%  ${p.end ? `ends ${p.end}` : `no end date (assumed ${p.assumedEnd})`}`);

  if (DRY) return;
  if (changed) {
    await writeFile(DATA('promotions.json'), `${JSON.stringify(next, null, 2)}\n`);
    console.log('\nWrote data/promotions.json');
  } else {
    console.log('\nNo changes.');
  }

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `new_count=${newlyFound.length}\n`);
    if (newlyFound.length && process.env.RUNNER_TEMP) {
      const lines = newlyFound.map((p) => {
        const src = p.sources?.[0];
        return `- **${names[p.from]} → ${names[p.to]}: +${p.bonus}%** ${p.end ? `through ${p.end}` : '(end date not found)'}${src ? ` — [${src.feed}](${src.url})` : ''}`;
      });
      const body = `The tracker found ${newlyFound.length} new transfer bonus${newlyFound.length > 1 ? 'es' : ''}:\n\n${lines.join('\n')}\n\nIf any of these are wrong, add the id to \`suppress\` in \`data/promotions.manual.json\`.\n\nIds: ${newlyFound.map((p) => `\`${p.id}\``).join(', ')}`;
      await writeFile(path.join(process.env.RUNNER_TEMP, 'new-promos.md'), body);
      await writeFile(path.join(process.env.RUNNER_TEMP, 'new-promos.slack.json'), JSON.stringify(slackMessage(newlyFound, names)));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
