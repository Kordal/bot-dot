// Settings → Usage (#301; docs/api.md, Token usage): the tokens Claude Code reported for this account, for today, the
// last 7 or 30 days or days the owner picks, in total, per bot (the Chief of Staff is one) and per day as bars. No
// cost is shown (AGENTS.md rule 5). Only from a server whose features have `token-usage`; settings.js draws the card,
// this file fills it.

const Usage = (() => {
  const PRESETS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['custom', 'Custom']];
  let cur = null; // { box, preset, from, to, today, keepDays, data, error }

  // Day arithmetic on YYYY-MM-DD, by the calendar alone.
  const toUtc = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const addDays = (d, n) => new Date(toUtc(d) + n * 86400000).toISOString().slice(0, 10);
  // The days a preset covers, ending today (the account's today, as the server said it).
  function rangeOf(preset, today) {
    if (preset === '7') return { from: addDays(today, -6), to: today };
    if (preset === '30') return { from: addDays(today, -29), to: today };
    return { from: today, to: today };
  }

  // 1234 → "1,234"; a million and more → "1.2M"; 10,000 and more → "12.3k".
  function tokens(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
    return n.toLocaleString('en');
  }
  const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function pickerHTML(c) {
    const custom = c.preset === 'custom';
    const min = c.today ? addDays(c.today, -((c.keepDays || 400) - 1)) : '';
    return `
      <div class="usage-picker" role="group" aria-label="Timeframe">
        ${PRESETS.map(([id, label]) => `<button type="button" class="btn sm${c.preset === id ? ' primary' : ''}" data-usage-preset="${id}" aria-pressed="${c.preset === id}">${label}</button>`).join('')}
      </div>
      ${custom ? `<div class="usage-custom">
        <label class="field">From<input type="date" data-usage-day="from" value="${esc(c.from || '')}" min="${min}" max="${esc(c.today || '')}"></label>
        <label class="field">To<input type="date" data-usage-day="to" value="${esc(c.to || '')}" min="${min}" max="${esc(c.today || '')}"></label>
      </div>` : ''}`;
  }

  function totalsHTML(t) {
    const cell = (label, value) => `<div class="usage-stat"><div class="faint">${label}</div><b>${esc(value)}</b></div>`;
    return `<div class="usage-totals">
      ${cell('Input tokens', tokens(t.inputTokens))}
      ${cell('Output tokens', tokens(t.outputTokens))}
      ${cell('Cache read', tokens(t.cacheReadTokens))}
      ${cell('Cache write', tokens(t.cacheWriteTokens))}
      ${cell('All tokens', tokens(t.totalTokens))}
    </div>`;
  }

  // One bar per day, its height the day's tokens against the busiest day of the range.
  function chartHTML(days) {
    const top = Math.max(0, ...days.map((d) => d.totalTokens));
    const bars = days.map((d) => {
      const h = top ? Math.max(d.totalTokens ? 3 : 0, Math.round((d.totalTokens / top) * 100)) : 0;
      const tip = `${dayLabel(d.day)}: ${tokens(d.totalTokens)} tokens`;
      return `<div class="usage-bar" title="${esc(tip)}" aria-label="${esc(tip)}"><i style="height:${h}%"></i></div>`;
    }).join('');
    const ends = days.length > 1 ? `<div class="usage-axis faint"><span>${esc(dayLabel(days[0].day))}</span><span>${esc(dayLabel(days[days.length - 1].day))}</span></div>` : '';
    return `<div class="usage-chart" role="img" aria-label="Tokens per day">${bars}</div>${ends}`;
  }

  function botsHTML(bots) {
    if (!bots.length) return '<p class="muted settings-hint" style="margin:0">No tokens used in this timeframe.</p>';
    const top = Math.max(...bots.map((b) => b.totalTokens), 1);
    return `<div class="usage-bots">${bots.map((b) => `
      <div class="usage-bot">
        <div class="usage-bot-head"><span class="grow">${esc(b.name)}${b.gone ? ' <span class="faint">(deleted)</span>' : ''}</span><span class="muted">${tokens(b.totalTokens)}</span></div>
        <div class="usage-bot-bar"><i style="width:${Math.round((b.totalTokens / top) * 100)}%"></i></div>
      </div>`).join('')}</div>`;
  }

  function draw() {
    const c = cur;
    if (!c) return;
    const d = c.data;
    c.box.innerHTML = `
      <summary><h3 class="page-sub">Usage</h3></summary>
      <p class="muted settings-hint">Tokens as Claude Code reports them, for your bots and the Chief of Staff, counted from this update on.</p>
      ${pickerHTML(c)}
      ${c.error ? `<div class="req-note">${esc(c.error)}</div>` : !d ? '<p class="muted settings-hint" style="margin:0">Loading…</p>' : `
        ${totalsHTML(d.totals)}
        ${d.days.length > 1 ? chartHTML(d.days) : ''}
        <h4 class="usage-sub">By bot</h4>
        ${botsHTML(d.bots)}`}`;
    c.box.querySelectorAll('[data-usage-preset]').forEach((b) => (b.onclick = () => pick(b.dataset.usagePreset)));
    c.box.querySelectorAll('[data-usage-day]').forEach((i) => (i.onchange = () => setDay(i.dataset.usageDay, i.value)));
  }

  async function load() {
    const c = cur;
    const q = c.from && c.to ? `?from=${encodeURIComponent(c.from)}&to=${encodeURIComponent(c.to)}` : '';
    try {
      const d = await api(`/usage${q}`);
      if (cur !== c) return;
      c.today = d.today;
      c.keepDays = d.keepDays;
      c.from = d.from;
      c.to = d.to;
      c.data = d;
      c.error = null;
    } catch (err) {
      if (cur !== c) return;
      c.error = err.message;
    }
    draw();
  }

  function pick(preset) {
    const c = cur;
    c.preset = preset;
    if (preset !== 'custom' && c.today) Object.assign(c, rangeOf(preset, c.today));
    draw();
    if (preset !== 'custom') return load();
  }
  function setDay(which, value) {
    const c = cur;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    c[which] = value;
    if (c.from > c.to) { if (which === 'from') c.to = c.from; else c.from = c.to; }
    return load();
  }

  // The card in Settings: 7 days at first. The first answer says the account's today; the range follows from it.
  async function open(box) {
    const c = { box, preset: '7', from: null, to: null, today: null, keepDays: 400, data: null, error: null };
    cur = c;
    draw();
    try {
      const d = await api('/usage');
      if (cur !== c) return;
      c.today = d.today;
      c.keepDays = d.keepDays || c.keepDays;
      Object.assign(c, rangeOf('7', d.today));
    } catch (err) {
      if (cur !== c) return;
      c.error = err.message;
      return draw();
    }
    await load();
  }

  return { open, rangeOf, tokens, addDays, chartHTML, botsHTML, totalsHTML, pick, setDay };
})();
