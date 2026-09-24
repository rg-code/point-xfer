// Go / wait advice for one transfer route, from its bonus history.
// Plain script (no imports or exports) so the browser and node tests share it: it sets globalThis.transferAdvice.
(() => {
  'use strict';

  const DAY = 864e5;
  const HORIZON = 90;       // days we'd reasonably hold points waiting for a bonus
  const WAIT_THRESHOLD = 10; // expected extra % from waiting that makes waiting worthwhile
  const WAIT_MIN_CHANCE = 0.4; // and a bonus has to be reasonably likely, not a long shot at a huge one
  const MIN_GAPS = 3;       // fewer comparable gaps than this and we fall back to the average rate
  const PRIOR_WEIGHT = 2;   // pseudo-gaps of the average-rate estimate mixed into the gap estimate

  const toDay = (iso) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  /** Past bonus periods for one route as { start, end, bonus } day numbers, oldest first. Targeted offers don't count. */
  function periods(history, since, day) {
    return history
      .filter((h) => !h.targeted)
      .map((h) => {
        const s = h.start || h.firstSeen || h.end;
        const e = h.end || h.assumedEnd || s;
        return s ? { start: toDay(s), end: toDay(e), bonus: h.bonus } : null;
      })
      .filter((p) => p && p.start >= since && p.start < day)
      .sort((a, b) => a.start - b.start);
  }

  /**
   * Probability that a new bonus starts within `horizon` days, given `quiet` days since the last one ended.
   * Uses the gaps between past bonuses when there are enough of them (so a bonus that just ended counts
   * against another one soon), smoothed toward the route's average rate so a handful of gaps can't say 0% or 100%.
   */
  function chanceOfBonus(ps, since, day, horizon = HORIZON) {
    if (!ps.length) return 0;
    const rate = ps.length / Math.max(day - since, 365);
    const prior = 1 - Math.exp(-rate * horizon);
    const quiet = Math.max(0, day - ps[ps.length - 1].end);
    const gaps = ps.slice(1).map((p, i) => p.start - ps[i].end);
    const longer = gaps.filter((g) => g >= quiet);
    if (longer.length < MIN_GAPS) return prior;
    const hits = longer.filter((g) => g <= quiet + horizon).length;
    return (hits + PRIOR_WEIGHT * prior) / (longer.length + PRIOR_WEIGHT);
  }

  const pct = (x) => `${Math.round(x * 100)}%`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sinceText = (iso) => (iso.slice(5) === '01-01' ? iso.slice(0, 4) : `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`);
  function every(days) {
    const months = Math.round(days / 30.4);
    if (months <= 1) return 'about monthly';
    if (months >= 18) return `about every ${Math.round(months / 12)} years`;
    return `about every ${months} months`;
  }

  /**
   * history: past bonuses for this route ({ bonus, start, end, firstSeen }), newest or oldest first
   * live:    the bonus running today, or null
   * since:   ISO date the history starts covering (the later of the archive start and the route's launch)
   * day:     today (ISO)
   * Returns { verdict: 'go' | 'wait', reason, record (one-line history summary), stats }.
   */
  function advise({ history = [], live = null, since, day, horizon = HORIZON }) {
    const today = toDay(day);
    const from = toDay(since);
    const ps = periods(history, from, today);
    const n = ps.length;
    const sizes = ps.map((p) => p.bonus);
    const typical = n ? Math.round(median(sizes)) : null;
    const best = n ? Math.max(...sizes) : null;
    const gaps = ps.slice(1).map((p, i) => p.start - ps[i].start);
    const cadence = median(gaps) ?? (n ? (today - from) / n : null);
    const chance = chanceOfBonus(ps, from, today, horizon);
    const waitValue = n ? chance * typical : 0; // expected extra % from holding off
    const when = sinceText(since);
    const stats = { count: n, typical, best, cadenceDays: cadence, chance, waitValue, lastEnd: n ? ps[n - 1].end : null };
    const record = n ? `${n} past bonus${n > 1 ? 'es' : ''} since ${when}, typically +${typical}%${best > typical ? ` (best +${best}%)` : ''}${n > 1 ? `, ${every(cadence)}` : ''}.` : `No past bonuses since ${when}.`;

    if (live) {
      const b = live.bonus;
      if (!n && today - from <= 60) return { verdict: 'go', reason: `+${b}% launch bonus on a new route. Nothing to wait for.`, stats, record };
      if (!n) return { verdict: 'go', reason: `Rare chance: +${b}% is the first bonus on record for this route since ${when}.`, stats, record };
      if (b >= waitValue || b >= typical) {
        let how = 'beats what waiting is likely to earn';
        if (b > best) how = 'is the best on record';
        else if (b === best) how = 'matches the best on record';
        else if (b >= typical) how = `is at or above the usual +${typical}%`;
        return { verdict: 'go', reason: `+${b}% ${how}.`, stats, record };
      }
      return { verdict: 'wait', reason: `+${b}% is below the usual +${typical}%, and a ${pct(chance)} chance of another bonus in ${horizon} days makes waiting worth about +${Math.round(waitValue)}%.`, stats, record };
    }

    if (!n) return { verdict: 'go', reason: 'No bonus history here, so waiting is unlikely to pay off.', stats, record };
    if (waitValue >= WAIT_THRESHOLD && chance >= WAIT_MIN_CHANCE) {
      return { verdict: 'wait', reason: `${pct(chance)} chance of a bonus in the next ${horizon} days, worth about +${Math.round(waitValue)}% on average.`, stats, record };
    }
    return { verdict: 'go', reason: `Only a ${pct(chance)} chance of a bonus in the next ${horizon} days, so transfer when you have a use.`, stats, record };
  }

  globalThis.transferAdvice = { advise, chanceOfBonus, HORIZON, WAIT_THRESHOLD, WAIT_MIN_CHANCE };
})();
