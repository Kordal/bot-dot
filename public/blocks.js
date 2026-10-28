// ---------- the block kit ----------

// The blocks the Board's tiles are drawn with (lib/tile-blocks.js fills them in; this only draws them): a kpi
// (a number with its change, a sparkline and a bar), a chart (line, area, bar, stacked, horizontal bars, with
// gridlines, a legend and a tooltip on hover or tap), status pills and a callout. One chart code for every surface.
// c: the colour the block is drawn in (its own, else its tile's), as CSS.

const KIT_SERIES = ['var(--mention)', 'var(--ok)', 'var(--warn)', '#8b7cf6']; // a series without a colour of its own, after the first
const KIT_LEVELS = ['ok', 'warn', 'err', 'info', 'plan'];
const kitLevel = (l) => (KIT_LEVELS.includes(l) ? l : 'info');

// A time as the owner's clock shows it: "08:00".
const kitClock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const kitNum = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '');

// A number's change: "▲ 0.8 since 08:00", green when it is good news, red when bad, grey when neither.
function kitDelta(b) {
  if (!b.delta) return '';
  const d = b.delta;
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '–';
  const tone = d.good === true ? 'good' : d.good === false ? 'bad' : 'flat';
  return `<span class="kit-delta ${tone}">${arrow} ${b.since ? tr('{change} since {time}', { change: esc(d.text), time: kitClock(Date.parse(b.since)) }) : esc(d.text)}</span>`;
}

// A sparkline: the line, and the area under it fading out.
function kitSpark(points, c) {
  const pts = (points || []).filter(Number.isFinite);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 28 - ((v - lo) / span) * 26]);
  const line = xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return `<svg class="kit-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" style="--c:${c}">
    <polygon points="0,30 ${line} 100,30"/><polyline points="${line}" vector-effect="non-scaling-stroke"/></svg>`;
}

// A kpi: the number big with its unit and "of N", the line under it (its change, or what `sub` says), a
// sparkline beside it and a bar under it. A value block with recent values is drawn the same.
// tint: a colour name as CSS, for words.
function kitKpi(b, c, tint = (x) => x) {
  const sub = b.sub ? `<span class="kit-sub" ${b.subColor ? `style="color:${tint(b.subColor)}"` : ''}>${esc(b.sub)}</span>` : '';
  return `<div class="kit-kpi ${b.points?.length >= 2 ? 'has-spark' : ''}">
    <div class="kit-kpi-main">
      ${b.label ? `<div class="kit-label">${esc(b.label)}</div>` : ''}
      <div class="kit-num"${b.type === 'value' && b.color ? ` style="color:${tint(b.color)}"` : ''}>${b.text ? esc(b.text) : '<span class="faint">·</span>'}${b.unit ? `<small>${esc(b.unit)}</small>` : ''}${b.of ? `<small class="of">${tr('of {total}', { total: esc(b.of) })}</small>` : ''}</div>
      ${kitDelta(b)}${sub}
    </div>
    ${kitSpark(b.points, c)}
    ${b.ratio != null ? `<div class="kit-bar"><i style="width:${Math.round(b.ratio * 100)}%;--c:${c}"></i></div>` : ''}
  </div>`;
}

const kitStatus = (b) => `<span class="kit-pill ${kitLevel(b.level)}">${esc(b.text)}</span>`;
const kitCallout = (b) => `<div class="kit-callout ${kitLevel(b.level)}">${b.title ? `<b>${esc(b.title)}</b>` : ''}<div class="md">${md(b.text)}</div></div>`;

// A chart's series as it draws them: [{ label, color, points }], from `series` or (from an older server, or
// one line) from `points` and `color`.
function kitSeries(b, c, tint) {
  const list = b.series?.length ? b.series : [{ points: b.points || [], color: b.color }];
  return list.map((s, i) => ({ label: s.label || '', color: s.color ? tint(s.color) : i === 0 ? c : KIT_SERIES[(i - 1) % KIT_SERIES.length], points: s.points || [] }));
}

// A chart. where: "face" (on a tile: no axis labels on a small one) or "panel". tint: a colour name as CSS.
function kitChart(b, c, tint = (x) => x, { axes = true } = {}) {
  const head = b.text ? `<span class="kit-chart-title">${esc(b.text)}</span>` : '';
  if (b.style === 'hbar') {
    const bars = b.bars || [];
    if (!bars.length) return `<div class="kit-chart">${head}<div class="faint">·</div></div>`;
    return `<div class="kit-chart">${head}<div class="kit-hbars">${bars.map((x) => `<div class="kit-hbar"><span class="l">${esc(x.label)}</span><span class="track"><i style="width:${Math.round(x.ratio * 100)}%;--c:${c}"></i></span><span class="n">${esc(x.text)}</span></div>`).join('')}</div></div>`;
  }
  const series = kitSeries(b, c, tint);
  const n = Math.max(...series.map((s) => s.points.length), 0);
  if (n < 2 && !(n === 1 && ['bar', 'stacked'].includes(b.style))) return `<div class="kit-chart">${head}<div class="faint">·</div></div>`;
  const bars = b.style === 'bar' || b.style === 'stacked';
  const vals = series.flatMap((s) => s.points).filter(Number.isFinite);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (b.style === 'stacked') { hi = Math.max(...Array.from({ length: n }, (_, i) => series.reduce((sum, s) => sum + (Number.isFinite(s.points[i]) ? s.points[i] : 0), 0))); lo = 0; }
  if (bars) lo = Math.min(lo, 0);
  if (hi === lo) { hi += 1; lo -= bars ? 0 : 1; }
  const H = 60;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  let marks = '';
  if (bars) {
    const w = 100 / n;
    const gap = Math.min(w * 0.25, 2);
    for (let i = 0; i < n; i++) {
      let base = 0;
      series.forEach((s, k) => {
        const v = s.points[i];
        if (!Number.isFinite(v)) return;
        if (b.style === 'stacked') { marks += `<rect x="${(i * w + gap / 2).toFixed(2)}" y="${y(base + v).toFixed(2)}" width="${(w - gap).toFixed(2)}" height="${(y(base) - y(base + v)).toFixed(2)}" style="fill:${s.color}"/>`; base += v; return; }
        const bw = (w - gap) / series.length;
        marks += `<rect x="${(i * w + gap / 2 + k * bw).toFixed(2)}" y="${y(Math.max(v, 0)).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.abs(y(v) - y(0)).toFixed(2)}" style="fill:${s.color}"/>`;
      });
    }
  } else {
    for (const s of series) {
      const pts = s.points.map((v, i) => (Number.isFinite(v) ? [(i / (n - 1)) * 100, y(v)] : null));
      const runs = [];
      let run = [];
      for (const p of pts) { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } }
      if (run.length) runs.push(run);
      for (const r of runs) {
        const line = r.map(([x, yy]) => `${x.toFixed(2)},${yy.toFixed(2)}`).join(' ');
        if (b.style === 'area' || series.length === 1) marks += `<polygon class="fill" points="${r[0][0].toFixed(2)},${H} ${line} ${r[r.length - 1][0].toFixed(2)},${H}" style="fill:${s.color}"/>`;
        marks += `<polyline points="${line}" style="stroke:${s.color}" vector-effect="non-scaling-stroke"/>`;
      }
    }
  }
  const grid = [0, 0.5, 1].map((f) => `<line x1="0" x2="100" y1="${(f * H).toFixed(2)}" y2="${(f * H).toFixed(2)}" vector-effect="non-scaling-stroke"/>`).join('');
  const legend = series.length > 1 || series[0].label ? `<span class="kit-legend">${series.map((s) => (s.label ? `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>` : '')).join('')}</span>` : '';
  const unit = b.unit ? ` ${b.unit}` : '';
  const yAxis = axes ? `<span class="kit-y top">${esc(kitNum(hi) + unit)}</span><span class="kit-y bottom">${esc(kitNum(lo) + unit)}</span>` : '';
  const xs = b.labels?.length ? [b.labels[0], b.labels[b.labels.length - 1]] : b.times?.length ? [kitClock(b.times[0]), kitClock(b.times[b.times.length - 1])] : null;
  const xAxis = axes && xs ? `<div class="kit-x"><span>${esc(xs[0])}</span><span>${esc(xs[1])}</span></div>` : '';
  // What the tooltip reads: each point's name (a label or a time) and every series' value there.
  const data = { bars, unit: b.unit || '', names: Array.from({ length: n }, (_, i) => b.labels?.[i] ?? (b.times?.[i] ? kitClock(b.times[i]) : '')), series: series.map((s) => ({ label: s.label, color: s.color, points: s.points })) };
  return `<div class="kit-chart">${head || legend ? `<div class="kit-chart-head">${head}${legend}</div>` : ''}
    <div class="kit-plot ${axes ? 'axes' : ''}" data-chart="${esc(JSON.stringify(data))}" tabindex="-1">
      <svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true"><g class="grid">${grid}</g>${marks}</svg>${yAxis}
    </div>${xAxis}</div>`;
}

// The tooltip: over a chart, or tapped, it says what the chart shows there.
function wireCharts(root) {
  $$('.kit-plot[data-chart]', root).forEach((el) => {
    let data = null;
    try { data = JSON.parse(el.dataset.chart); } catch { return; }
    const n = Math.max(...data.series.map((s) => s.points.length));
    const show = (e) => {
      const r = el.getBoundingClientRect();
      const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      const i = data.bars ? Math.min(Math.floor(f * n), n - 1) : Math.round(f * (n - 1));
      let tip = $('.kit-tip', el);
      if (!tip) { tip = document.createElement('div'); tip.className = 'kit-tip'; el.append(tip); }
      const at = data.series.filter((s) => Number.isFinite(s.points[i])).map((s) => `${s.label ? `${esc(s.label)} ` : ''}${esc(kitNum(s.points[i]))}${esc(data.unit ? ` ${data.unit}` : '')}`);
      tip.innerHTML = `${data.names[i] ? `<b>${esc(data.names[i])}</b>` : ''}${at.join(' · ') || '·'}`;
      const x = data.bars ? ((i + 0.5) / n) * r.width : (n > 1 ? (i / (n - 1)) * r.width : 0);
      tip.style.left = `${Math.min(Math.max(x - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth)}px`;
      let mark = $('.kit-cursor', el);
      if (!mark) { mark = document.createElement('i'); mark.className = 'kit-cursor'; el.append(mark); }
      mark.style.left = `${x}px`;
    };
    const hide = () => { $('.kit-tip', el)?.remove(); $('.kit-cursor', el)?.remove(); };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); show(e); }); // a tap shows it, and opens nothing
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  });
}

// ---------- a table (#396) ----------

// A table (lib/tile-blocks.js tableOf fills it in): the owner sorts it by a column's header, searches it and filters
// it on one column, all here, and it pages its rows ("10 of 58"). In a narrow box it is a list: the first column as
// the title, a reference under it, a status pill on the right. What the owner chose is kept by the table's key, so a
// table drawn again with new rows (a live value, the Board's refresh) keeps its sort, search, filter and page.
const kitTableStates = new Map();
const kitTableData = new Map();
const kitTableState = (key) => { if (!kitTableStates.has(key)) kitTableStates.set(key, { sort: null, q: '', filter: '', page: 0 }); return kitTableStates.get(key); };

// The rows the owner sees: filtered, searched, sorted, and the page of them. { rows, matching, total, page, pages, sort }
function kitTableView(b, st) {
  const rows0 = b.rows || [];
  const head = b.head || [];
  let rows = rows0.map((r, i) => ({ r, i }));
  const f = b.filter && st.filter && b.filter.options.some((o) => o.toLowerCase() === st.filter.toLowerCase()) ? st.filter.toLowerCase() : '';
  if (f) rows = rows.filter(({ r }) => String(r[b.filter.column]?.text || '').toLowerCase() === f);
  const q = String(st.q || '').trim().toLowerCase();
  if (q) rows = rows.filter(({ r }) => r.some((c) => String(c?.text || '').toLowerCase().includes(q)));
  const sort = st.sort && head[st.sort.column] ? st.sort : b.sort && head[b.sort.column] ? b.sort : null;
  if (sort) {
    const k = sort.column;
    const dir = sort.dir === 'desc' ? -1 : 1;
    rows.sort((x, y) => {
      const a = x.r[k] || { text: '' }, c = y.r[k] || { text: '' };
      const an = Number.isFinite(a.n), cn = Number.isFinite(c.n);
      // An empty cell goes last either way.
      if (!a.text !== !c.text) return a.text ? -1 : 1;
      const d = an && cn ? a.n - c.n : an !== cn ? (an ? -1 : 1) : String(a.text).localeCompare(String(c.text), undefined, { numeric: true, sensitivity: 'base' });
      return d * dir || x.i - y.i;
    });
  }
  const size = Math.max(Number(b.pageSize) || 10, 1);
  const pages = Math.max(Math.ceil(rows.length / size), 1);
  const page = Math.min(Math.max(st.page || 0, 0), pages - 1);
  return { rows: rows.slice(page * size, page * size + size).map((x) => x.r), matching: rows.length, total: rows0.length, page, pages, sort };
}

const KIT_RIGHT = ['number', 'date'];
function kitCell(c, type) {
  if (!c?.text) return '';
  if (type === 'status') return kitStatus({ text: c.text, level: c.level });
  if (type === 'ref') return `<span class="kit-ref">${(c.refs?.length ? c.refs : [{ text: c.text }]).map((r) => (r.url && /^https?:\/\//.test(r.url) ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.text)}</a>` : esc(r.text))).join(' · ')}</span>`;
  return esc(c.text);
}

function kitTableBody(b, st) {
  const v = kitTableView(b, st);
  const head = b.head || [];
  if (!v.total) return `<div class="faint kit-table-empty">${tr('No rows')}</div>`;
  const th = head.map((h, i) => {
    const on = v.sort?.column === i;
    return `<th class="${KIT_RIGHT.includes(h.type) ? 'r' : ''} ${on ? 'on' : ''}"><button type="button" data-tsort="${i}">${esc(h.label)}${on ? `<span class="ar">${v.sort.dir === 'desc' ? '▼' : '▲'}</span>` : ''}</button></th>`;
  }).join('');
  const trs = v.rows.map((r) => `<tr>${head.map((h, i) => `<td class="${KIT_RIGHT.includes(h.type) ? 'r' : ''} ${i > 0 && h.type === 'text' ? 'soft' : ''}">${kitCell(r[i], h.type)}</td>`).join('')}</tr>`).join('');
  // The list: the first column, a reference under it, a status on the right.
  const ref = head.findIndex((h) => h.type === 'ref');
  const stat = head.findIndex((h) => h.type === 'status');
  const li = v.rows.map((r) => `<div class="kit-trow"><div class="n">${esc(r[0]?.text || '')}${ref > 0 && r[ref]?.text ? `<span>${kitCell(r[ref], 'ref')}</span>` : ''}</div>${stat > 0 && r[stat]?.text ? kitCell(r[stat], 'status') : ''}</div>`).join('');
  const pager = v.pages > 1 ? `<span class="kit-pager"><button type="button" data-tpage="${v.page - 1}" ${v.page ? '' : 'disabled'} aria-label="${tr('Previous')}">‹</button>${v.page + 1} / ${v.pages}<button type="button" data-tpage="${v.page + 1}" ${v.page < v.pages - 1 ? '' : 'disabled'} aria-label="${tr('Next')}">›</button></span>` : '';
  return `${v.matching ? `<table class="kit-tbl"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table><div class="kit-tlist">${li}</div>` : `<div class="faint kit-table-empty">${tr('Nothing matches')}</div>`}
    <div class="kit-tfoot"><span>${v.matching !== v.total ? tr('{shown} of {matching} · {total} in all', { shown: v.rows.length, matching: v.matching, total: v.total }) : tr('{shown} of {matching}', { shown: v.rows.length, matching: v.matching })}</span>${pager}</div>`;
}

// A table. key: where it is drawn, the same each time it is drawn again (a tile and its block, a page and its part).
function kitTable(b, key) {
  kitTableData.set(key, b);
  const st = kitTableState(key);
  const f = b.filter;
  const seg = f ? `<div class="kit-seg" role="group">${['', ...f.options].map((o) => `<button type="button" data-tfilter="${esc(o)}" class="${(st.filter || '').toLowerCase() === o.toLowerCase() || (!o && !f.options.some((x) => x.toLowerCase() === (st.filter || '').toLowerCase())) ? 'on' : ''}">${o ? esc(o) : tr('All')}</button>`).join('')}</div>` : '';
  const find = b.search === false ? '' : `<input class="kit-find" type="search" placeholder="${tr('Search')}" value="${esc(st.q)}" aria-label="${tr('Search the table')}">`;
  return `<div class="kit-table" data-tkey="${esc(key)}">
    <div class="kit-table-bar">${b.text ? `<b>${esc(b.text)}</b>` : ''}<span class="kit-count">${(b.rows || []).length}</span><span class="sp"></span>${find}${seg}</div>
    <div class="kit-table-body">${kitTableBody(b, st)}</div></div>`;
}

// What the owner does with a table: its header sorts, the search and the filter narrow it, the pager pages. Only its
// rows are drawn again, so the search box keeps its place. A tap in it opens nothing under it (a tile's pop-up).
function wireTables(root) {
  $$('.kit-table[data-tkey]', root).forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    const key = el.dataset.tkey;
    const st = kitTableState(key);
    const redraw = () => { const b = kitTableData.get(key); if (b) $('.kit-table-body', el).innerHTML = kitTableBody(b, st); };
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) { e.stopPropagation(); return; }
      e.stopPropagation();
      const s = e.target.closest('[data-tsort]');
      if (s) {
        const i = Number(s.dataset.tsort);
        const now = st.sort || kitTableData.get(key)?.sort;
        st.sort = { column: i, dir: now?.column === i && now.dir !== 'desc' ? 'desc' : 'asc' };
        st.page = 0;
        return redraw();
      }
      const f = e.target.closest('[data-tfilter]');
      if (f) {
        st.filter = f.dataset.tfilter;
        st.page = 0;
        $$('[data-tfilter]', el).forEach((x) => x.classList.toggle('on', x === f));
        return redraw();
      }
      const p = e.target.closest('[data-tpage]');
      if (p && !p.disabled) { st.page = Number(p.dataset.tpage); redraw(); }
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const find = $('.kit-find', el);
    find?.addEventListener('input', () => { st.q = find.value; st.page = 0; redraw(); });
    find?.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  });
}

// ---------- a page's blocks (#395) ----------

// A bot's page draws the kit between its Markdown (lib/page-blocks.js fills its blocks in): a hero at its top, kpis
// and charts on cards, status pills and callouts, a grid of them side by side, and a quiet line for a block that
// cannot be drawn. A colour is "#rrggbb" or a theme name; without one, the accent. words: a colour for text.
const PAGE_TINT = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--err)', faint: 'var(--faint)', muted: 'var(--muted)', text: 'var(--text)' };
const PAGE_TEXT_TINT = { ...PAGE_TINT, ok: 'var(--ok-text)', warn: 'var(--warn-text)' };
const pageTint = (c, words = false) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : (words ? PAGE_TEXT_TINT : PAGE_TINT)[c] || 'var(--mention)');

function pageBlockHTML(b, key = '') {
  switch (b?.type) {
    case 'hero':
      return `<header class="pb-hero">${b.eyebrow ? `<div class="pb-eyebrow">${esc(b.eyebrow)}</div>` : ''}<div class="pb-title">${esc(b.title)}</div>${b.lead ? `<p class="pb-lead">${esc(b.lead)}</p>` : ''}${b.tags?.length ? `<div class="pb-tags">${b.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</header>`;
    case 'kpi':
      return `<div class="pb-card">${kitKpi(b, pageTint(b.color), (x) => pageTint(x, true))}</div>`;
    case 'chart':
      return `<div class="pb-card">${kitChart(b, pageTint(b.color), (x) => pageTint(x))}</div>`;
    case 'status':
      return kitStatus(b);
    case 'callout':
      return kitCallout(b);
    case 'table':
      return `<div class="pb-card">${kitTable(b, key)}</div>`;
    case 'grid':
      if (b.blocks.every((x) => x.type === 'status')) return `<div class="pb-pills">${b.blocks.map(kitStatus).join('')}</div>`;
      return `<div class="pb-grid" style="--cols:${Math.min(Math.max(Number(b.columns) || 1, 1), 4)}">${b.blocks.map(pageBlockHTML).join('')}</div>`;
    default:
      return `<div class="pb-error" title="${esc(b?.text || '')}">${tr('This block could not be drawn')}</div>`;
  }
}

// The page: its Markdown with the chat's own md(), its blocks with the kit, each in a box of its own so that a live
// value redraws only it.
// scope: the page's own (its address), so that each table keeps what the owner chose in it.
const pageHTML = (parts, scope = '') => parts.map((p, i) => (p.md != null ? md(p.md) : `<div class="pb" data-pb="${i}">${pageBlockHTML(p.block, `${scope}#${i}`)}</div>`)).join('');
