(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const num = new Intl.NumberFormat('en-US');
  const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const longDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------- Data ----------

  async function loadData() {
    if (window.__TRANSFER_DATA__) return window.__TRANSFER_DATA__;
    const get = (f) => fetch(`data/${f}`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load data/${f} (HTTP ${r.status})`);
      return r.json();
    });
    const [programs, transfers, promotions] = await Promise.all([get('programs.json'), get('transfers.json'), get('promotions.json')]);
    return { programs, transfers, promotions };
  }

  function index(data) {
    const day = localToday();
    const routes = new Map(data.transfers.transfers.map((t) => [`${t.from}>${t.to}`, t]));
    const history = new Map();
    for (const h of data.promotions.history || []) {
      const k = `${h.from}>${h.to}`;
      if (!history.has(k)) history.set(k, []);
      history.get(k).push(h);
    }
    const live = (data.promotions.promotions || []).filter((p) => {
      const end = p.end || p.assumedEnd;
      return routes.has(`${p.from}>${p.to}`) && (!p.start || p.start <= day) && (!end || end >= day);
    });
    return {
      ...data,
      day,
      routes,
      live,
      promo: new Map(live.map((p) => [`${p.from}>${p.to}`, p])),
      history,
      historySince: data.promotions.historySince || null,
      partners: new Map(data.programs.partners.map((p) => [p.id, p])),
      currencies: new Map(data.programs.currencies.map((c) => [c.id, c])),
      groups: data.programs.groups,
    };
  }

  let D; // indexed data

  const received = (t, promo, amount = 1000) => Math.floor((amount * t.ratio[1]) / t.ratio[0] * (1 + (promo ? promo.bonus : 0) / 100));

  function ratioText([a, b]) {
    if (a > b) return `${a}:${b}`;
    const r = Math.round((b / a) * 100) / 100;
    return `1:${r}`;
  }

  function endText(p) {
    if (!p.end) return 'end date not listed';
    if (p.end === D.day) return 'last day today';
    return `until ${shortDate.format(new Date(`${p.end}T00:00:00Z`))}`;
  }

  // ---------- State ----------

  const state = { view: 'routes', from: 'chase', type: 'all', bonusOnly: false, partner: null };

  function readURL() {
    const q = new URLSearchParams(location.search);
    if (q.get('view') === 'compare') state.view = 'compare';
    if (q.get('from') && D.currencies.has(q.get('from'))) state.from = q.get('from');
    if (['airline', 'hotel'].includes(q.get('type'))) state.type = q.get('type');
    state.bonusOnly = q.get('bonus') === '1';
    if (D.partners.has(q.get('partner'))) state.partner = q.get('partner');
  }

  function writeURL() {
    const q = new URLSearchParams();
    if (state.view !== 'routes') q.set('view', state.view);
    if (state.view === 'routes') q.set('from', state.from);
    if (state.type !== 'all') q.set('type', state.type);
    if (state.bonusOnly) q.set('bonus', '1');
    if (state.partner) q.set('partner', state.partner);
    const s = q.toString();
    try { history.replaceState(null, '', s ? `?${s}` : location.pathname); } catch { /* sandboxed previews */ }
  }

  // ---------- Controls ----------

  function setupControls() {
    const select = $('#from');
    select.innerHTML = D.programs.currencies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    select.value = state.from;
    select.addEventListener('change', () => { state.from = select.value; render({ animate: true }); });

    const tabs = $$('[role="tab"]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => { state.view = tab.dataset.view; render({ animate: true }); });
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      });
    });

    $$('.chip[data-type]').forEach((chip) => chip.addEventListener('click', () => { state.type = chip.dataset.type; render(); }));
    $('#bonus-only').addEventListener('click', () => { state.bonusOnly = !state.bonusOnly; render(); });

    // Border under the control bar once it sticks, and expose its height for the matrix header.
    const controls = $('#controls');
    new IntersectionObserver(([e]) => controls.classList.toggle('is-stuck', !e.isIntersecting)).observe($('.masthead'));
    new ResizeObserver(() => document.documentElement.style.setProperty('--controls-h', `${controls.offsetHeight}px`)).observe(controls);
  }

  function syncControls() {
    $$('[role="tab"]').forEach((t) => {
      const on = t.dataset.view === state.view;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    $('#view').setAttribute('aria-labelledby', `tab-${state.view}`);
    $('#from-wrap').hidden = state.view !== 'routes';
    $('#from').value = state.from;
    $$('.chip[data-type]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.type === state.type));
    $('#bonus-only').setAttribute('aria-checked', state.bonusOnly);
  }

  // ---------- Filtering ----------

  function groupedPartners(filterFn) {
    const out = [];
    for (const g of D.groups) {
      const items = D.programs.partners
        .filter((p) => p.group === g.id && filterFn(p))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (items.length) out.push({ group: g, items });
    }
    return out;
  }

  const typeOK = (p) => state.type === 'all' || p.type === state.type;

  // ---------- Bonus strip ----------

  function renderBonuses() {
    const el = $('#bonuses');
    const cur = D.currencies.get(state.from);
    const list = D.live
      .filter((p) => state.view === 'compare' || p.from === state.from)
      .filter((p) => typeOK(D.partners.get(p.to)))
      .sort((a, b) => (a.end || a.assumedEnd || '9').localeCompare(b.end || b.assumedEnd || '9'));

    if (!list.length) {
      const scope = state.view === 'compare' ? '' : ` from ${esc(cur.name)}`;
      el.innerHTML = `<h2>Live bonuses</h2><p class="empty">No live transfer bonuses${scope} right now. The list is checked every 6 hours.</p>`;
      return;
    }
    el.innerHTML = `
      <h2>${list.length} live bonus${list.length > 1 ? 'es' : ''}</h2>
      <ul class="tickets">
        ${list.map((p) => `
          <li><button class="ticket" data-partner="${p.to}" data-from="${p.from}">
            <span class="t-route">From ${esc(D.currencies.get(p.from).short)}</span>
            <span class="t-name">${esc(D.partners.get(p.to).name)}</span>
            <span class="t-deal"><b>+${p.bonus}%</b> ${endText(p)}</span>
          </button></li>`).join('')}
      </ul>`;
    $$('.ticket', el).forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.partner, b.dataset.from)));
  }

  // ---------- Route view ----------

  const weight = d3.scaleLog().domain([200, 4000]).range([1.25, 7.5]).clamp(true);

  function stopSubline(t, promo, partner) {
    if (promo) return endText(promo);
    if (t.variants) return 'Ratio depends on your card';
    return t.note || partner.note || '';
  }

  function renderRoutes(animate) {
    const cur = D.currencies.get(state.from);
    const reachable = (p) => D.routes.has(`${cur.id}>${p.id}`);
    const all = D.programs.partners.filter(reachable);
    const groups = groupedPartners((p) => reachable(p) && typeOK(p) && (!state.bonusOnly || D.promo.has(`${cur.id}>${p.id}`)));
    const shown = groups.reduce((n, g) => n + g.items.length, 0);

    const view = $('#view');
    const countText = shown === all.length ? `${all.length} partners` : `${shown} of ${all.length} partners`;

    if (!shown) {
      view.innerHTML = `
        <div class="route-head"><h2>${esc(cur.name)}</h2><span class="count">${countText}</span></div>
        <div class="empty-state">
          <p>${state.bonusOnly ? `No ${state.type === 'all' ? '' : `${state.type} `}partners have a live bonus from ${esc(cur.short)} right now.` : `${esc(cur.short)} has no ${state.type} partners.`}</p>
          <button class="chip" id="reset-filters">Show all partners</button>
        </div>`;
      $('#reset-filters').addEventListener('click', () => { state.type = 'all'; state.bonusOnly = false; render(); });
      return;
    }

    view.innerHTML = `
      <div class="route-head"><h2>${esc(cur.name)}</h2><span class="count">${countText}</span></div>
      ${cur.note ? `<p class="currency-note">${esc(cur.note)}</p>` : ''}
      <div class="routes">
        <svg class="rail" aria-hidden="true"></svg>
        <ol class="route-list">
          ${groups.map(({ group, items }) => `
            <li class="group-label" aria-hidden="true">${esc(group.label)}</li>
            ${items.map((p) => {
              const t = D.routes.get(`${cur.id}>${p.id}`);
              const promo = D.promo.get(`${cur.id}>${p.id}`);
              const out = received(t, promo);
              const sub = stopSubline(t, promo, p);
              const label = `${p.name}, ${group.label}. 1,000 ${cur.short} points become ${num.format(out)}${promo ? ` with a ${promo.bonus}% bonus ${endText(promo)}` : ''}.`;
              return `<li><button class="stop" data-partner="${p.id}" data-weight="${out}" data-bonus="${promo ? 1 : 0}" aria-label="${esc(label)}">
                <span class="stop-name">${esc(p.name)}</span>
                ${sub ? `<span class="stop-sub">${esc(sub)}</span>` : ''}
                <span class="stop-rate">1,000 → <strong>${num.format(out)}</strong>${promo ? `<span class="badge">+${promo.bonus}%</span><span class="was">${num.format(received(t))}</span>` : ''}</span>
              </button></li>`;
            }).join('')}
          `).join('')}
        </ol>
      </div>
      <div class="legend" aria-hidden="true">
        <span class="legend-title">Line weight shows points received per 1,000 sent</span>
        <span><svg width="36" height="10"><line class="swatch-route" x1="2" y1="5" x2="34" y2="5" stroke-width="${weight(500)}" stroke-linecap="round"/></svg>500</span>
        <span><svg width="36" height="10"><line class="swatch-route" x1="2" y1="5" x2="34" y2="5" stroke-width="${weight(1000)}" stroke-linecap="round"/></svg>1,000</span>
        <span><svg width="36" height="10"><line class="swatch-route" x1="2" y1="5" x2="34" y2="5" stroke-width="${weight(2000)}" stroke-linecap="round"/></svg>2,000</span>
        <span><svg width="36" height="10"><line class="swatch-bonus" x1="2" y1="5" x2="34" y2="5" stroke-width="4" stroke-linecap="round"/></svg>Live bonus</span>
      </div>`;

    $$('.stop', view).forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.partner, cur.id)));
    drawRail(animate && !reduceMotion.matches);
  }

  function drawRail(animate) {
    const wrap = $('.routes');
    if (!wrap) return;
    const svg = d3.select(wrap).select('svg.rail');
    const box = wrap.getBoundingClientRect();
    const W = svg.node().clientWidth;
    const trunkX = W < 60 ? 12 : 20;
    const r = W < 60 ? 10 : 16;
    const endX = W - 7;

    const stops = $$('.stop', wrap).map((el) => {
      const b = el.getBoundingClientRect();
      return { id: el.dataset.partner, y: b.top - box.top + b.height / 2, w: weight(+el.dataset.weight), bonus: el.dataset.bonus === '1' };
    });
    if (!stops.length) return;
    const firstLabel = $('.group-label', wrap).getBoundingClientRect();
    const originY = firstLabel.top - box.top + firstLabel.height / 2;
    const lastY = stops[stops.length - 1].y;

    svg.selectAll('*').remove();

    // Branches first so the trunk sits on top; bonus routes drawn last so they aren't hidden.
    const ordered = [...stops].sort((a, b) => a.bonus - b.bonus);
    const branch = svg.append('g').selectAll('path').data(ordered, (d) => d.id).join('path')
      .attr('class', (d) => `branch${d.bonus ? ' is-bonus' : ''}`)
      .attr('stroke-width', (d) => (d.bonus ? Math.max(d.w, 3.5) : d.w))
      .attr('d', (d) => `M${trunkX},${d.y - r} Q${trunkX},${d.y} ${trunkX + r},${d.y} H${endX}`);

    const trunk = svg.append('path').attr('class', 'trunk').attr('d', `M${trunkX},${originY} V${lastY - r}`);
    svg.append('circle').attr('class', 'origin-ring').attr('cx', trunkX).attr('cy', originY).attr('r', 6.5);
    svg.append('circle').attr('class', 'origin').attr('cx', trunkX).attr('cy', originY).attr('r', 2.5);

    const dots = svg.append('g').selectAll('circle').data(stops, (d) => d.id).join('circle')
      .attr('class', (d) => `stop-dot${d.bonus ? ' is-bonus' : ''}`)
      .attr('cx', endX).attr('cy', (d) => d.y).attr('r', 4.5);

    if (!animate) return;

    // One orchestrated moment: the trunk draws down, branches peel off in order.
    const trunkLen = trunk.node().getTotalLength();
    trunk.attr('stroke-dasharray', trunkLen).attr('stroke-dashoffset', trunkLen)
      .transition().duration(420).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

    branch.each(function (d) {
      const len = this.getTotalLength();
      const delay = 120 + (d.y / Math.max(lastY, 1)) * 420;
      d3.select(this).attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
        .transition().delay(delay).duration(320).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    });
    dots.attr('opacity', 0).transition().delay((d) => 360 + (d.y / Math.max(lastY, 1)) * 420).duration(200).attr('opacity', 1);
  }

  // ---------- Compare view ----------

  const dotR = d3.scaleSqrt().domain([0, 4000]).range([0, 13]);

  function renderCompare() {
    const cols = D.programs.currencies;
    const anyBonus = (p) => cols.some((c) => D.promo.has(`${c.id}>${p.id}`));
    const groups = groupedPartners((p) => typeOK(p) && (!state.bonusOnly || anyBonus(p)));
    const view = $('#view');

    if (!groups.length) {
      view.innerHTML = `<div class="empty-state"><p>No ${state.type === 'all' ? '' : `${state.type} `}partners have a live bonus right now.</p><button class="chip" id="reset-filters">Show all partners</button></div>`;
      $('#reset-filters').addEventListener('click', () => { state.type = 'all'; state.bonusOnly = false; render(); });
      return;
    }

    view.innerHTML = `
      <div class="matrix" style="--cols:${cols.length}">
        <div class="m-head" aria-hidden="true">
          <span class="m-name">Partner</span>
          <div class="m-cols">${cols.map((c) => `<span>${esc(c.short)}</span>`).join('')}</div>
        </div>
        <div class="m-body"></div>
      </div>
      <div class="legend" aria-hidden="true">
        <span class="legend-title">Dot size shows points received per 1,000 sent. Tap a row for exact numbers.</span>
        ${[500, 1000, 2000].map((v) => `<span><svg width="${Math.ceil(dotR(v) * 2 + 2)}" height="28"><circle class="dot" cx="${dotR(v) + 1}" cy="14" r="${dotR(v)}"/></svg>${num.format(v)}</span>`).join('')}
        <span><svg width="16" height="28"><circle class="dot is-bonus" cx="8" cy="14" r="6.5"/></svg>Live bonus</span>
      </div>`;

    const body = d3.select(view).select('.m-body');
    for (const { group, items } of groups) {
      body.append('div').attr('class', 'group-label').attr('aria-hidden', 'true').text(group.label);
      const rows = body.selectAll(null).data(items).join('button')
        .attr('class', 'm-row')
        .attr('aria-label', (p) => `${p.name}: ${cols.map((c) => {
          const t = D.routes.get(`${c.id}>${p.id}`);
          if (!t) return `${c.short} no`;
          const promo = D.promo.get(`${c.id}>${p.id}`);
          return `${c.short} ${num.format(received(t, promo))}${promo ? ` with bonus` : ''}`;
        }).join(', ')}`)
        .on('click', (_, p) => openSheet(p.id, null));

      rows.append('span').attr('class', 'm-name').text((p) => p.name);
      const svg = rows.append('svg').attr('class', 'm-dots').attr('width', '100%').attr('height', 28).attr('aria-hidden', 'true');

      svg.each(function (p) {
        const cells = cols.map((c, i) => {
          const t = D.routes.get(`${c.id}>${p.id}`);
          const promo = D.promo.get(`${c.id}>${p.id}`);
          return { i, t, promo, v: t ? received(t, promo) : 0 };
        });
        const s = d3.select(this);
        const cx = (d) => `${((d.i + 0.5) / cols.length) * 100}%`;
        s.selectAll('circle').data(cells.filter((d) => d.t)).join('circle')
          .attr('class', (d) => `cell-dot${d.promo ? ' is-bonus' : ''}`)
          .attr('cx', cx).attr('cy', 14).attr('r', (d) => Math.max(2.5, dotR(d.v)));
        // A short hairline marks "no route" so empty cells read as a deliberate absence.
        s.selectAll('line').data(cells.filter((d) => !d.t)).join('line')
          .attr('class', 'cell-none')
          .attr('x1', cx).attr('x2', cx).attr('y1', 11).attr('y2', 17)
          .attr('transform', 'translate(0,0)');
      });
    }
  }

  // ---------- Detail sheet ----------

  let sheetAmount = 10000;

  function timeText(t) {
    if (!t) return '';
    const { min, max, unit } = t;
    if (max === 0) return 'Arrives instantly';
    const u = max === 1 ? unit.replace(/s$/, '') : unit;
    return min === 0 ? `Arrives within ${max} ${u}` : `Arrives in ${min === max ? max : `${min}–${max}`} ${u}`;
  }

  const minimumOf = (t, c) => ({ min: t.min ?? c.minTransfer, step: t.increment ?? c.increment ?? c.minTransfer });

  function minimumText({ min, step }) {
    if (min <= 1 && step <= 1) return 'No minimum';
    if (step <= 1) return `Minimum ${num.format(min)}`;
    return `Minimum ${num.format(min)}, ${step === min ? 'in' : 'then'} ${num.format(step)}-point steps`;
  }

  function sourcesHTML(sources = []) {
    const top = sources.slice(0, 3);
    if (!top.length) return '';
    const label = (s) => s.feed || s.url.replace(/^https?:\/\/(www\.)?([^/]+).*/, '$2');
    return `. ${top.length > 1 ? 'Sources' : 'Source'}: ${top.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(label(s))}</a>`).join(', ')}`;
  }

  // Bonus history as bars on a timeline from historySince to today: past bonuses in the route colour,
  // the live one in the bonus accent, time before the route existed shaded. Every card shares the same
  // timeline so rows compare at a glance. Percent x units, so nothing needs measuring.
  function historyChart(key, live, routeSince) {
    const start = Date.parse(`${D.historySince}T00:00:00Z`);
    const span = Date.parse(`${D.day}T00:00:00Z`) + 864e5 - start;
    const x = (iso) => Math.max(0, Math.min(1, (Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - start) / span)) * 100;
    const oneDay = (100 * 864e5) / span;
    const bars = (D.history.get(key) || [])
      .map((h) => ({ s: h.start || h.firstSeen || h.end, e: h.end || h.assumedEnd || h.start || h.firstSeen, bonus: h.bonus, targeted: h.targeted }))
      .filter((b) => b.s && b.e >= D.historySince);
    if (live) bars.push({ s: live.start || live.firstSeen || D.day, e: D.day, bonus: live.bonus, live: true });
    const top = Math.max(50, ...bars.map((b) => b.bonus));
    const H = 34;
    const years = [];
    for (let y = +D.historySince.slice(0, 4) + 1; y <= +D.day.slice(0, 4); y++) years.push(x(`${y}-01-01`));
    return `<svg class="r-hist" aria-hidden="true" height="${H + 18}">
      ${years.map((yx, i) => `<line class="hist-tick" x1="${yx}%" x2="${yx}%" y1="0" y2="${H + 4}"/><text x="${yx}%" y="${H + 16}" dx="3">${+D.historySince.slice(0, 4) + 1 + i}</text>`).join('')}
      ${routeSince > D.historySince ? `<rect class="hist-before" x="0" width="${x(routeSince)}%" y="0" height="${H}"/>` : ''}
      <line class="hist-axis" x1="0" x2="100%" y1="${H}" y2="${H}"/>
      ${bars.map((b) => {
        const h = Math.max(3, (b.bonus / top) * (H - 4));
        return `<rect class="hist-bar${b.live ? ' is-live' : ''}${b.targeted ? ' is-targeted' : ''}" x="${x(b.s)}%" width="${Math.max(0.6, x(b.e) - x(b.s) + oneDay)}%" y="${H - h}" height="${h}" rx="1"><title>+${b.bonus}%, ${esc(b.s)} to ${esc(b.e)}${b.targeted ? ', targeted' : ''}</title></rect>`;
      }).join('')}
    </svg>`;
  }

  function adviceHTML(o) {
    if (!D.historySince || !window.transferAdvice) return '';
    const key = `${o.c.id}>${o.t.to}`;
    // A route launched after the archive starts is only judged on its own lifetime.
    const since = o.t.added && o.t.added > D.historySince ? o.t.added : D.historySince;
    const a = window.transferAdvice.advise({ history: D.history.get(key) || [], live: o.promo || null, since, day: D.day });
    return `
      <span class="r-advice"><span class="verdict is-${a.verdict}">${a.verdict === 'go' ? 'Go' : 'Wait'}</span><span>${esc(a.reason)}</span></span>
      ${historyChart(key, o.promo, since)}
      <span class="r-record">${esc(a.record)}</span>`;
  }

  function openSheet(partnerId, fromId) {
    const p = D.partners.get(partnerId);
    const group = D.groups.find((g) => g.id === p.group);
    const dlg = $('#sheet');
    const options = D.programs.currencies
      .map((c) => ({ c, t: D.routes.get(`${c.id}>${p.id}`), promo: D.promo.get(`${c.id}>${p.id}`) }))
      .filter((o) => o.t);
    const missing = D.programs.currencies.filter((c) => !D.routes.has(`${c.id}>${p.id}`));

    options.sort((a, b) => (b.c.id === fromId) - (a.c.id === fromId) || received(b.t, b.promo) - received(a.t, a.promo));

    const notes = [];
    if (p.note) notes.push(esc(p.note));
    for (const o of options) {
      if (o.t.timeNote) notes.push(`${esc(o.c.short)}: ${esc(o.t.timeNote)}`);
      if (o.t.minNote) notes.push(`${esc(o.c.short)}: ${esc(o.t.minNote)}`);
      if (o.t.variants) o.t.variants.forEach((v) => notes.push(`${esc(o.c.short)}: ${esc(v.label)} transfer at ${ratioText(v.ratio)}.`));
      if (o.t.note) notes.push(`${esc(o.c.short)}: ${esc(o.t.note)}.`);
      if (o.promo?.note) notes.push(`${esc(o.c.short)} bonus: ${esc(o.promo.note)}`);
      if (o.c.note && (o.c.id === 'citi' || o.c.id === fromId)) notes.push(`${esc(o.c.short)}: ${esc(o.c.note)}`);
    }

    dlg.innerHTML = `
      <div class="sheet-inner">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-top">
          <div>
            <h2 id="sheet-title">${esc(p.name)}</h2>
            <p class="kicker">${p.type === 'hotel' ? 'Hotel program' : `${esc(group.label)}${p.group === 'none' ? '' : ' airline'}`}</p>
          </div>
          <button class="close" aria-label="Close">×</button>
        </div>
        <div class="calc">
          <label for="amount">Points to transfer</label>
          <input id="amount" inputmode="numeric" autocomplete="off" value="${num.format(sheetAmount)}">
        </div>
        <ul class="reach">
          ${options.map((o) => `
            <li class="${o.c.id === fromId ? 'is-current' : ''}" data-cur="${o.c.id}">
              <span class="r-name">${esc(o.c.name)}</span>
              <span class="r-out" data-out></span>
              <span class="r-meta">
                Ratio ${o.t.variants ? `${[...new Set(o.t.variants.map((v) => ratioText(v.ratio)))].join(' or ')} depending on card` : ratioText(o.t.ratio)}${o.promo ? `. <b>+${o.promo.bonus}%</b> ${endText(o.promo)}, normally <span data-was></span>${sourcesHTML(o.promo.sources)}` : ''}
              </span>
              <span class="r-facts">${[timeText(o.t.time), minimumText(minimumOf(o.t, o.c))].filter(Boolean).join('. ')}.<span data-below hidden></span></span>
              ${adviceHTML(o)}
            </li>`).join('')}
        </ul>
        ${missing.length ? `<p class="reach-none">Not a partner of ${missing.map((c) => esc(c.short)).join(', ')}.</p>` : ''}
        ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
      </div>`;

    const input = $('#amount', dlg);
    const update = () => {
      sheetAmount = Math.min(10_000_000, parseInt(input.value.replace(/[^\d]/g, ''), 10) || 0);
      $$('.reach li', dlg).forEach((li) => {
        const o = options.find((x) => x.c.id === li.dataset.cur);
        $('[data-out]', li).textContent = num.format(received(o.t, o.promo, sheetAmount));
        const was = $('[data-was]', li);
        if (was) was.textContent = num.format(received(o.t, null, sheetAmount));
        const below = $('[data-below]', li);
        below.hidden = sheetAmount >= minimumOf(o.t, o.c).min;
        below.textContent = ` ${num.format(sheetAmount)} is below the minimum.`;
      });
    };
    input.addEventListener('input', update);
    input.addEventListener('blur', () => { input.value = num.format(sheetAmount); });
    input.addEventListener('focus', () => input.select());
    update();

    $('.close', dlg).addEventListener('click', () => dlg.close());
    enableSwipeToClose(dlg);
    dlg.showModal();
    state.partner = p.id;
    writeURL();
  }

  function enableSwipeToClose(dlg) {
    const handle = $('.sheet-top', dlg).parentElement;
    let startY = null;
    handle.addEventListener('touchstart', (e) => {
      if (dlg.scrollTop > 0 || e.target.closest('input, a, button')) return;
      startY = e.touches[0].clientY;
    }, { passive: true });
    handle.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      const dy = Math.max(0, e.touches[0].clientY - startY);
      dlg.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    handle.addEventListener('touchend', (e) => {
      if (startY == null) return;
      const dy = e.changedTouches[0].clientY - startY;
      startY = null;
      dlg.style.transform = '';
      if (dy > 90) dlg.close();
    });
  }

  // ---------- Partner search ----------

  const words = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  // Every query word must start a word in the partner's name, id or note, so "miles more",
  // "klm", "avios" and "alaska" all find something. Name matches rank above note matches.
  function searchPartners(query) {
    const q = words(query);
    const hits = [];
    for (const p of D.programs.partners) {
      const name = words(p.name);
      const extra = [p.id, ...words(p.note)];
      let score = q.join('') === p.id ? 4 : 0;
      for (const w of q) {
        if (name.some((n) => n.startsWith(w))) score += 2;
        else if (extra.some((n) => n.startsWith(w))) score += 1;
        else { score = -1; break; }
      }
      if (score < 0) continue;
      if (q.length && name[0].startsWith(q[0])) score += 1;
      hits.push({ p, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name)).map((h) => h.p);
  }

  function setupFinder() {
    const dlg = $('#finder');
    const input = $('#finder-input');
    const list = $('#finder-list');
    const empty = $('#finder-empty');
    let results = [];
    let active = 0;

    const optionHTML = (p, i) => {
      const group = D.groups.find((g) => g.id === p.group);
      const from = D.programs.currencies.filter((c) => D.routes.has(`${c.id}>${p.id}`)).map((c) => esc(c.short));
      const bonus = Math.max(0, ...D.live.filter((x) => x.to === p.id).map((x) => x.bonus));
      return `<li role="option" id="finder-opt-${i}" data-partner="${p.id}" aria-selected="${i === active}">
        <span class="f-name">${esc(p.name)}${bonus ? `<span class="badge">+${bonus}%</span>` : ''}</span>
        <span class="f-sub">${esc(group.label)}. From ${from.join(', ')}</span>
      </li>`;
    };

    const setActive = (i) => {
      if (!results.length) return;
      active = (i + results.length) % results.length;
      $$('[role="option"]', list).forEach((li, j) => li.setAttribute('aria-selected', j === active));
      input.setAttribute('aria-activedescendant', `finder-opt-${active}`);
      $(`#finder-opt-${active}`).scrollIntoView({ block: 'nearest' });
    };

    const update = () => {
      results = searchPartners(input.value);
      active = 0;
      list.innerHTML = results.map(optionHTML).join('');
      empty.textContent = results.length ? '' : `No partner matches "${input.value.trim()}".`;
      empty.hidden = !!results.length;
      if (results.length) input.setAttribute('aria-activedescendant', 'finder-opt-0');
      else input.removeAttribute('aria-activedescendant');
      list.scrollTop = 0;
    };

    const choose = (id) => {
      dlg.close();
      openSheet(id, state.view === 'routes' ? state.from : null);
    };

    const open = () => {
      input.value = '';
      update();
      dlg.showModal();
      input.focus();
    };

    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter' && results.length) {
        e.preventDefault();
        choose(results[active].id);
      }
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[role="option"]');
      if (li) choose(li.dataset.partner);
    });
    $('.finder-cancel', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    $('#finder-open').addEventListener('click', open);

    // "/" opens search from anywhere, as on most sites with a search box.
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]') || e.target.closest('input, select, textarea')) return;
      e.preventDefault();
      open();
    });
  }

  // ---------- Theme ----------

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const canStore = !window.__NO_STORAGE__;

  function effectiveTheme() {
    return document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');
  }

  function syncTheme() {
    const eff = effectiveTheme();
    const root = document.documentElement;
    root.dataset.effective = eff;
    const btn = $('#theme-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(eff === 'light'));
      btn.setAttribute('aria-label', eff === 'light' ? 'Light mode on. Switch to dark mode' : 'Dark mode on. Switch to light mode');
      $('.t-label', btn).textContent = eff === 'light' ? 'Light' : 'Dark';
    }
    const bg = getComputedStyle(root).getPropertyValue('--haze').trim();
    $$('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', bg); m.removeAttribute('media'); });
  }

  function setupTheme() {
    syncTheme();
    $('#theme-toggle').addEventListener('click', () => {
      const next = effectiveTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      if (canStore) { try { localStorage.setItem('theme', next); } catch { /* private mode */ } }
      syncTheme();
    });
    // Follow the OS setting until the person makes a choice.
    systemDark.addEventListener('change', () => { if (!document.documentElement.dataset.theme) syncTheme(); });
  }

  // ---------- Easter eggs ----------

  // Typing one of these words anywhere outside a text field plays its egg.
  const EGGS = { lee: () => dropImage('assets/eggs/lee.webp') };
  let eggPlaying = false;

  function setupEggs() {
    const longest = Math.max(...Object.keys(EGGS).map((w) => w.length));
    let typed = '';
    document.addEventListener('keydown', (e) => {
      if (e.key.length !== 1 || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest('input, select, textarea')) return;
      typed = (typed + e.key.toLowerCase()).slice(-longest);
      const word = Object.keys(EGGS).find((w) => typed.endsWith(w));
      if (word && !eggPlaying) { typed = ''; EGGS[word](); }
    });
  }

  // Drops the image from above the viewport, bounces it on the bottom edge, then fades it out.
  async function dropImage(src) {
    eggPlaying = true;
    const img = new Image();
    img.src = src;
    img.alt = '';
    img.className = 'egg';
    try {
      await img.decode();
      document.body.append(img);
      if (img.showPopover) { img.popover = 'manual'; img.showPopover(); }
      const h = img.offsetHeight;
      const floor = window.innerHeight - h;
      const at = (y, sx = 1, sy = 1) => `translate(-50%, ${y}px) scale(${sx}, ${sy})`;
      let land;
      if (reduceMotion.matches) {
        land = img.animate({ transform: [at(floor), at(floor)], opacity: [0, 1] }, { duration: 300, fill: 'forwards' });
      } else {
        // Each rebound reaches a share of the drop height and, like a real bounce, lasts in
        // proportion to its square root. Impacts squash slightly; the last 5% settles the squash.
        const fall = 'cubic-bezier(.55, 0, 1, .45)';
        const rise = 'cubic-bezier(0, .55, .45, 1)';
        const hops = [0.3, 0.1, 0.03];
        const total = (1 + hops.reduce((s, r) => s + 2 * Math.sqrt(r), 0)) / 0.95;   // in fall-times
        const frames = [
          { offset: 0, transform: at(-h), easing: fall },
          { offset: 1 / total, transform: at(floor, 1.08, 0.88), easing: rise },
        ];
        let t = 1;
        for (const r of hops) {
          frames.push({ offset: (t + Math.sqrt(r)) / total, transform: at(floor - r * (floor + h)), easing: fall });
          t += 2 * Math.sqrt(r);
          frames.push({ offset: t / total, transform: at(floor, 1 + r / 3, 1 - r / 2.5), easing: rise });
        }
        frames.push({ offset: 1, transform: at(floor) });
        const fallSeconds = Math.sqrt((2 * (floor + h)) / 4000);   // gravity of 4000 px/s²
        land = img.animate(frames, { duration: fallSeconds * total * 1000, fill: 'forwards' });
      }
      await land.finished;
      await img.animate({ opacity: [1, 0] }, { duration: 400, delay: 1200, fill: 'forwards' }).finished;
    } catch { /* image failed to load or animation was cancelled */ }
    img.remove();
    eggPlaying = false;
  }

  // ---------- Render ----------

  function render({ animate = false } = {}) {
    syncControls();
    renderBonuses();
    if (state.view === 'routes') renderRoutes(animate);
    else renderCompare();
    writeURL();
  }

  // On GitHub Pages (user.github.io/repo/), point "Report a mistake" at that repo's issues.
  function setupReportLink() {
    const link = $('#report-link');
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    if (!link || !m || !repo) return;
    link.href = `https://github.com/${m[1]}/${repo}/issues/new?labels=data-fix`;
    link.hidden = false;
  }

  function renderStatus() {
    const up = D.promotions.updatedAt;
    $('#status').textContent = up
      ? `Bonus list updated ${shortDate.format(new Date(up))}`
      : 'Bonus list not yet updated';
    $('#verified').textContent = `Transfer ratios last verified ${longDate.format(new Date(`${D.transfers.verifiedOn}T00:00:00Z`))}.`;
  }

  async function start() {
    setupTheme();
    try {
      D = index(await loadData());
    } catch (err) {
      $('#status').textContent = `${err.message}. If you opened index.html from disk, serve the folder instead (for example, npx serve).`;
      return;
    }
    readURL();
    setupControls();
    setupFinder();
    setupEggs();
    setupReportLink();
    renderStatus();
    // Wait briefly for B612 so row heights are final before the rail animates.
    if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 900))]);
    render({ animate: true });

    const sheet = $('#sheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
    sheet.addEventListener('close', () => { state.partner = null; writeURL(); });
    if (state.partner) openSheet(state.partner, state.view === 'routes' ? state.from : null);

    // Redraw the rail only when the width actually changes (row heights follow width).
    let raf = 0;
    let lastW = document.body.clientWidth;
    new ResizeObserver(() => {
      const w = document.body.clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => state.view === 'routes' && drawRail(false));
    }).observe(document.body);
  }

  start();
})();
