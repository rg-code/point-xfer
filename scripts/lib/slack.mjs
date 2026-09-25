// Slack message for newly found bonuses, posted as Rohit with a user token (see track-promos.yml).
// It opens with a one-liner addressed to someone picked at random from PEOPLE.

export const PEOPLE = ['Annie', 'Chantal', 'DanC', 'DanW', 'Dave', 'Elaine', 'Haider', 'Kevin', 'Kushal', 'Melissa',
  'Lee', 'Michael', 'Paul', 'Rohit', 'Sandeep', 'Stu', 'PC', 'Zubin', 'Robin'];

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
  '{name}, your out-of-office reply is ready. Just add this bonus.',
  'Stop window shopping for flights, {name}. A new bonus is live.',
];

// Openers only for one person.
export const PERSONAL = {
  Robin: ['Time to book that western Europe trip, Robin. New bonus just dropped.'],
  Chantal: ["Japan called, Chantal hasn't been there in two weeks. This new bonus might help."],
  Paul: ["Maui isn't the same without you, Paul. Use this bonus to get back."],
};

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/** Everyone equally likely, then any line that suits them. */
export function opener(rand = Math.random) {
  const name = pick(PEOPLE, rand);
  return pick([...LINES.map((l) => l.replaceAll('{name}', name)), ...(PERSONAL[name] || [])], rand);
}

// Slack mrkdwn needs &, < and > escaped outside link syntax.
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const when = (p) => (p.start && p.start === p.end ? `on ${p.start}` : p.end ? `through ${p.end}` : '(no end date yet)');

/** chat.postMessage body (minus `channel`) for the bonuses in `found`. */
export function slackMessage(found, names, { site = 'https://milesmaximizer.com', rand = Math.random } = {}) {
  const lines = found.map((p) => {
    const src = p.sources?.[0];
    return `• *${esc(names[p.from] || p.from)} → ${esc(names[p.to] || p.to)}: +${p.bonus}%* ${when(p)}`
      + `${src ? ` (<${src.url}|${esc(src.feed)}>)` : ''} <${site}/?partner=${p.to}|map>`;
  });
  return { text: `${opener(rand)}\n${lines.join('\n')}`, unfurl_links: false, unfurl_media: false };
}
