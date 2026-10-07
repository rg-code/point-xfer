// Bonus alert signups for milesmaximizer.com, on a Cloudflare Worker (free plan, workers.dev).
//
//   POST /subscribe  {email, website}  emails a signed confirmation link (double opt-in)
//   GET  /confirm?e=&x=&t=             checks the link, adds the contact to the Resend segment,
//                                      and sends the visitor back to the site (?alerts=...)
//
// No storage: the signed link carries the state and Resend's contact list is the database.
// The GitHub Action sends the alerts themselves as Resend broadcasts (scripts/send-alert.mjs).
//
// Secrets (npx wrangler secret put): RESEND_API_KEY, SIGNING_SECRET, RESEND_SEGMENT_ID.
// Vars (wrangler.toml): ALLOWED_ORIGIN, SITE_URL, FROM_ADDRESS, POSTAL_ADDRESS.

const LINK_DAYS = 7;
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,252}\.[a-z]{2,}$/i;
const enc = new TextEncoder();

export const b64url = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64url(s) {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ''; }
}
const key = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const bytesToB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** HMAC-SHA256 of `data`, base64url. */
export async function sign(secret, data) {
  return bytesToB64url(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data)));
}

/** Constant-time check of a sign() result. */
export async function verify(secret, data, sig) {
  let bytes;
  try { bytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); } catch { return false; }
  return crypto.subtle.verify('HMAC', await key(secret), bytes, enc.encode(data));
}

export const normalizeEmail = (s) => String(s || '').trim().toLowerCase();
export const validEmail = (s) => s.length <= 254 && EMAIL_RE.test(s);

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function confirmEmail(link, env) {
  const postal = env.POSTAL_ADDRESS ? `<br>${esc(env.POSTAL_ADDRESS)}` : '';
  return {
    subject: 'Confirm your Miles Maximizer bonus alerts',
    html: `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#172a42;line-height:1.5">
<p>Tap the button to start getting an email when a new credit card transfer bonus or a transfer partner change shows up on <a href="${esc(env.SITE_URL)}" style="color:#172a42">milesmaximizer.com</a>.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#172a42;color:#ffffff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700">Confirm alerts</a></p>
<p style="color:#5b6b80;font-size:13px">The link works for ${LINK_DAYS} days. If you didn't ask for this, ignore this email and nothing happens.${postal}</p>
</div>`,
    text: `Confirm your Miles Maximizer bonus alerts:\n${link}\n\nYou'll get an email when a new credit card transfer bonus or a transfer partner change shows up on milesmaximizer.com. The link works for ${LINK_DAYS} days. If you didn't ask for this, ignore this email.${env.POSTAL_ADDRESS ? `\n\n${env.POSTAL_ADDRESS}` : ''}`,
  };
}

async function resend(env, path, body, method = 'POST') {
  return fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };

    if (url.pathname === '/subscribe') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ ok: false }, 405, cors);
      if (request.headers.get('Origin') !== env.ALLOWED_ORIGIN) return json({ ok: false }, 403, cors);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400, cors); }
      if (body.website) return json({ ok: true }, 202, cors);   // honeypot: only bots fill the hidden field
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return json({ ok: false, error: 'invalid_email' }, 400, cors);

      const x = Math.floor(Date.now() / 1000) + LINK_DAYS * 86400;
      const t = await sign(env.SIGNING_SECRET, `${email}|${x}`);
      const link = `${url.origin}/confirm?e=${b64url(email)}&x=${x}&t=${t}`;
      const res = await resend(env, '/emails', { from: env.FROM_ADDRESS, to: [email], ...confirmEmail(link, env) });
      if (!res.ok) {
        console.log('confirmation email failed', res.status);   // no address in logs
        return json({ ok: false, error: 'send_failed' }, 502, cors);
      }
      return json({ ok: true }, 202, cors);
    }

    if (url.pathname === '/confirm' && request.method === 'GET') {
      const email = normalizeEmail(unb64url(url.searchParams.get('e') || ''));
      const x = Number(url.searchParams.get('x'));
      const t = url.searchParams.get('t') || '';
      const ok = validEmail(email) && x > Date.now() / 1000 && await verify(env.SIGNING_SECRET, `${email}|${x}`, t);
      if (!ok) return Response.redirect(`${env.SITE_URL}/?alerts=expired`, 302);

      const created = await resend(env, '/contacts', { email, unsubscribed: false, segments: [{ id: env.RESEND_SEGMENT_ID }] });
      if (!created.ok) {
        // Already a contact (signed up before, or unsubscribed and came back): they just confirmed again,
        // so re-subscribe and make sure they're in the segment.
        const id = encodeURIComponent(email);
        const updated = await resend(env, `/contacts/${id}`, { unsubscribed: false }, 'PATCH');
        const added = await resend(env, `/contacts/${id}/segments/${env.RESEND_SEGMENT_ID}`, null);
        if (!updated.ok && !added.ok) {
          console.log('confirm failed', created.status, updated.status, added.status);
          return Response.redirect(`${env.SITE_URL}/?alerts=error`, 302);
        }
      }
      return Response.redirect(`${env.SITE_URL}/?alerts=subscribed`, 302);
    }

    return new Response('Not found', { status: 404 });
  },
};
