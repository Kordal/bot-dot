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
  return `<span class="kit-delta ${tone}">${arrow} ${esc(d.text)}${b.since ? ` since ${kitClock(Date.parse(b.since))}` : ''}</span>`;
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
      <div class="kit-num"${b.type === 'value' && b.color ? ` style="color:${tint(b.color)}"` : ''}>${b.text ? esc(b.text) : '<span class="faint">·</span>'}${b.unit ? `<small>${esc(b.unit)}</small>` : ''}${b.of ? `<small class="of">of ${esc(b.of)}</small>` : ''}</div>
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
