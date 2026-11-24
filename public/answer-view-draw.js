// ---------- answer views (#1624, ADR 264) ----------

// A bot's reply may hold a ```ui fence: a JSON tree of the components of the catalog the server hands out (GET /api/ui-catalog).
// The validator (answer-view.js) reads it by the rules every app shares (test/fixtures/ui-cases.json) and returns a tree of
// plain values; this draws that tree, in the page's own theme, as HTML for md() to place in the reply. A bot sets no colour,
// size or style: it names a tone, and a series by its number. Every word is escaped, and nothing in the tree is an address
// the page opens but an https link card. A picture comes through botdot (/api/product-image, as a product's, ADR 113) or
// from the bot's own files; a video, a sound and a file only from the bot's own files. The page blocks (hero, kpi, chart,
// status, callout) are drawn by the block kit (blocks.js), so a chat and a page look alike.
//
// Wave 1: layout, text, data, charts, media. Inputs and actions are the next wave, so a component the catalog does not
// have yet is one quiet line.
const AnswerViews = (() => {
  let view = null; // the validator, once the server's catalog is in
  let words = null; // AnswerText over it: a reply as text

  // The catalog the server hands out, and what the page draws of it (the newest `since` it has code for).
  const DRAWS = 1;
  function use(catalog) {
    if (!catalog || typeof catalog !== 'object' || !catalog.components) return;
    view = AnswerView.of(catalog, { known: DRAWS });
    words = AnswerText.of(view, { tr });
  }
  // Asked once, from a server whose features name `ui-catalog`; without it a fence stays its code.
  async function load(api, features) {
    if (view || !features.includes('ui-catalog')) return;
    try { use(await api('/ui-catalog')); } catch { /* the fences stay code */ }
  }
  const ready = () => !!view;
  const has = (src) => !!view && /^\s*```ui\s*$/m.test(String(src ?? ''));

  // ---------- what the owner keeps while the chat is drawn again ----------

  const kept = new Map(); // a part's key -> true (open) / false (closed) for a panel and its Data; a tab's key -> its number
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

  // ---------- small parts ----------

  const TONES = ['neutral', 'good', 'warn', 'bad', 'accent'];
  const tone = (n) => (TONES.includes(n.tone) ? n.tone : 'neutral');
  // The block kit's own words for a tone, and its colour as a theme token.
  const LEVEL = { neutral: 'plan', good: 'ok', warn: 'warn', bad: 'err', accent: 'info' };
  const TINT = { neutral: 'var(--muted)', good: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--err)', accent: 'var(--mention)' };
  const lines = (s) => esc(s).replace(/\n/g, '<br>');
  const num = (v) => String(Math.round(v * 100) / 100);
  const gap = (n) => ` gap-${['s', 'm', 'l'].includes(n.gap) ? n.gap : 'm'}`;

  const source = (n) => (n.source ? `<p class="av-source">${esc(tr('Source: {source}', { source: n.source }))}</p>` : n.noSource ? `<p class="av-source none">${tr('No source')}</p>` : '');
  const title = (s, cls = 'av-title') => (s ? `<div class="${cls}">${esc(s)}</div>` : '');
  const unknown = () => `<p class="av-unknown">${tr("Can't show this here")}</p>`;

  // A picture or a file from the bot's own files, or a picture from an https address, as the page asks for it.
  function address(m, botId) {
    if (!m) return '';
    if (m.kind === 'https') return `/api/product-image?url=${encodeURIComponent(m.url)}`;
    return botId ? `/api/bots/${encodeURIComponent(botId)}/path?path=${encodeURIComponent(m.path)}` : '';
  }
  const picture = (m, alt, botId, cls = '') => {
    const src = address(m, botId);
    return `<span class="av-img ${cls}"><span class="av-ph" aria-hidden="true">${esc(alt)}</span>${src ? `<img alt="${esc(alt)}" loading="lazy" decoding="async" src="${esc(src)}">` : ''}</span>`;
  };

  // A table of texts: a column of numbers lines up on the right, as a table in a reply does (tableHTML).
  const NUMBER = /^[-+−]?\d[\d\s.,:]*%?$/;
  const WITH_UNIT = /^[-+−]?\d[\d\s.,:]*(?:%|\s\S{1,12})?$/; // the numbers of a chart, with their unit
  function grid(head, rows, aligns = [], unit = false) {
    const number = unit ? WITH_UNIT : NUMBER;
    const right = (c) => aligns[c] === 'right' || (!aligns[c] && !(unit && c === 0) && rows.some((r) => r[c]) && rows.every((r) => !r[c] || number.test(r[c])));
    const cls = (c) => (right(c) ? ' class="num"' : aligns[c] === 'center' ? ' class="mid"' : '');
    const th = head.map((h, c) => `<th scope="col"${cls(c)}>${h ? esc(h) : `<span class="sr-only">${tr('Label')}</span>`}</th>`).join('');
    const body = rows.map((r) => `<tr>${head.map((_, c) => `<td${cls(c)}>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('');
    return `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // The Data toggle of a chart: its numbers as a table.
  function dataOf(n, ctx, path) {
    const d = words.data(n);
    if (!d || !d.rows.length) return '';
    const key = `${ctx.key}.${path}.data`;
    return `<details class="av-data" data-av-key="${key}"${kept.get(key) ? ' open' : ''}><summary>${tr('Data')}</summary>${grid(d.head, d.rows, [], true)}</details>`;
  }
  const chartLabel = (n) => n.title || n.label || tr('Chart');
  // A chart: its drawing (named for a screen reader), its Data and where its numbers came from.
  const figure = (n, ctx, path, drawing, cls = '') => `<figure class="av-chart ${cls}"><div class="av-plot" role="img" aria-label="${esc(chartLabel(n))}">${drawing}</div>${dataOf(n, ctx, path)}<figcaption>${source(n)}</figcaption></figure>`;

  // The series of a chart as the block kit draws them: a colour by its number, a theme token.
  const seriesTint = (name) => `var(--av-${name})`;
  const kitBlock = (n, extra = {}) => ({ text: n.title || '', unit: n.unit || '', labels: n.labels || [], ...extra });

  // ---------- one component ----------

  function chart(n, ctx, path) {
    const unit = n.unit ? ` ${n.unit}` : '';
    const style = n.style || 'line';
    let block;
    if (style === 'hbar') {
      const many = n.series.length > 1;
      const entries = n.series.flatMap((s, si) => s.points.map((v, i) => ({ label: `${n.labels?.[i] ?? i + 1}${many && s.label ? ` (${s.label})` : ''}`, v: Number.isFinite(v) ? Math.max(v, 0) : 0, shown: Number.isFinite(v) ? `${num(v)}${unit}` : '', si })));
      const top = Math.max(...entries.map((x) => x.v), 0);
      block = kitBlock(n, { style, bars: entries.map((x) => ({ label: x.label, ratio: top ? x.v / top : 0, text: x.shown })) });
    } else {
      block = kitBlock(n, { style, series: n.series.map((s, i) => ({ label: s.label || '', color: `s${i % 6}`, points: s.points })) });
    }
    return figure(n, ctx, path, kitChart(block, TINT.accent, seriesTint), 'pb-card');
  }

  // A pie or a ring: each slice a stroke of one circle, as long as its share (pathLength 100), and the legend with its numbers.
  function pie(n, ctx, path) {
    const total = n.slices.reduce((a, s) => a + s.value, 0);
    let at = 0;
    const slices = total > 0 ? n.slices.map((s, i) => {
      const share = (s.value / total) * 100;
      const out = share > 0 ? `<circle class="av-s${i % 6}" r="${n.donut ? 15.9155 : 8}" cx="21" cy="21" pathLength="100" stroke-dasharray="${share.toFixed(3)} ${(100 - share).toFixed(3)}" stroke-dashoffset="${(-at).toFixed(3)}"></circle>` : '';
      at += share;
      return out;
    }).join('') : '';
    const unit = n.unit ? ` ${n.unit}` : '';
    const legend = n.slices.map((s, i) => `<li><i class="av-bg-s${i % 6}"></i><span>${esc(s.label)}</span><b>${esc(num(s.value) + unit)}</b>${total > 0 ? `<small>${Math.round((s.value / total) * 100)}%</small>` : ''}</li>`).join('');
    const drawing = `${n.title ? title(n.title, 'kit-chart-title') : ''}<div class="av-pie"><svg viewBox="0 0 42 42" class="${n.donut ? 'ring' : 'disc'}" aria-hidden="true">${slices}</svg><ul class="av-legend">${legend}</ul></div>`;
    return figure(n, ctx, path, drawing, 'pb-card');
  }

  function scatter(n, ctx, path) {
    const all = n.series.flatMap((s) => s.points);
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (x1 === x0) { x1 += 1; x0 -= 1; }
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    const H = 60;
    const marks = n.series.map((s, i) => `<path class="av-dots av-s${i % 6}" d="${s.points.map((p) => `M${(((p.x - x0) / (x1 - x0)) * 100).toFixed(2)} ${(H - ((p.y - y0) / (y1 - y0)) * H).toFixed(2)}h0`).join('')}" vector-effect="non-scaling-stroke"></path>`).join('');
    const legend = n.series.length > 1 ? `<span class="kit-legend">${n.series.map((s, i) => `<span><i class="av-bg-s${i % 6}"></i>${esc(s.label || tr('Series {n}', { n: i + 1 }))}</span>`).join('')}</span>` : '';
    const drawing = `<div class="kit-chart"><div class="kit-chart-head">${n.title ? title(n.title, 'kit-chart-title') : ''}${legend}${n.yLabel ? `<span>${esc(n.yLabel)}</span>` : ''}</div>
      <div class="kit-plot axes"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true"><g class="grid"><line x1="0" x2="100" y1="0" y2="0"/><line x1="0" x2="100" y1="${H / 2}" y2="${H / 2}"/><line x1="0" x2="100" y1="${H}" y2="${H}"/></g>${marks}</svg><span class="kit-y top">${esc(num(y1))}</span><span class="kit-y bottom">${esc(num(y0))}</span></div>
      <div class="kit-x"><span>${esc(num(x0))}</span>${n.xLabel ? `<span>${esc(n.xLabel)}</span>` : ''}<span>${esc(num(x1))}</span></div></div>`;
    return figure(n, ctx, path, drawing, 'pb-card');
  }

  function histogram(n, ctx, path) {
    const counts = AnswerText.bins(n.values, n.bins);
    const unit = n.unit ? ` ${n.unit}` : '';
    const block = kitBlock(n, { style: 'bar', labels: counts.map((b) => `${num(b.from)}`), series: [{ label: '', color: 's0', points: counts.map((b) => b.count) }] });
    return figure(n, ctx, path, kitChart(block, TINT.accent, seriesTint), 'pb-card');
  }

  function sparkline(n, ctx, path) {
    const drawing = `${n.label ? `<div class="kit-label">${esc(n.label)}</div>` : ''}${kitSpark(n.points, TINT[tone(n)]) || `<div class="faint">·</div>`}`;
    return figure(n, ctx, path, drawing, 'pb-card');
  }

  // A dial: a half circle, filled to the value's place between min and max.
  function gauge(n, ctx, path) {
    let lo = Number.isFinite(n.min) ? n.min : 0, hi = Number.isFinite(n.max) ? n.max : 100;
    if (hi <= lo) { lo = 0; hi = 100; }
    const share = Math.min(Math.max((n.value - lo) / (hi - lo), 0), 1) * 100;
    const value = `${num(n.value)}${n.unit ? ` ${n.unit}` : ''}`;
    const drawing = `<div class="av-gauge" role="meter" aria-label="${esc(n.label)}" aria-valuenow="${num(n.value)}" aria-valuemin="${num(lo)}" aria-valuemax="${num(hi)}" aria-valuetext="${esc(value)}" style="--c:${TINT[tone(n)]}">
      <svg viewBox="0 0 100 56" aria-hidden="true"><path class="track" d="M10 50 A40 40 0 0 1 90 50" pathLength="100"></path><path class="fill" d="M10 50 A40 40 0 0 1 90 50" pathLength="100" stroke-dasharray="${share.toFixed(2)} 100"></path></svg>
      <div class="av-gauge-n kit-num">${esc(value)}</div><div class="kit-label">${esc(n.label)}</div><div class="av-gauge-r"><span>${esc(num(lo))}</span><span>${esc(num(hi))}</span></div></div>`;
    return figure(n, ctx, path, drawing, 'pb-card');
  }

  function tabs(n, ctx, path) {
    const key = `${ctx.key}.${path}`;
    const list = (n.children || []).filter((c) => c.type === 'tab');
    if (!list.length) return '';
    const at = Math.min(Math.max(Number(kept.get(key)) || 0, 0), list.length - 1);
    const tab = (c, i) => `<button type="button" role="tab" class="av-tab" aria-selected="${i === at}" tabindex="${i === at ? 0 : -1}" data-tab="${i}">${esc(c.label)}</button>`;
    const panel = (c, i) => `<div role="tabpanel" class="av-tabpanel" aria-label="${esc(c.label)}" tabindex="0"${i === at ? '' : ' hidden'}>${kids(c, ctx, `${path}.${i}`)}</div>`;
    return `<div class="av-tabs" data-av-key="${key}"><div role="tablist" class="av-tablist">${list.map(tab).join('')}</div>${list.map(panel).join('')}</div>`;
  }

  const kids = (n, ctx, path) => (n.children || []).map((c, i) => draw(c, ctx, `${path}.${i}`)).join('');

  function table(n, ctx, path) {
    const aligns = n.columns.map((c) => c.align);
    const rows = n.rows.map((r) => n.columns.map((_, i) => r[i] ?? ''));
    return `<div class="av-block">${title(n.title)}${grid(n.columns.map((c) => c.label), rows, aligns)}${source(n)}</div>`;
  }

  function comparison(n) {
    const head = ['', ...n.options];
    const th = head.map((h, c) => `<th scope="col"${c && c - 1 === n.pick ? ' class="pick"' : ''}>${h ? esc(h) : `<span class="sr-only">${tr('Label')}</span>`}${c && c - 1 === n.pick ? `<small>${tr('Recommended')}</small>` : ''}</th>`).join('');
    const body = n.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${n.options.map((_, i) => `<td${i === n.pick ? ' class="pick"' : ''}>${esc(r.values[i] ?? '')}</td>`).join('')}</tr>`).join('');
    return `<div class="av-block">${title(n.title)}<div class="md-table av-compare"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  // The cards of a product list are the reply's own (products.js): the validator's items in the shape that file draws.
  function products(n, ctx) {
    const list = n.items.map((p) => ({
      name: p.name, url: p.url || '', image: p.image || '', price: p.price || '', was: Products.off(p.price, p.was) ? p.was : '', off: Products.off(p.price, p.was),
      store: p.store || '', rating: Number.isFinite(p.rating) && p.rating > 0 ? Math.round(p.rating * 10) / 10 : null, reviews: Number.isFinite(p.reviews) ? Math.floor(p.reviews) : null, arrives: p.arrives || '', why: p.why || '',
    }));
    return Products.html(list, ctx.botId);
  }

  function linkCard(n) {
    const img = n.image ? picture(n.image, n.title, '', 'small') : '';
    return `<a class="av-link" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer" data-site-icon>${img}<span class="av-link-t"><b>${esc(n.title)}</b>${n.text ? `<span>${esc(n.text)}</span>` : ''}<small>${esc(linkLabel(n.url))}</small></span></a>`;
  }

  function steps(n) {
    const word = { done: tr('Done'), current: tr('Current'), todo: tr('To do') };
    return `<ol class="av-steps">${n.items.map((x) => { const s = ['done', 'current'].includes(x.state) ? x.state : 'todo'; return `<li class="${s}"><span class="mark" aria-hidden="true"></span><span class="sr-only">${word[s]}: </span><b>${esc(x.title)}</b>${x.text ? `<span>${esc(x.text)}</span>` : ''}</li>`; }).join('')}</ol>`;
  }

  // Where a file is, or '' when this reply is no bot's.
  function mediaBox(n, ctx, inner, fallback) {
    const src = address(n.src, ctx.botId);
    return src ? inner(src) : `<span class="av-missing">${esc(fallback)}</span>`;
  }

  // One node as HTML. path: where it stands in the tree, to tell the same kind of part apart (what the owner opened).
  function draw(n, ctx, path = '0') {
    switch (n.type) {
      case 'stack': return `<div class="av-stack${gap(n)}">${kids(n, ctx, path)}</div>`;
      case 'row': return `<div class="av-row${gap(n)}">${kids(n, ctx, path)}</div>`;
      case 'grid': return `<div class="pb-grid av-grid${gap(n)}" style="--cols:${Math.min(Math.max(Number(n.columns) || 2, 1), 4)}">${kids(n, ctx, path)}</div>`;
      case 'card': return `<section class="av-card t-${tone(n)}"${n.title ? ` aria-label="${esc(n.title)}"` : ''}>${title(n.title, 'av-card-title')}${kids(n, ctx, path)}</section>`;
      case 'section': return `<section class="av-section" aria-label="${esc(n.title)}"><h3>${esc(n.title)}</h3>${n.lead ? `<p class="av-lead">${esc(n.lead)}</p>` : ''}${kids(n, ctx, path)}</section>`;
      case 'tabs': return tabs(n, ctx, path);
      case 'accordion': return `<div class="av-accordion">${kids(n, ctx, path)}</div>`;
      case 'panel': { const key = `${ctx.key}.${path}`; return `<details class="av-panel" data-av-key="${key}"${(kept.has(key) ? kept.get(key) : n.open) ? ' open' : ''}><summary>${esc(n.title)}</summary><div class="av-panel-body">${kids(n, ctx, path)}</div></details>`; }
      case 'divider': return n.label ? `<div class="av-divider" role="separator"><span>${esc(n.label)}</span></div>` : '<hr class="av-divider">';
      case 'spacer': return `<div class="av-spacer ${['s', 'm', 'l'].includes(n.size) ? n.size : 'm'}" aria-hidden="true"></div>`;

      case 'heading': { const l = Math.min(Math.max(n.level || 2, 1), 3); return `<h${l} class="av-heading">${esc(n.text)}</h${l}>`; }
      case 'text': return `<p class="av-text t-${tone(n)}">${lines(n.text)}</p>`;
      case 'list': { const tag = n.ordered ? 'ol' : 'ul'; return `<${tag} class="av-list">${n.items.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}>`; }
      case 'quote': return `<blockquote class="av-quote">${lines(n.text)}${n.by ? `<cite>${esc(n.by)}</cite>` : ''}</blockquote>`;
      case 'code': return `<div class="code-block"><pre><code>${esc(n.text)}</code></pre>${CODE_COPY_BTN}</div>`;
      case 'badge': return `<span class="av-badge t-${tone(n)}">${esc(n.text)}</span>`;
      case 'key-value': return `<div class="av-block">${title(n.title)}<dl class="av-kv">${n.items.map((x) => `<div><dt>${esc(x.key)}</dt><dd>${esc(x.value)}</dd></div>`).join('')}</dl></div>`;
      case 'steps': return steps(n);

      case 'hero': return pageBlockHTML({ type: 'hero', title: n.title, eyebrow: n.eyebrow, lead: n.lead, tags: n.tags });
      case 'kpi': return `<div class="pb-card av-kpi">${kitKpi({ label: n.label, text: n.value, unit: n.unit, of: n.of, sub: n.sub, points: n.points }, TINT[tone(n)])}${source(n)}</div>`;
      case 'stat-row': return `<div class="av-statrow">${kids(n, ctx, path)}</div>`;
      case 'progress': return `<div class="av-progress" role="progressbar" aria-label="${esc(n.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${num(n.value)}" aria-valuetext="${esc(n.text || `${num(n.value)}%`)}" style="--c:${TINT[tone(n)]}"><div class="av-progress-l"><span>${esc(n.label)}</span><span class="n">${esc(n.text || `${num(n.value)}%`)}</span></div><div class="kit-bar"><i style="width:${num(n.value)}%"></i></div></div>`;
      case 'status': return kitStatus({ text: n.text, level: LEVEL[tone(n)] });
      case 'table': return table(n, ctx, path);
      case 'timeline': return `<ol class="av-timeline">${n.items.map((x) => `<li class="t-${tone(x)}"><span class="mark" aria-hidden="true"></span>${x.when ? `<small>${esc(x.when)}</small>` : ''}<b>${esc(x.title)}</b>${x.text ? `<span>${esc(x.text)}</span>` : ''}</li>`).join('')}</ol>`;
      case 'comparison': return comparison(n);
      case 'checklist': return `<div class="av-block">${title(n.title)}<ul class="av-checklist">${n.items.map((x) => `<li class="task"><input type="checkbox" disabled${x.done ? ' checked' : ''} aria-label="${esc(x.text)}"> ${esc(x.text)}</li>`).join('')}</ul></div>`;
      case 'callout': return `<div class="kit-callout ${LEVEL[tone(n)]}">${n.title ? `<b>${esc(n.title)}</b>` : ''}<div>${lines(n.text)}</div></div>`;

      case 'chart': return chart(n, ctx, path);
      case 'pie': return pie(n, ctx, path);
      case 'scatter': return scatter(n, ctx, path);
      case 'histogram': return histogram(n, ctx, path);
      case 'sparkline': return sparkline(n, ctx, path);
      case 'gauge': return gauge(n, ctx, path);

      case 'image': return `<figure class="av-figure">${picture(n.src, n.alt, ctx.botId)}${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ''}</figure>`;
      case 'gallery': return `<div class="av-gallery">${n.items.map((x) => `<figure class="av-figure">${picture(x.src, x.alt, ctx.botId)}${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
      case 'video': return `<figure class="av-figure">${mediaBox(n, ctx, (src) => `<video controls preload="metadata" playsinline aria-label="${esc(n.alt)}" src="${esc(src)}"></video>`, n.alt)}${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ''}</figure>`;
      case 'audio': return `<figure class="av-figure av-audio"><figcaption>${esc(n.title)}</figcaption>${mediaBox(n, ctx, (src) => `<audio controls preload="none" aria-label="${esc(n.title)}" src="${esc(src)}"></audio>`, tr("Can't play this here"))}</figure>`;
      case 'file': { const name = n.title || n.src.path.split('/').pop(); return mediaBox(n, ctx, (src) => `<a class="av-file" href="${esc(src)}" download="${esc(n.src.path.split('/').pop())}">${FILE_ICON}<span>${esc(name)}</span></a>`, name); }
      case 'link-card': return linkCard(n);
      case 'products': return products(n, ctx);
      default: return unknown();
    }
  }

  // One view: the fence's alt names it for a screen reader.
  function html(v, botId = '') {
    const key = hash(JSON.stringify(v));
    if (v.root.type === 'unknown') return `${altLine(v.alt)}${unknown()}`;
    return `<div class="av" role="group" aria-label="${esc(v.alt)}" data-av="${key}">${draw(v.root, { botId, key })}</div>`;
  }
  const altLine = (alt) => (alt ? `<p class="av-alt">${esc(alt)}</p>` : '');

  // A fence that is code: its alt in a quiet line above it.
  const codeHTML = (p) => `${altLine(p.alt)}<div class="code-block"><pre><code>${esc(p.code)}</code></pre>${CODE_COPY_BTN}</div>`;
  const drawingHTML = () => `<p class="av-drawing" role="status">${tr('Drawing a view…')}</p>`;

  // A reply's top-level elements as HTML, in order, its fences drawn: { botId, done }. done false: the reply is still being
  // written, so a fence not closed yet waits whole ("Drawing a view…") and the last text is a draft (draftSource).
  function parts(src, { botId = '', done = true } = {}) {
    const all = view.split(src, { done });
    return all.flatMap((p, i) => {
      if (p.view) return [html(p.view, botId)];
      if (p.code != null) return [codeHTML(p)];
      if (p.drawing) return [drawingHTML()];
      return mdParts(mdBlocks(!done && i === all.length - 1 ? draftSource(p.text) : p.text), botId);
    });
  }

  // The tooltips of the charts drawn under `root`, once each.
  function wire(root) {
    $$('.av .kit-plot[data-chart]:not([data-wired])', root).forEach((el) => {
      el.dataset.wired = '1';
      wireCharts(el.parentElement);
    });
  }

  if (typeof document !== 'undefined') {
    // A panel and a Data the owner opened stay open when the chat is drawn again.
    document.addEventListener('toggle', (e) => {
      const el = e.target;
      if (el?.matches?.('details[data-av-key]')) kept.set(el.dataset.avKey, el.open);
    }, true);
    const pick = (tab, i) => {
      const box = tab.closest('.av-tabs');
      const list = [...box.querySelectorAll(':scope > .av-tablist > [role="tab"]')];
      const panels = [...box.querySelectorAll(':scope > [role="tabpanel"]')];
      list.forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
      panels.forEach((p, k) => { p.hidden = k !== i; });
      kept.set(box.dataset.avKey, i);
      list[i].focus();
    };
    document.addEventListener('click', (e) => {
      const tab = e.target.closest?.('.av-tabs [role="tab"]');
      if (tab) pick(tab, Number(tab.dataset.tab));
    });
    // Arrow keys, Home and End move between tabs (the pattern's own keys).
    document.addEventListener('keydown', (e) => {
      const tab = e.target.closest?.('.av-tabs [role="tab"]');
      if (!tab) return;
      const n = tab.parentElement.children.length, at = Number(tab.dataset.tab);
      const to = { ArrowRight: (at + 1) % n, ArrowLeft: (at + n - 1) % n, Home: 0, End: n - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      pick(tab, to);
    });
    // A picture that can't be had leaves its place, with the words that say what it shows.
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (img?.tagName === 'IMG' && img.parentElement?.classList.contains('av-img')) img.remove();
    }, true);
  }

  return {
    use, load, ready, has, parts, html, wire,
    alt: (src, opts) => (words ? words.alt(src, opts) : String(src ?? '')),
    text: (src, opts) => (words ? words.text(src, opts) : String(src ?? '')),
  };
})();
