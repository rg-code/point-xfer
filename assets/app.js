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

  // Opens on By card with "All cards": every partner, each at its best route. Picking a currency
  // is `?from=<currency>`; Compare cards is `?view=compare`.
  const ALL = 'all';
  // `line`: the card lit on the All cards transit map (null = every line).
  // `layout`: All cards drawn as the 'strip' or the 'terminal' map; null = terminal on wide screens, strip on phones.
  const state = { view: 'routes', from: ALL, type: 'all', bonusOnly: false, partner: null, line: null, layout: null };
  const wide = window.matchMedia('(min-width: 720px)');
  const terminalLayout = () => (state.layout ?? (wide.matches ? 'terminal' : 'strip')) === 'terminal';

  function readURL() {
    const q = new URLSearchParams(location.search);
    if (q.get('from') && D.currencies.has(q.get('from'))) state.from = q.get('from');
    if (['routes', 'compare'].includes(q.get('view'))) state.view = q.get('view');
    if (['airline', 'hotel'].includes(q.get('type'))) state.type = q.get('type');
    state.bonusOnly = q.get('bonus') === '1';
    if (D.partners.has(q.get('partner'))) state.partner = q.get('partner');
    if (D.currencies.has(q.get('line'))) state.line = q.get('line');
    // 'circle' was the concentric-ring layout the terminal replaced; old links open the terminal.
    const layout = q.get('layout') === 'circle' ? 'terminal' : q.get('layout');
    if (['strip', 'terminal'].includes(layout)) state.layout = layout;
  }

  // Source tags on the arriving link (?source=mu from the museum finder) stay in the address:
  // GoatCounter reads it when the page finishes loading, after the first writeURL().
  const SOURCE_TAGS = ['source', 'ref', 'src', 'utm_source', 'utm_medium', 'utm_campaign', 'campaign'];
  const arrivedWith = new URLSearchParams(location.search);

  function writeURL() {
    const q = new URLSearchParams();
    if (state.view === 'compare') q.set('view', 'compare');
    else if (state.from !== ALL) q.set('from', state.from);
    if (state.type !== 'all') q.set('type', state.type);
    if (state.bonusOnly) q.set('bonus', '1');
    if (state.partner) q.set('partner', state.partner);
    if (state.line && state.view === 'routes' && state.from === ALL) q.set('line', state.line);
    if (state.layout && state.view === 'routes' && state.from === ALL) q.set('layout', state.layout);
    for (const k of SOURCE_TAGS) if (arrivedWith.has(k)) q.set(k, arrivedWith.get(k));
    const s = q.toString();
    try { history.replaceState(null, '', s ? `?${s}` : location.pathname); } catch { /* sandboxed previews */ }
  }

  // ---------- Controls ----------

  function setupControls() {
    const select = $('#from');
    select.innerHTML = `<option value="${ALL}">All cards</option>`
      + D.programs.currencies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
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

  // The one currency in view: By card with a currency picked. Null for All cards and Compare.
  const oneCard = () => (state.view === 'routes' && state.from !== ALL ? D.currencies.get(state.from) : null);

  // ---------- Bonus strip ----------

  function renderBonuses() {
    const el = $('#bonuses');
    const cur = oneCard();
    const list = D.live
      .filter((p) => !cur || p.from === cur.id)
      .filter((p) => typeOK(D.partners.get(p.to)))
      .sort((a, b) => (a.end || a.assumedEnd || '9').localeCompare(b.end || b.assumedEnd || '9'));

    if (!list.length) {
      const scope = cur ? ` from ${esc(cur.name)}` : '';
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

  // Every card's route to a partner, best first (live bonus included). Just `cur` if given.
  function routesTo(p, cur) {
    return D.programs.currencies
      .filter((c) => !cur || c.id === cur.id)
      .map((c) => ({ c, t: D.routes.get(`${c.id}>${p.id}`), promo: D.promo.get(`${c.id}>${p.id}`) }))
      .filter((o) => o.t)
      .sort((a, b) => received(b.t, b.promo) - received(a.t, a.promo));
  }

  const listText = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

  function renderRoutes(animate) {
    const cur = oneCard();   // null for All cards: every partner, at its best route
    const title = cur ? cur.name : 'All cards';
    const all = D.programs.partners.filter((p) => routesTo(p, cur).length);
    const groups = groupedPartners((p) => {
      const opts = routesTo(p, cur);
      return opts.length && typeOK(p) && (!state.bonusOnly || opts.some((o) => o.promo));
    });
    const shown = groups.reduce((n, g) => n + g.items.length, 0);

    const view = $('#view');
    const countText = shown === all.length ? `${all.length} partners` : `${shown} of ${all.length} partners`;

    if (!shown) {
      const kind = state.type === 'all' ? '' : `${state.type} `;
      const why = state.bonusOnly
        ? `No ${kind}partners have a live bonus${cur ? ` from ${esc(cur.short)}` : ''} right now.`
        : `${cur ? esc(cur.short) : 'No card'} has no ${state.type} partners.`;
      view.innerHTML = `
        <div class="route-head"><h2>${esc(title)}</h2><span class="count">${countText}</span></div>
        <div class="empty-state">
          <p>${why}</p>
          <button class="chip" id="reset-filters">Show all partners</button>
        </div>`;
      $('#reset-filters').addEventListener('click', () => { state.type = 'all'; state.bonusOnly = false; render(); });
      return;
    }

    // All cards is a transit map: one line per card (the cards serving what's shown, in dropdown
    // order). `line` is the card lit from the chips; its rate shows on every row it serves.
    const lineCards = cur ? [] : D.programs.currencies.filter((c) => groups.some(({ items }) => items.some((p) => D.routes.has(`${c.id}>${p.id}`))));
    const line = lineCards.some((c) => c.id === state.line) ? state.line : null;
    const lineColor = (id) => `--c: var(--line-${id}, var(--route))`;
    const head = `<div class="route-head"><h2>${esc(title)}</h2>${cur ? '' : `
      <div class="layout-switch" role="group" aria-label="Map layout">
        <button type="button" data-layout="strip" aria-pressed="${!terminalLayout()}">Strip</button>
        <button type="button" data-layout="terminal" aria-pressed="${terminalLayout()}">Terminal</button>
      </div>`}<span class="count">${countText}</span></div>`;
    const chips = cur ? '' : `<div class="line-chips" role="group" aria-label="Follow one card's line">
        ${lineCards.map((c) => `<button class="line-chip" type="button" data-line="${c.id}" aria-pressed="${c.id === line}" style="${lineColor(c.id)}">${esc(c.short)}</button>`).join('')}
      </div>`;

    if (!cur && terminalLayout()) {
      renderTerminal({ view, head, chips, groups, lineCards, line, shown, animate });
      return;
    }

    view.innerHTML = `
      ${head}
      ${cur?.note ? `<p class="currency-note">${esc(cur.note)}</p>` : ''}
      ${chips}
      <div class="routes${cur ? '' : ' is-all'}${line ? ' has-line' : ''}">
        <svg class="rail" aria-hidden="true"></svg>
        <ol class="route-list">
          ${groups.map(({ group, items }) => `
            <li class="group-label" aria-hidden="true">${esc(group.label)}</li>
            ${items.map((p) => {
              const opts = routesTo(p, cur);
              const lit = line ? opts.find((o) => o.c.id === line) : null;
              const { c, t, promo } = lit || opts[0];
              const out = received(t, promo);
              if (cur) {
                const sub = stopSubline(t, promo, p);
                const label = `${p.name}, ${group.label}. 1,000 ${c.short} points become ${num.format(out)}${promo ? ` with a ${promo.bonus}% bonus ${endText(promo)}` : ''}.`;
                return `<li><button class="stop" data-partner="${p.id}" data-weight="${out}" data-bonus="${promo ? 1 : 0}" aria-label="${esc(label)}">
                  <span class="stop-name">${esc(p.name)}</span>
                  ${sub ? `<span class="stop-sub">${esc(sub)}</span>` : ''}
                  <span class="stop-rate">1,000 → <strong>${num.format(out)}</strong>${promo ? `<span class="badge">+${promo.bonus}%</span><span class="was">${num.format(received(t))}</span>` : ''}</span>
                </button></li>`;
              }
              const inLineOrder = lineCards.map((lc) => opts.find((o) => o.c.id === lc.id)).filter(Boolean);
              const names = listText(inLineOrder.map((o) => o.c.short));
              const label = `${p.name}, ${group.label}. ${lit ? '' : 'Best route: '}1,000 ${c.short} points become ${num.format(out)}${promo ? ` with a ${promo.bonus}% bonus ${endText(promo)}` : ''}. Lines: ${names}.${line && !lit ? ` Not on the ${D.currencies.get(line).short} line.` : ''}`;
              return `<li><button class="stop${line && !lit ? ' is-dim' : ''}" data-partner="${p.id}" data-bonus="${promo ? 1 : 0}"
                  data-lines="${opts.map((o) => o.c.id).join(' ')}" data-bonus-lines="${opts.filter((o) => o.promo).map((o) => o.c.id).join(' ')}" aria-label="${esc(label)}">
                <span class="stop-name">${esc(p.name)}</span>
                <span class="stop-lines">${inLineOrder.map((o) => `<span class="line-tag${o.promo ? ' is-bonus' : ''}${o.c.id === line ? ' is-lit' : ''}" style="${lineColor(o.c.id)}">${esc(o.c.short)}</span>`).join('')}</span>
                ${promo ? `<span class="stop-sub">${esc(c.short)} bonus ${endText(promo)}</span>` : ''}
                <span class="stop-rate">${lit || opts.length === 1 ? '' : 'Best '}1,000 → <strong>${num.format(out)}</strong>${promo ? `<span class="badge">+${promo.bonus}%</span><span class="was">${num.format(received(t))}</span>` : ''}</span>
              </button></li>`;
            }).join('')}
          `).join('')}
        </ol>
      </div>
      <div class="legend" aria-hidden="true">
        ${cur ? `<span class="legend-title">Line weight shows points received per 1,000 sent</span>
        <span><svg width="36" height="10"><line class="swatch-route" x1="2" y1="5" x2="34" y2="5" stroke-width="${weight(500)}" stroke-linecap="round"/></svg>500</span>
        <span><svg width="36" height="10"><line class="swatch-route" x1="2" y1="5" x2="34" y2="5" stroke-width="${weight(1000)}" stroke-linecap="round"/></svg>1,000</span>
        <span><svg width="36" height="10"><line class="swatch-route" x1="2" y1="5" x2="34" y2="5" stroke-width="${weight(2000)}" stroke-linecap="round"/></svg>2,000</span>
        <span><svg width="36" height="10"><line class="swatch-bonus" x1="2" y1="5" x2="34" y2="5" stroke-width="4" stroke-linecap="round"/></svg>Live bonus</span>`
        : `<span class="legend-title">Each card is a line, and a station means it transfers to that partner. Tap a card above to follow its line.</span>
        <span><svg width="14" height="14"><circle class="station-key" cx="7" cy="7" r="5"/></svg>Station</span>
        <span><svg width="14" height="14"><circle class="station-key is-bonus" cx="7" cy="7" r="5"/></svg>Live bonus from that card</span>`}
      </div>`;

    $$('.stop', view).forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.partner, cur?.id ?? line)));
    bindMapControls(view);
    drawRail(animate && !reduceMotion.matches);
  }

  // Line chips and the Strip / Circle switch, shared by both All cards layouts.
  function bindMapControls(view) {
    $$('.line-chip', view).forEach((b) => b.addEventListener('click', () => {
      state.line = state.line === b.dataset.line ? null : b.dataset.line;
      render();
      $(`.line-chip[data-line="${b.dataset.line}"]`)?.focus({ preventScroll: true });
    }));
    $$('.layout-switch button', view).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      state.layout = b.dataset.layout;
      render({ animate: true });
      $(`.layout-switch [data-layout="${b.dataset.layout}"]`)?.focus({ preventScroll: true });
    }));
  }

  function drawRail(animate) {
    if ($('.terminal-map')) { drawTerminal(animate); return; }
    const wrap = $('.routes');
    if (!wrap) return;
    const svg = d3.select(wrap).select('svg.rail');
    if (wrap.classList.contains('is-all')) { drawLines(wrap, svg, animate); return; }
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

  // All cards as a transit map, after fan-made maps: one bold line per card in dropdown order, each
  // running from its first station to its last; a white station with a dark ring on a line means that
  // card transfers to the partner on that row (yellow = that card's live bonus). Faint row guides
  // tie stations to their row. With a card lit from the chips, the other lines and stations fade.
  function drawLines(wrap, svg, animate) {
    const box = wrap.getBoundingClientRect();
    const W = svg.node().clientWidth;
    const words = (s) => (s || '').split(' ').filter(Boolean);
    const stops = $$('.stop', wrap).map((el) => {
      const b = el.getBoundingClientRect();
      return {
        id: el.dataset.partner, y: b.top - box.top + b.height / 2, bottom: b.bottom - box.top,
        lines: words(el.dataset.lines), bonusLines: words(el.dataset.bonusLines),
      };
    });
    if (!stops.length) return;
    const ids = D.programs.currencies.map((c) => c.id).filter((id) => stops.some((s) => s.lines.includes(id)));
    const lit = ids.includes(state.line) ? state.line : null;
    const pad = 8;
    const pitch = Math.min(16, (W - 2 * pad) / Math.max(ids.length - 1, 1));
    const lineW = pitch >= 13 ? 6 : 4.5;
    const r = Math.min(5, pitch / 2 - 1.3);
    const x = (id) => pad + ids.indexOf(id) * pitch;
    const color = (id) => `var(--line-${id}, var(--route))`;
    const off = (id) => (lit && id !== lit ? ' is-off' : '');
    const span = (id) => {
      const ys = stops.filter((s) => s.lines.includes(id)).map((s) => s.y);
      return [Math.min(...ys), Math.max(...ys)];
    };
    const lastY = stops[stops.length - 1].y;

    svg.selectAll('*').remove();

    svg.append('g').selectAll('line').data(stops, (d) => d.id).join('line')
      .attr('class', 'row-guide').attr('x1', 0).attr('x2', W)
      .attr('y1', (d) => d.bottom - 0.5).attr('y2', (d) => d.bottom - 0.5);

    // The lit line is drawn last so it sits on top of its neighbours.
    const lines = svg.append('g').selectAll('path').data([...ids].sort((a, b) => (a === lit) - (b === lit))).join('path')
      .attr('class', (id) => `line${off(id)}${id === lit ? ' is-lit' : ''}`)
      .style('stroke', color)
      .attr('stroke-width', (id) => (id === lit ? lineW + 2 : lineW))
      .attr('d', (id) => { const [a, b] = span(id); return `M${x(id)},${a} V${b}`; });

    const stations = svg.append('g').selectAll('circle')
      .data(stops.flatMap((s) => s.lines.map((id) => ({ key: `${s.id}>${id}`, id, y: s.y, bonus: s.bonusLines.includes(id) }))), (d) => d.key)
      .join('circle')
      .attr('class', (d) => `station${d.bonus ? ' is-bonus' : ''}${off(d.id)}`)
      .attr('cx', (d) => x(d.id)).attr('cy', (d) => d.y)
      .attr('r', (d) => (d.id === lit ? r + 1 : r));

    if (!animate) return;

    // One orchestrated moment: each line draws down from its first station, stations appear in order.
    lines.each(function () {
      const len = this.getTotalLength();
      d3.select(this).attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
        .transition().duration(560).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    });
    stations.attr('opacity', 0).transition().delay((d) => 160 + (d.y / Math.max(lastY, 1)) * 420).duration(200).attr('opacity', null);
  }

  // ---------- Terminal map ----------

  // All cards as an airport terminal map: a long terminal building with a concourse per alliance
  // (A Star Alliance, B oneworld, C SkyTeam above it; D other airlines, E hotels below). Partners are
  // gates along their concourse, numbered from the terminal out. Each card is a colored walkway lane
  // down the concourses it serves, out to its last gate there, with a station at each gate it serves
  // (yellow = that card's live bonus). The terminal is a departures board for the gate under the
  // pointer or keyboard focus; a gate opens the detail sheet.
  let terminalPiers = [];
  let gateCodes = null;
  const canHover = window.matchMedia('(hover: hover)');

  // Stable gate codes: concourse letter by alliance group, number by name among every partner in it,
  // so filters never renumber a gate.
  function gateCode(id) {
    if (!gateCodes) {
      gateCodes = new Map();
      D.groups.forEach((g, i) => {
        D.programs.partners.filter((p) => p.group === g.id).sort((a, b) => a.name.localeCompare(b.name))
          .forEach((p, j) => gateCodes.set(p.id, `${String.fromCharCode(65 + i)}${j + 1}`));
      });
    }
    return gateCodes.get(id);
  }

  function renderTerminal({ view, head, chips, groups, line, shown, animate }) {
    terminalPiers = groups.map(({ group, items }) => ({
      group,
      letter: String.fromCharCode(65 + D.groups.indexOf(group)),
      gates: items.map((p) => {
        const opts = routesTo(p, null);
        const lit = line ? opts.find((o) => o.c.id === line) : null;
        return { p, group, code: gateCode(p.id), opts, lit, best: lit || opts[0] };
      }),
    }));
    view.innerHTML = `
      ${head}
      ${chips}
      <div class="terminal-map">
        <svg class="terminal" role="group" aria-label="${shown} transfer partners as gates on an airport terminal map. Tab through the gates and press Enter to open one."></svg>
        <div class="terminal-board" aria-live="polite"></div>
      </div>
      <div class="legend" aria-hidden="true">
        <span class="legend-title">Each concourse is an alliance and each gate a partner. Colored lanes are the cards, and a station means that card transfers to the gate's partner. ${canHover.matches ? 'Hover a gate for details and click to open it' : 'Tap a gate to open it'}; tap a card above to follow its lanes.</span>
        <span><svg width="14" height="14"><circle class="station-key" cx="7" cy="7" r="5"/></svg>Station</span>
        <span><svg width="14" height="14"><circle class="station-key is-bonus" cx="7" cy="7" r="5"/></svg>Live bonus from that card</span>
      </div>`;
    bindMapControls(view);
    drawTerminal(animate && !reduceMotion.matches, true);
  }

  // The departures board in the terminal: the gate in focus, or a summary.
  function boardHTML(gate) {
    const gates = terminalPiers.flatMap((pr) => pr.gates);
    const lit = D.currencies.get(state.line);
    if (!gate) {
      if (lit && gates.some((g) => g.lit)) return `<strong>${esc(lit.name)}</strong><span>${gates.filter((g) => g.lit).length} of ${gates.length} gates</span>`;
      return `<strong>All cards terminal</strong><span>${gates.length} gate${gates.length === 1 ? '' : 's'} in ${terminalPiers.length} concourse${terminalPiers.length === 1 ? '' : 's'}</span><span class="hub-hint">${canHover.matches ? 'Hover a gate to see it here' : 'Tap a gate for details'}</span>`;
    }
    const { p, opts, best } = gate;
    const { c, t, promo } = best;
    return `<span class="board-gate">Gate ${gate.code}</span><strong>${esc(p.name)}</strong>
      <span>${gate.lit || opts.length === 1 ? esc(c.short) : 'Best'} 1,000 → <b>${num.format(received(t, promo))}</b>${promo ? ` <span class="badge">+${promo.bonus}%</span> ${esc(c.short)} ${endText(promo)}` : ''}</span>
      <span class="hub-hint">${lit && !gate.lit ? `Not on the ${esc(lit.short)} line` : `Cards: ${esc(listText(opts.map((o) => o.c.short)))}`}</span>`;
  }

  function drawTerminal(animate, fresh = false) {
    const wrap = $('.terminal-map');
    if (!wrap) return;
    const svg = d3.select(wrap).select('svg.terminal');
    const board = $('.terminal-board', wrap);
    const piers = terminalPiers.filter((pr) => pr.gates.length);
    if (!piers.length) return;
    const all = piers.flatMap((pr) => pr.gates);
    const lit = all.some((g) => g.opts.some((o) => o.c.id === state.line)) ? state.line : null;

    // Airline alliances above the terminal, the rest below; three columns wide either way.
    const W = Math.max(760, wrap.clientWidth);
    const nTop = Math.ceil((piers.length * 3) / 5);
    const top = piers.slice(0, nTop);
    const bottom = piers.slice(nTop);
    const cols = Math.max(top.length, bottom.length, 3);
    const colW = W / cols;
    const PITCH = 7;
    const LANE = 4;
    const PAD = 7;
    const GAP = 34;
    const TIP = 54;          // room past the last gate for the concourse badge
    const TERM_H = 104;
    const pierLen = (pr) => pr.gates.length * GAP + 12;
    const topH = top.length ? d3.max(top, pierLen) + TIP : 0;
    const botH = bottom.length ? d3.max(bottom, pierLen) + TIP : 0;
    const termY = topH + 6;
    const H = termY + TERM_H + botH + 6;
    svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    svg.selectAll('*').remove();

    // Lay out each concourse: column, lanes (only the cards that board there), gate positions.
    const layoutRow = (row, up) => {
      const start = (W - row.length * colW) / 2;
      row.forEach((pr, i) => {
        pr.up = up;
        pr.ids = D.programs.currencies.map((c) => c.id).filter((id) => pr.gates.some((g) => g.opts.some((o) => o.c.id === id)));
        pr.x0 = start + i * colW + 12;
        pr.w = PAD * 2 + (pr.ids.length - 1) * PITCH + LANE;
        pr.edge = up ? termY : termY + TERM_H;                          // where the concourse meets the terminal
        pr.sign = up ? -1 : 1;
        pr.tip = pr.edge + pr.sign * pierLen(pr);
        pr.labelX = pr.x0 + pr.w + 12;
        pr.labelW = colW - pr.w - 12 - 46 - 14;                          // room for a name after the gate code
        pr.gates.forEach((g, j) => { g.pier = pr; g.y = pr.edge + pr.sign * (14 + (j + 0.5) * GAP); });
      });
    };
    layoutRow(top, true);
    layoutRow(bottom, false);
    const laneX = (pr, id) => pr.x0 + PAD + LANE / 2 + pr.ids.indexOf(id) * PITCH;
    const color = (id) => `var(--line-${id}, var(--route))`;
    const dim = (g) => (lit && !g.lit ? ' is-dim' : '');

    // Buildings: concourses first so the terminal overlaps their roots.
    svg.append('g').selectAll('rect').data(piers).join('rect').attr('class', 'pier')
      .attr('x', (pr) => pr.x0).attr('width', (pr) => pr.w)
      .attr('y', (pr) => Math.min(pr.edge, pr.tip) - (pr.up ? 0 : 8)).attr('height', (pr) => Math.abs(pr.tip - pr.edge) + 8)
      .attr('rx', (pr) => pr.w / 2);
    svg.append('rect').attr('class', 'term').attr('x', 4).attr('y', termY).attr('width', W - 8).attr('height', TERM_H).attr('rx', TERM_H / 2);

    // Concourse badges at the tips.
    const badge = svg.append('g').selectAll('g').data(piers).join('g').attr('class', 'concourse')
      .attr('transform', (pr) => `translate(${pr.x0 + pr.w / 2},${pr.tip + pr.sign * 22})`);
    badge.append('circle').attr('r', 15);
    badge.append('text').attr('class', 'concourse-letter').attr('dy', '0.35em').attr('text-anchor', 'middle').text((pr) => pr.letter);
    badge.append('text').attr('class', 'concourse-name').attr('x', 22).attr('dy', '0.35em').text((pr) => pr.group.label);

    // Walkway lanes: from the terminal out to the card's last gate on that concourse.
    const lanes = piers.flatMap((pr) => pr.ids.map((id) => {
      const far = pr.gates.filter((g) => g.opts.some((o) => o.c.id === id)).at(-1);
      return { key: `${pr.letter}>${id}`, pr, id, y1: far.y };
    }));
    const laneSel = svg.append('g').selectAll('path').data([...lanes].sort((a, b) => (a.id === lit) - (b.id === lit)), (d) => d.key).join('path')
      .attr('class', (d) => `lane${lit && d.id !== lit ? ' is-off' : ''}`)
      .style('stroke', (d) => color(d.id)).attr('stroke-width', (d) => (d.id === lit ? LANE + 1.5 : LANE))
      .attr('d', (d) => `M${laneX(d.pr, d.id)},${d.pr.edge} V${d.y1}`);

    // Gates: stub, gate code, name (wrapped to two lines when long), stations on serving lanes.
    const gateSel = svg.append('g').selectAll('g').data(all, (g) => g.p.id).join('g')
      .attr('class', (g) => `gate${dim(g)}`).attr('data-p', (g) => g.p.id)
      .attr('transform', (g) => `translate(0,${g.y})`);
    gateSel.append('line').attr('class', 'jetway').attr('x1', (g) => g.pier.x0 + g.pier.w).attr('x2', (g) => g.pier.labelX);
    gateSel.append('rect').attr('class', (g) => `gate-code${g.opts.some((o) => o.promo) ? ' is-bonus' : ''}`)
      .attr('x', (g) => g.pier.labelX).attr('y', -9).attr('width', 38).attr('height', 18).attr('rx', 4);
    gateSel.append('text').attr('class', (g) => `gate-code-text${g.opts.some((o) => o.promo) ? ' is-bonus' : ''}`).attr('x', (g) => g.pier.labelX + 19).attr('dy', '0.35em').attr('text-anchor', 'middle').text((g) => g.code);
    const names = gateSel.append('text').attr('class', 'gate-name').attr('x', (g) => g.pier.labelX + 46).attr('dy', '0.35em').text((g) => g.p.name);
    names.each(function (g) {
      if (this.getComputedTextLength() <= g.pier.labelW) return;
      const words = g.p.name.split(' ');
      let cut = words.length - 1;
      const t = d3.select(this).text(null);
      while (cut > 1) {
        t.text(words.slice(0, cut).join(' '));
        if (this.getComputedTextLength() <= g.pier.labelW) break;
        cut -= 1;
      }
      t.text(null);
      t.append('tspan').attr('x', g.pier.labelX + 46).attr('dy', '-0.25em').text(words.slice(0, cut).join(' '));
      t.append('tspan').attr('x', g.pier.labelX + 46).attr('dy', '1.15em').text(words.slice(cut).join(' '));
    });
    const stations = svg.append('g').selectAll('circle')
      .data(all.flatMap((g) => g.opts.map((o) => ({ key: `${g.p.id}>${o.c.id}`, g, id: o.c.id, bonus: !!o.promo }))), (d) => d.key)
      .join('circle')
      .attr('class', (d) => `station${d.bonus ? ' is-bonus' : ''}${lit && d.id !== lit ? ' is-off' : ''}`).attr('data-p', (d) => d.g.p.id)
      .attr('cx', (d) => laneX(d.g.pier, d.id)).attr('cy', (d) => d.g.y).attr('r', (d) => (d.id === lit ? 4.4 : 3.6));

    // Hit areas: the whole gate row, focusable like a button.
    const showBoard = (g) => {
      svg.selectAll('.is-hover').classed('is-hover', false);
      if (g) svg.selectAll(`[data-p="${g.p.id}"]`).classed('is-hover', true);
      board.innerHTML = boardHTML(g);
    };
    svg.append('g').selectAll('rect').data(all, (g) => g.p.id).join('rect').attr('class', 'hit')
      .attr('x', (g) => g.pier.x0 - 4).attr('width', (g) => g.pier.labelX + 46 + g.pier.labelW - g.pier.x0 + 8)
      .attr('y', (g) => g.y - GAP / 2).attr('height', GAP)
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (g) => {
        const { c, t, promo } = g.best;
        return `Gate ${g.code}, ${g.p.name}, ${g.group.label}. ${g.lit ? '' : 'Best route: '}1,000 ${c.short} points become ${num.format(received(t, promo))}${promo ? ` with a ${promo.bonus}% bonus ${endText(promo)}` : ''}. Lines: ${listText(g.opts.map((o) => o.c.short))}.`;
      })
      .on('pointerenter focus', (e, g) => showBoard(g))
      .on('pointerleave blur', () => showBoard(null))
      .on('click', (e, g) => openSheet(g.p.id, lit))
      .on('keydown', (e, g) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(g.p.id, lit); } });

    // The departures board sits inside the terminal building.
    const svgLeft = svg.node().getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
    Object.assign(board.style, { left: `${svgLeft + TERM_H / 2}px`, top: `${termY}px`, width: `${W - TERM_H}px`, height: `${TERM_H}px` });
    board.innerHTML = boardHTML(null);
    if (fresh && W > wrap.clientWidth) wrap.scrollLeft = (W - wrap.clientWidth) / 2;

    if (!animate) return;
    // One orchestrated moment: walkways run out from the terminal, stations appear gate by gate.
    laneSel.each(function () {
      const len = this.getTotalLength();
      d3.select(this).attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
        .transition().duration(520).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    });
    stations.attr('opacity', 0).transition().delay((d) => 140 + Math.abs(d.g.y - d.g.pier.edge) * 0.9).duration(200).attr('opacity', null);
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
    if (min == null) return 'Minimum not published';
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
      openSheet(id, oneCard()?.id ?? null);
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

  // Point "Report a mistake" at the repo's issues: taken from user.github.io/repo/ on
  // GitHub Pages, or looked up for custom domains (which have no repo in the URL).
  const CUSTOM_DOMAINS = { 'milesmaximizer.com': 'rg-code/point-xfer' };
  function setupReportLink() {
    const link = $('#report-link');
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    const slug = m && repo ? `${m[1]}/${repo}` : CUSTOM_DOMAINS[location.hostname];
    if (!link || !slug) return;
    link.href = `https://github.com/${slug}/issues/new?labels=data-fix`;
    link.hidden = false;
  }

  function renderStatus() {
    // updatedAt only moves when the list changes, not on every tracker run, so say "changed".
    const up = D.promotions.updatedAt;
    $('#status').textContent = up
      ? `Bonus list last changed ${shortDate.format(new Date(up))}`
      : 'Bonus list not yet built';
    $('#verified').textContent = `Transfer ratios last verified ${longDate.format(new Date(`${D.transfers.verifiedOn}T00:00:00Z`))}.`;
    document.querySelectorAll('.site-foot .year').forEach((y) => { y.textContent = new Date().getFullYear(); });
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
    if (state.partner) openSheet(state.partner, oneCard()?.id ?? null);

    // With no layout chosen, All cards is the circle on wide screens and the strip on phones.
    wide.addEventListener('change', () => { if (!state.layout && state.view === 'routes' && state.from === ALL) render(); });

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
