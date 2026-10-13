// The passphrase gate for minty.milesmaximizer.com (a Cloudflare Pages Function, same site as
// the page). POST /api/check {passphrase}: every passphrase entered is logged (D1 table
// `entries`); one that starts with an accepted prefix and a dash ("TLS-xyz" for the prefix TLS)
// gets the links back. Accepted prefixes live in the GATE_PREFIXES secret (comma-separated,
// case-insensitive), not in this public repo. A basic gate: the links point at a public repo.
const LINKS = {
  getStarted: "https://github.com/rg-code/minty/blob/main/GET-STARTED.md",
  fork: "https://github.com/rg-code/minty/fork",
  repo: "https://github.com/rg-code/minty",
  zip: "https://github.com/rg-code/minty/archive/refs/heads/main.zip",
  clone: "git clone https://github.com/rg-code/minty.git",
  license: "https://github.com/rg-code/minty/blob/main/LICENSE",
};
const MAX_LENGTH = 120;

export function matches(passphrase, prefixesSetting) {
  const p = passphrase.trim().toLowerCase();
  return String(prefixesSetting ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    .some((prefix) => p.startsWith(prefix + "-") && p.length > prefix.length + 1);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  // same site only: refuse posts made from other pages
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "forbidden" }, 403);
  let passphrase = "";
  try { passphrase = String((await request.json())?.passphrase ?? ""); } catch { /* not JSON */ }
  passphrase = passphrase.trim().slice(0, MAX_LENGTH);
  if (!passphrase) return json({ ok: false, error: "Enter a passphrase." }, 400);
  // a few tries a minute per visitor, so the log can't be flooded
  const since = new Date(Date.now() - 60_000).toISOString();
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const key = ip ? await digest(ip) : null;          // only a hash, kept for the rate limit
  if (key) {
    const recent = await env.DB.prepare("SELECT count(*) AS n FROM entries WHERE visitor = ? AND created_at > ?").bind(key, since).first();
    if ((recent?.n ?? 0) >= 6) return json({ ok: false, error: "Too many tries. Wait a minute and try again." }, 429);
  }
  const ok = matches(passphrase, env.GATE_PREFIXES);
  await env.DB.prepare("INSERT INTO entries (passphrase, matched, country, visitor) VALUES (?, ?, ?, ?)")
    .bind(passphrase, ok ? 1 : 0, request.cf?.country ?? null, key).run();
  return json(ok ? { ok: true, links: LINKS } : { ok: false, error: "That passphrase isn't right. Check it with whoever shared Minty with you." });
}

async function digest(s) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("minty-gate:" + s)));
  return [...b.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
