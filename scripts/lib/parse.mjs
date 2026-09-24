// Turns RSS/Atom feed text into structured transfer-bonus candidates.
// No dependencies, so the GitHub Action runs with a bare `node` install.

import { isOfficial } from './sources.mjs';

export const CURRENCY_ALIASES = {
  amex: [/\bamex\b/i, /american express/i, /membership rewards/i],
  chase: [/\bchase\b/i, /ultimate rewards/i],
  citi: [/\bciti\b/i, /thank ?you (points|rewards)/i],
  c1: [/capital one/i, /\bcap ?one\b/i, /venture x/i],
  bilt: [/\bbilt\b/i],
  wf: [/wells fargo/i, /\bautograph\b/i],
  rove: [/\brove\b/i],
};

// Order matters only for readability; every alias is tested.
export const PARTNER_ALIASES = {
  aeroplan: [/aeroplan/i, /air canada/i],
  ana: [/\bANA\b/, /all nippon/i],
  lifemiles: [/lifemiles/i, /avianca/i],
  eva: [/\bEVA\b/, /infinity mileagelands/i],
  singapore: [/singapore/i, /krisflyer/i],
  tap: [/\bTAP\b/, /miles ?& ?go/i, /tap air portugal/i],
  thai: [/\bthai\b/i, /royal orchid/i],
  turkish: [/turkish/i, /miles ?& ?smiles/i],
  united: [/mileageplus/i, /united airlines/i, /\bunited\b(?! (states|kingdom|arab))/i],
  aerlingus: [/aer ?lingus/i, /aerclub/i],
  american: [/aadvantage/i, /american airlines/i],
  atmos: [/\batmos\b/i, /alaska (airlines|mileage)/i, /hawaiian/i],
  ba: [/british airways/i, /\bBA\b/],
  cathay: [/cathay/i, /asia miles/i],
  finnair: [/finnair/i],
  iberia: [/iberia/i],
  jal: [/\bJAL\b/, /japan airlines/i],
  qantas: [/qantas/i],
  qatar: [/qatar/i, /privilege club/i],
  aeromexico: [/aerom[eé]xico/i],
  flyingblue: [/flying blue/i, /air france/i, /\bKLM\b/],
  delta: [/\bdelta\b/i, /skymiles/i],
  virgin: [/virgin atlantic/i, /flying club/i, /\bvirgin\b(?! (red|australia|voyages))/i],
  virginred: [/virgin red/i],
  emirates: [/emirates/i, /skywards/i],
  etihad: [/etihad/i],
  jetblue: [/jetblue/i, /trueblue/i],
  southwest: [/southwest/i, /rapid rewards/i],
  accor: [/\baccor\b/i, /live limitless/i],
  choice: [/choice privileges/i, /\bchoice\b/i],
  hilton: [/hilton/i],
  iprefer: [/i prefer/i, /preferred hotels/i],
  ihg: [/\bIHG\b/i],
  leaders: [/leaders club/i, /leading hotels/i, /\bLHW\b/],
  marriott: [/marriott/i, /bonvoy/i],
  hyatt: [/hyatt/i],
  wyndham: [/wyndham/i],
  airindia: [/air india/i, /maharaja club/i],
  copa: [/\bcopa\b/i, /connectmiles/i],
  milesmore: [/miles ?& ?more/i, /lufthansa/i],
  sas: [/\bSAS\b/, /eurobonus/i],
  vietnam: [/vietnam airlines/i, /lotusmiles/i],
  frontier: [/frontier/i],
  hainan: [/hainan/i, /fortune wings/i],
};

// A bare "Avios" headline with no named program most often means the core trio.
const AVIOS_FALLBACK = ['ba', 'iberia', 'aerlingus'];

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#8217': '’', '#8216': '‘', '#8211': '–', '#8212': '—', '#038': '&', '#8220': '“', '#8221': '”' };

export function decodeEntities(s = '') {
  return s
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return m;
    });
}

export function stripTags(s = '') {
  return decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

/** Parse RSS 2.0 or Atom XML into { title, link, published, summary, links } items. */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = stripTags(tag(b, 'link'));
    if (!link) {
      const href = b.match(/<link\b[^>]*href="([^"]+)"/i);
      link = href ? href[1] : '';
    }
    const published = stripTags(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'));
    items.push({
      title: stripTags(tag(b, 'title')),
      link,
      published: published ? new Date(published).toISOString() : null,
      summary: stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 1200),
      // Links inside the post body, used to find the issuer's own offer page.
      links: [...new Set([...decodeEntities(b).matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]))].slice(0, 80),
    });
  }
  return items;
}

function matchAliases(text, table) {
  const found = [];
  for (const [id, patterns] of Object.entries(table)) {
    let best = -1;
    for (const re of patterns) {
      const m = text.match(re);
      if (m && (best === -1 || m.index < best)) best = m.index;
    }
    if (best !== -1) found.push({ id, index: best });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Largest "NN% bonus" figure in the text, or null. */
export function extractBonus(text) {
  const re = /(?:up to\s+)?(\d{1,3})\s?%\s*(?:transfer\s+|point\s+|points\s+)?(?:bonus|more)/gi;
  let max = null;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n >= 5 && n <= 200) max = Math.max(max ?? 0, n);
  }
  return max;
}

const toISO = (d) => d.toISOString().slice(0, 10);

/** Find an end date like "through Sept. 30", "until October 15, 2026" or "ends 9/30". */
export function extractEndDate(text, referenceISO) {
  const ref = referenceISO ? new Date(referenceISO) : new Date();
  const lead = '(?:through|thru|until|til|till|ends?|ending|expires?|expiring|by|before)\\s+(?:on\\s+)?(?:[a-z]+day,?\\s+)?';
  const named = new RegExp(`${lead}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i');
  const numeric = new RegExp(`${lead}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?`, 'i');

  let month, day, year;
  let m = text.match(named);
  if (m) {
    month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    day = Number(m[2]);
    year = m[3] ? Number(m[3]) : null;
  } else if ((m = text.match(numeric))) {
    month = Number(m[1]) - 1;
    day = Number(m[2]);
    year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null;
  } else {
    return null;
  }
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  if (year == null) {
    year = ref.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, month, day));
    // A date well before the article was published means the bonus runs into next year.
    if (candidate < new Date(ref.getTime() - 7 * 864e5)) year += 1;
  }
  return toISO(new Date(Date.UTC(year, month, day)));
}

export function isExpiredNotice(title) {
  return /\[(expired|dead)\]|\bexpired\b|\bends today\b|\blast day\b/i.test(title);
}

/**
 * Turn one feed item into zero or more bonus candidates.
 * `validPairs` is a Set of "from>to" strings so we never invent a route that doesn't exist.
 */
export function extractPromotions(item, validPairs) {
  const title = item.title || '';
  const body = `${title}. ${item.summary || ''}`;
  if (!/transfer|convert/i.test(body)) return [];

  const bonus = extractBonus(title) ?? extractBonus((item.summary || '').slice(0, 300));
  if (!bonus) return [];

  // Sources: currencies named anywhere in the headline.
  const sources = matchAliases(title, CURRENCY_ALIASES).map((f) => f.id);
  if (!sources.length) return [];

  // Targets: prefer the part of the headline after " to " / " into " / "→".
  const split = title.search(/\s(?:to|into)\s|→|->/i);
  const targetText = split > -1 ? title.slice(split) : title;
  let targets = matchAliases(targetText, PARTNER_ALIASES).map((f) => f.id);
  if (targets.includes('virginred')) targets = targets.filter((t) => t !== 'virgin' || /virgin atlantic|flying club/i.test(targetText));
  if (!targets.length && /avios/i.test(targetText)) targets = AVIOS_FALLBACK;

  let end = extractEndDate(body, item.published);
  // Bilt Rent Day and flash offers run for a single day.
  if (!end && item.published && /today only|one day only|for 24 hours|\brent day\b/i.test(body)) end = item.published.slice(0, 10);
  const expired = isExpiredNotice(title);
  const out = [];
  for (const from of sources) {
    for (const to of targets) {
      if (!validPairs.has(`${from}>${to}`)) continue;
      const official = (item.links || []).filter((u) => isOfficial(u, [from, to]));
      out.push({ from, to, bonus, end, expired, title, url: item.link, published: item.published, official });
    }
  }
  return out;
}

export const promoId = (p) => `${p.from}-${p.to}-${p.bonus}`;
