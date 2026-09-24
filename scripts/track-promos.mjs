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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = (f) => path.join(ROOT, 'data', f);
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline');
const DRY = args.has('--dry-run');

const LOOKBACK_DAYS = 45;       // ignore feed items older than this
const UNKNOWN_END_DAYS = 30;    // keep a bonus with no stated end date this long after first seen
const HISTORY_LIMIT = 400;

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

export function merge({ existing, candidates, manual, day = today() }) {
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
    if (cur && cur.bonus === c.bonus) {
      if (c.end && !cur.end) { cur.end = c.end; delete cur.assumedEnd; }
      if (!cur.sources?.some((s) => s.url === c.url)) (cur.sources ||= []).push({ title: c.title, url: c.url, feed: c.source });
      continue;
    }
    if (cur && cur.firstSeen > seen) continue; // an older article about a previous bonus

    if (cur) history.push({ ...cur, end: cur.end || seen });
    const promo = {
      id: promoId(c),
      from: c.from,
      to: c.to,
      bonus: c.bonus,
      start: null,
      end: c.end,
      ...(c.end ? {} : { assumedEnd: addDays(seen, UNKNOWN_END_DAYS) }),
      firstSeen: seen,
      sources: [{ title: c.title, url: c.url, feed: c.source }],
    };
    byPair.set(key, promo);
    newlyFound.push(promo);
  }

  // Manual entries always win; suppressions remove false positives.
  for (const m of manual.add || []) {
    if (!isActive(m, day)) { history.push({ id: m.id || promoId(m), ...m, manual: true }); continue; }
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

  const promotions = [];
  for (const p of byPair.values()) {
    if (suppressed.has(p.id)) continue;
    if (isActive(p, day)) promotions.push(p);
    else history.push(p);
  }

  // De-duplicate history by id, keep most recent.
  const hist = [...new Map(history.map((h) => [h.id + (h.end || ''), h])).values()]
    .sort((a, b) => (b.end || '').localeCompare(a.end || ''))
    .slice(0, HISTORY_LIMIT);

  promotions.sort((a, b) => (a.end || a.assumedEnd || '9999').localeCompare(b.end || b.assumedEnd || '9999'));
  return { promotions, history: hist, newlyFound: newlyFound.filter((n) => promotions.some((p) => p.id === n.id)) };
}

async function main() {
  const [transfers, programs, existing, manual, sources] = await Promise.all([
    readJSON(DATA('transfers.json'), { transfers: [] }),
    readJSON(DATA('programs.json'), { currencies: [], partners: [] }),
    readJSON(DATA('promotions.json'), { promotions: [], history: [] }),
    readJSON(DATA('promotions.manual.json'), { add: [], suppress: [] }),
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

  const { promotions, history, newlyFound } = merge({ existing, candidates, manual });

  const next = { updatedAt: existing.updatedAt, promotions, history };
  const changed = JSON.stringify({ p: existing.promotions, h: existing.history }) !== JSON.stringify({ p: promotions, h: history });
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
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
