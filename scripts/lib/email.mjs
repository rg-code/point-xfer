// Email alerts for subscribers, sent once a day by scripts/send-alert.mjs through Inkling's Worker
// (rg-code/RInkU, route /lists/xfer/*), which keeps the list and sends with Inkling's Resend account.
// One digest per day: bonuses first seen since the last one, and announced bonuses that went live.
// Like the Slack posts, links go only to milesmaximizer.com. The Worker fills each subscriber's stop
// link into {{STOP_URL}} (it refuses an email without it) and adds the one-click unsubscribe headers.

import { isActive, easternToday } from '../track-promos.mjs';

export const STOP = '{{STOP_URL}}';
export const SITE = 'https://milesmaximizer.com';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmt = (iso) => day.format(new Date(`${iso}T00:00:00Z`));

function when(p, live) {
  if (p.start && p.start === p.end) return live ? 'today only' : `on ${fmt(p.start)} only`;
  const from = !live && p.start ? `from ${fmt(p.start)} ` : '';
  return p.end ? `${from}through ${fmt(p.end)}` : `${from}(end date not listed yet)`;
}

const INK = '#172a42';
const MUTED = '#5b6b80';
const wrap = (inner) => `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;color:${INK};line-height:1.5">${inner}</div>`;
const footerHTML = (postal) => `<p style="color:${MUTED};font-size:13px;border-top:1px solid #d6dee7;padding-top:12px;margin-top:20px">
You're getting this because you asked for alerts at <a href="${SITE}" style="color:${MUTED}">milesmaximizer.com</a>.
<a href="${STOP}" style="color:${MUTED}">Unsubscribe</a>.${postal ? `<br>${esc(postal)}` : ''}</p>`;
const footerText = (postal) => `\n--\nYou're getting this because you asked for alerts at ${SITE}.\nUnsubscribe: ${STOP}${postal ? `\n${postal}` : ''}`;

/**
 * What today's digest holds. `sent` maps promo id → 'upcoming' or 'live', as it was when it last went
 * out. New: current bonuses never sent. Live: bonuses sent while upcoming that have now started.
 * Returns the next `sent` too (bonuses no longer listed are dropped from it).
 */
export function digest(promotions, sent = {}, today) {
  const current = promotions.filter((p) => isActive(p, today) || (p.start && p.start > today));
  const found = current.filter((p) => !sent[p.id]);
  const live = current.filter((p) => sent[p.id] === 'upcoming' && isActive(p, today));
  const next = Object.fromEntries(current.map((p) => [p.id, isActive(p, today) ? 'live' : 'upcoming']));
  return { found, live, sent: next };
}

/** The digest goes out on the first tracker run from 9am US Eastern, once a day. */
export const DIGEST_HOUR = 9;
const easternHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });

/** Today's US Eastern date if a digest is due now (none sent today, and it's past DIGEST_HOUR), else null. */
export function digestDue(state, now = new Date()) {
  const today = easternToday(now);
  return state?.day !== today && Number(easternHour.format(now)) >= DIGEST_HOUR ? today : null;
}

/** Subject, HTML and text for the day's new bonuses and announced ones going live, or null. */
export function alertEmail({ found = [], live = [] }, names, { postal = '' } = {}) {
  const name = (p) => `${names[p.from] || p.from} → ${names[p.to] || p.to}`;
  const all = [...found, ...live];
  if (!all.length) return null;
  const first = all[0];
  const subject = all.length === 1
    ? `${live.length ? 'Live today' : 'New transfer bonus'}: ${name(first)} +${first.bonus}%`
    : `${all.length} transfer bonuses: ${name(first)} +${first.bonus}% and more`;
  const link = (p) => `${SITE}/?partner=${encodeURIComponent(p.to)}`;
  const section = (title, list, isLive) => (list.length ? `<h2 style="font-size:16px;margin:18px 0 6px">${title}</h2><ul style="padding-left:18px;margin:0">${list.map((p) => `
<li style="margin:6px 0"><strong>${esc(name(p))}: +${p.bonus}%</strong> ${esc(when(p, isLive))}. <a href="${link(p)}" style="color:${INK}">See it on the map</a></li>`).join('')}</ul>` : '');
  const sectionText = (title, list, isLive) => (list.length ? `\n${title}\n${list.map((p) => `- ${name(p)}: +${p.bonus}% ${when(p, isLive)}. ${link(p)}`).join('\n')}\n` : '');
  const intro = 'Transfer bonuses spotted on milesmaximizer.com. Bonuses can end early, so check the issuer before you move points; transfers can\'t be undone.';
  return {
    subject,
    html: wrap(`<p>${intro}</p>${section('New bonuses', found, false)}${section('Live today', live, true)}${footerHTML(postal)}`),
    text: `${intro}\n${sectionText('New bonuses', found, false)}${sectionText('Live today', live, true)}${footerText(postal)}`,
  };
}

/** A hand-written update (a partner added, a ratio change), from the manual workflow. */
export function updateEmail(subject, message, { postal = '' } = {}) {
  const paras = String(message).trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ')).filter(Boolean);
  if (!String(subject).trim() || !paras.length) return null;
  return {
    subject: String(subject).trim(),
    html: wrap(`${paras.map((p) => `<p>${esc(p)}</p>`).join('')}<p><a href="${SITE}" style="color:${INK}">Open the transfer map</a></p>${footerHTML(postal)}`),
    text: `${paras.join('\n\n')}\n\nOpen the transfer map: ${SITE}${footerText(postal)}`,
  };
}
