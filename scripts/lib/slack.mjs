// Slack messages for new bonuses, posted as Rohit with a user token (see track-promos.yml). Each
// opens with a one-liner addressed to someone picked at random from PEOPLE. A bonus announced
// before its start date (a Rent Day preview) gets a second post when it goes live.

export const PEOPLE = ['Annie', 'Chantal', 'DanC', 'DanW', 'Dave', 'Elaine', 'Haider', 'Kevin', 'Kushal', 'Melissa',
  'Lee', 'Michael', 'Paul', 'Sandeep', 'Stu', 'PC', 'Zubin', 'Robin'];

// Openers that work for anyone; {name} is replaced.
export const LINES = [
  'Hold my beer, {name}. A new bonus was spotted.',
  'Pack a bag, {name}. A new transfer bonus just landed.',
  '{name}, your points called. They want to go somewhere.',
  'Dust off the passport, {name}. A new bonus just dropped.',
  'Window seat is open, {name}. A new bonus was spotted.',
  'Now boarding: {name}. A fresh transfer bonus just posted.',
  "Business class isn't going to book itself, {name}. New bonus just dropped.",
  'Somewhere a beach is missing {name}. This new bonus might help.',
  '{name}, same points, more miles. A new bonus just dropped.',
  'Seatbelts on, {name}. A new transfer bonus is taking off.',
  'Clear your calendar, {name}. A new bonus just dropped.',
  '{name}, this one has your name on it. New transfer bonus below.',
  'Put the kettle on, {name}. There is a new bonus to look at.',
  'Stop window shopping for flights, {name}. A new bonus is live.',
];

// Openers only for one person.
export const PERSONAL = {
  Robin: ['Time to book that western Europe trip, Robin. New bonus just dropped.'],
  Chantal: ["Japan called, Chantal hasn't been there in two weeks. This new bonus might help."],
  Paul: ["Maui isn't the same without you, Paul. Use this bonus to get back."],
};

// Openers for the second post, when an announced bonus goes live.
export const LIVE_LINES = [
  "Today's the day, {name}. That bonus is live.",
  "{name}, remember that bonus? It's live now.",
  'Doors are open, {name}. This bonus is live.',
  'Wheels up, {name}. This bonus just went live.',
];

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/** Everyone equally likely, then any line that suits them. */
export function opener(rand = Math.random, lines = LINES, personal = PERSONAL) {
  const name = pick(PEOPLE, rand);
  return pick([...lines.map((l) => l.replaceAll('{name}', name)), ...(personal[name] || [])], rand);
}

// Slack mrkdwn needs &, < and > escaped outside link syntax.
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmt = (iso) => day.format(new Date(`${iso}T00:00:00Z`));

const when = (p, live) => {
  if (p.start && p.start === p.end) return live ? 'today only' : `on ${fmt(p.start)} only`;
  const from = !live && p.start ? `from ${fmt(p.start)} ` : '';
  return p.end ? `${from}through ${fmt(p.end)}` : `${from}(no end date yet)`;
};

/**
 * chat.postMessage body (minus `channel`) for `bonuses`. `live: true` is the second post for a
 * bonus announced ahead of its start date.
 */
export function slackMessage(bonuses, names, { site = 'https://milesmaximizer.com', rand = Math.random, live = false } = {}) {
  const lines = bonuses.map((p) => {
    const src = p.sources?.[0];
    return `• *${esc(names[p.from] || p.from)} → ${esc(names[p.to] || p.to)}: +${p.bonus}%* ${when(p, live)}`
      + `${src ? ` (<${src.url}|${esc(src.feed)}>)` : ''} <${site}/?partner=${p.to}|map>`;
  });
  const first = live ? opener(rand, LIVE_LINES, {}) : opener(rand);
  return { text: `${first}\n${lines.join('\n')}`, unfurl_links: false, unfurl_media: false };
}

/** Everything to post this run: announcements, then bonuses going live. */
export function slackMessages({ found = [], live = [] }, names, opts = {}) {
  return [
    ...(found.length ? [slackMessage(found, names, opts)] : []),
    ...(live.length ? [slackMessage(live, names, { ...opts, live: true })] : []),
  ];
}
