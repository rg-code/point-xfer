// Email alerts for subscribers, sent by scripts/send-alert.mjs through Inkling's Worker (rg-code/RInkU,
// route /lists/xfer/*), which keeps the list and does the sending. Emails go out only when something
// changes: a new transfer bonus (from the tracker), or a transfer route added, removed or re-rated in
// data/transfers.json (on push to main). Like the Slack posts, links go only to milesmaximizer.com.
// The Worker fills each subscriber's stop link into {{STOP_URL}} (it refuses an email without it)
// and adds the one-click unsubscribe headers.

export const STOP = '{{STOP_URL}}';
export const SITE = 'https://milesmaximizer.com';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmt = (iso) => day.format(new Date(`${iso}T00:00:00Z`));

function when(p) {
  if (p.start && p.start === p.end) return `on ${fmt(p.start)} only`;
  const from = p.start ? `from ${fmt(p.start)} ` : '';
  return p.end ? `${from}through ${fmt(p.end)}` : `${from}(end date not listed yet)`;
}

const INK = '#172a42';
const MUTED = '#5b6b80';
const link = (to) => `${SITE}/?partner=${encodeURIComponent(to)}`;
const wrap = (inner) => `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;color:${INK};line-height:1.5">${inner}</div>`;
const footerHTML = (postal) => `<p style="color:${MUTED};font-size:13px;border-top:1px solid #d6dee7;padding-top:12px;margin-top:20px">
You're getting this because you asked for alerts at <a href="${SITE}" style="color:${MUTED}">milesmaximizer.com</a>.
<a href="${STOP}" style="color:${MUTED}">Unsubscribe</a>.${postal ? `<br>${esc(postal)}` : ''}</p>`;
const footerText = (postal) => `\n--\nYou're getting this because you asked for alerts at ${SITE}.\nUnsubscribe: ${STOP}${postal ? `\n${postal}` : ''}`;

/** One email from a list of { text, to } lines (to = partner id for the map link). */
function compose(subject, intro, lines, postal) {
  return {
    subject,
    html: wrap(`<p>${esc(intro)}</p><ul style="padding-left:18px;margin:0">${lines.map((l) => `
<li style="margin:6px 0">${l.html} <a href="${link(l.to)}" style="color:${INK}">See it on the map</a></li>`).join('')}</ul>${footerHTML(postal)}`),
    text: `${intro}\n\n${lines.map((l) => `- ${l.text} ${link(l.to)}`).join('\n')}\n${footerText(postal)}`,
  };
}

/** The email for bonuses the tracker found this run, or null. */
export function bonusEmail(found, names, { postal = '' } = {}) {
  if (!found?.length) return null;
  const name = (p) => `${names[p.from] || p.from} → ${names[p.to] || p.to}`;
  const first = found[0];
  const subject = found.length === 1
    ? `New transfer bonus: ${name(first)} +${first.bonus}%`
    : `${found.length} new transfer bonuses: ${name(first)} +${first.bonus}% and more`;
  const lines = found.map((p) => ({
    to: p.to,
    html: `<strong>${esc(name(p))}: +${p.bonus}%</strong> ${esc(when(p))}.`,
    text: `${name(p)}: +${p.bonus}% ${when(p)}.`,
  }));
  return compose(subject, 'New transfer bonus spotted on milesmaximizer.com. Bonuses can end early, so check the issuer before you move points; transfers can\'t be undone.', lines, postal);
}

const key = (t) => `${t.from}>${t.to}`;
const rate = (r) => `${(1000).toLocaleString('en-US')} → ${Math.round((1000 * r[1]) / r[0]).toLocaleString('en-US')}`;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Routes added, removed, or with a changed ratio between two versions of data/transfers.json. */
export function routeChanges(before, after) {
  const old = new Map((before?.transfers || []).map((t) => [key(t), t]));
  const now = new Map((after?.transfers || []).map((t) => [key(t), t]));
  const added = [...now.values()].filter((t) => !old.has(key(t)));
  const removed = [...old.values()].filter((t) => !now.has(key(t)));
  const changed = [...now.values()]
    .filter((t) => old.has(key(t)) && !(same(t.ratio, old.get(key(t)).ratio) && same(t.variants, old.get(key(t)).variants)))
    .map((t) => ({ ...t, was: old.get(key(t)) }));
  return { added, removed, changed };
}

/** The email for route changes, or null when none matter to subscribers (notes, times, dates). */
export function changeEmail({ added = [], removed = [], changed = [] }, names, { postal = '' } = {}) {
  const n = (id) => names[id] || id;
  const lines = [
    ...added.map((t) => ({ to: t.to, html: `<strong>${esc(n(t.from))} adds ${esc(n(t.to))}</strong> at ${rate(t.ratio)}.`, text: `${n(t.from)} adds ${n(t.to)} at ${rate(t.ratio)}.` })),
    ...removed.map((t) => ({ to: t.to, html: `<strong>${esc(n(t.from))} drops ${esc(n(t.to))}.</strong>`, text: `${n(t.from)} drops ${n(t.to)}.` })),
    ...changed.map((t) => {
      const what = same(t.ratio, t.was.ratio) ? 'changes its card-specific rates' : `goes from ${rate(t.was.ratio)} to ${rate(t.ratio)}`;
      return { to: t.to, html: `<strong>${esc(n(t.from))} → ${esc(n(t.to))}</strong> ${what}.`, text: `${n(t.from)} → ${n(t.to)} ${what}.` };
    }),
  ];
  if (!lines.length) return null;
  const subject = lines.length === 1 ? `Transfer partner change: ${lines[0].text.replace(/\.$/, '')}` : `${lines.length} transfer partner changes`;
  return compose(subject, 'The transfer map on milesmaximizer.com changed. Rates are per 1,000 points sent.', lines, postal);
}
