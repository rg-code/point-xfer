// Email alerts for subscribers (sent as a Resend broadcast by scripts/send-alert.mjs): new bonuses,
// announced bonuses going live, and hand-written map updates. Like the Slack posts, links go only to
// milesmaximizer.com. Every email carries Resend's unsubscribe link and the postal address CAN-SPAM
// requires; {{POSTAL_ADDRESS}} is filled in at send time from the MAIL_POSTAL_ADDRESS variable.

export const UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}';
export const POSTAL = '{{POSTAL_ADDRESS}}';

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
const footerHTML = (site) => `<p style="color:${MUTED};font-size:13px;border-top:1px solid #d6dee7;padding-top:12px;margin-top:20px">
You're getting this because you asked for bonus alerts at <a href="${site}" style="color:${MUTED}">milesmaximizer.com</a>.
<a href="${UNSUBSCRIBE}" style="color:${MUTED}">Unsubscribe</a>.<br>${POSTAL}</p>`;
const footerText = (site) => `\n--\nYou're getting this because you asked for bonus alerts at ${site}.\nUnsubscribe: ${UNSUBSCRIBE}\n${POSTAL}`;

/** Subject, HTML and text for the bonuses found this run and announced ones going live today. */
export function alertEmail({ found = [], live = [] }, names, { site = 'https://milesmaximizer.com' } = {}) {
  const name = (p) => `${names[p.from] || p.from} → ${names[p.to] || p.to}`;
  const all = [...found, ...live];
  if (!all.length) return null;
  const first = all[0];
  const subject = all.length === 1
    ? `${live.length ? 'Live today' : 'New transfer bonus'}: ${name(first)} +${first.bonus}%`
    : `${all.length} transfer bonuses: ${name(first)} +${first.bonus}% and more`;
  const link = (p) => `${site}/?partner=${encodeURIComponent(p.to)}`;
  const section = (title, list, isLive) => (list.length ? `<h2 style="font-size:16px;margin:18px 0 6px">${title}</h2><ul style="padding-left:18px;margin:0">${list.map((p) => `
<li style="margin:6px 0"><strong>${esc(name(p))}: +${p.bonus}%</strong> ${esc(when(p, isLive))}. <a href="${link(p)}" style="color:${INK}">See it on the map</a></li>`).join('')}</ul>` : '');
  const sectionText = (title, list, isLive) => (list.length ? `\n${title}\n${list.map((p) => `- ${name(p)}: +${p.bonus}% ${when(p, isLive)}. ${link(p)}`).join('\n')}\n` : '');
  const intro = 'Transfer bonuses spotted on milesmaximizer.com. Bonuses can end early, so check the issuer before you move points; transfers can\'t be undone.';
  return {
    subject,
    html: wrap(`<p>${intro}</p>${section('New bonuses', found, false)}${section('Live today', live, true)}${footerHTML(site)}`),
    text: `${intro}\n${sectionText('New bonuses', found, false)}${sectionText('Live today', live, true)}${footerText(site)}`,
  };
}

/** A hand-written update (a partner added, a ratio change), from the manual workflow. */
export function updateEmail(subject, message, { site = 'https://milesmaximizer.com' } = {}) {
  const paras = String(message).trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' '));
  return {
    subject,
    html: wrap(`${paras.map((p) => `<p>${esc(p)}</p>`).join('')}<p><a href="${site}" style="color:${INK}">Open the transfer map</a></p>${footerHTML(site)}`),
    text: `${paras.join('\n\n')}\n\nOpen the transfer map: ${site}${footerText(site)}`,
  };
}

/** Fill in the postal address; refuses to produce an email without one (CAN-SPAM). */
export function withPostal(mail, postal) {
  if (!postal || !postal.trim()) throw new Error('MAIL_POSTAL_ADDRESS is required in every email (CAN-SPAM)');
  return { ...mail, html: mail.html.replaceAll(POSTAL, esc(postal.trim())), text: mail.text.replaceAll(POSTAL, postal.trim()) };
}
