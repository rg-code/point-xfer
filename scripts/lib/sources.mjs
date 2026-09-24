// Source ranking for transfer bonuses: the issuer's or partner's own page first,
// then AwardWallet, then Frequent Miler, then everyone else.

// Official domains per program id. A URL counts as official when its hostname is
// the domain or a subdomain of it.
export const OFFICIAL_DOMAINS = {
  amex: ['americanexpress.com', 'aexp.com'],
  chase: ['chase.com'],
  citi: ['citi.com', 'thankyou.com'],
  c1: ['capitalone.com'],
  bilt: ['bilt.com', 'biltrewards.com'],
  wf: ['wellsfargo.com'],
  rove: ['rove.com', 'rovemiles.com'],

  aeroplan: ['aircanada.com', 'aeroplan.com'],
  ana: ['ana.co.jp'],
  lifemiles: ['lifemiles.com', 'avianca.com'],
  eva: ['evaair.com'],
  singapore: ['singaporeair.com'],
  tap: ['flytap.com'],
  thai: ['thaiairways.com'],
  turkish: ['turkishairlines.com'],
  united: ['united.com'],
  airindia: ['airindia.com'],
  copa: ['copaair.com'],
  milesmore: ['miles-and-more.com', 'lufthansa.com'],
  aerlingus: ['aerlingus.com'],
  american: ['aa.com'],
  atmos: ['alaskaair.com', 'hawaiianairlines.com', 'atmosrewards.com'],
  ba: ['britishairways.com'],
  cathay: ['cathaypacific.com', 'asiamiles.com'],
  finnair: ['finnair.com'],
  iberia: ['iberia.com'],
  jal: ['jal.co.jp', 'jal.com'],
  qantas: ['qantas.com'],
  qatar: ['qatarairways.com'],
  aeromexico: ['aeromexico.com'],
  flyingblue: ['flyingblue.com', 'airfrance.com', 'airfrance.us', 'klm.com', 'klm.us'],
  delta: ['delta.com'],
  virgin: ['virginatlantic.com'],
  sas: ['flysas.com'],
  vietnam: ['vietnamairlines.com'],
  emirates: ['emirates.com'],
  etihad: ['etihad.com'],
  jetblue: ['jetblue.com'],
  southwest: ['southwest.com'],
  virginred: ['virgin.com'],
  frontier: ['flyfrontier.com'],
  hainan: ['hainanairlines.com'],
  accor: ['accor.com'],
  choice: ['choicehotels.com'],
  hilton: ['hilton.com'],
  iprefer: ['iprefer.com', 'preferredhotels.com'],
  ihg: ['ihg.com'],
  leaders: ['lhw.com'],
  marriott: ['marriott.com'],
  hyatt: ['hyatt.com'],
  wyndham: ['wyndhamhotels.com'],
};

const TIERS = [['awardwallet.com'], ['frequentmiler.com']];

function host(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
const onDomain = (h, d) => h === d || h.endsWith(`.${d}`);

/** True if `url` is on an official domain of any of the given program ids (or of any program). */
export function isOfficial(url, ids = Object.keys(OFFICIAL_DOMAINS)) {
  const h = host(url);
  return !!h && ids.some((id) => (OFFICIAL_DOMAINS[id] || []).some((d) => onDomain(h, d)));
}

/** 0 = official, 1 = AwardWallet, 2 = Frequent Miler, 3 = anything else. */
export function sourceRank(url) {
  if (isOfficial(url)) return 0;
  const h = host(url);
  const i = TIERS.findIndex((ds) => ds.some((d) => onDomain(h, d)));
  return i === -1 ? 3 : i + 1;
}

/** Sort sources best-first (stable within a tier) and drop duplicate URLs. */
export function rankSources(sources = []) {
  const seen = new Set();
  return sources
    .filter((s) => s?.url && !seen.has(s.url) && seen.add(s.url))
    .map((s, i) => ({ s, i, r: sourceRank(s.url) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ s }) => s);
}
