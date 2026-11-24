// ---------- answer views (#1624, ADR 264) ----------

// A bot's reply may hold a ```ui fence: a JSON tree of the components of the catalog the server hands out (GET /api/ui-catalog).
// The validator (answer-view.js) reads it by the rules every app shares (test/fixtures/ui-cases.json) and returns a tree of
// plain values; this draws that tree, in the page's own theme, as HTML for md() to place in the reply. A bot sets no colour,
// size or style: it names a tone, and a series by its number. Every word is escaped, and nothing in the tree is an address
// the page opens but an https link card. A picture comes through botdot (/api/product-image, as a product's, ADR 113) or
// from the bot's own files; a video, a sound and a file only from the bot's own files. The page blocks (hero, kpi, chart,
// status, callout) are drawn by the block kit (blocks.js), so a chat and a page look alike.
//
// Wave 1: layout, text, data, charts, media. Wave 3 (#1629): the long tail (tree, calendar, kanban, heatmap, alert, empty state,
// countdown, poll, quiz); a poll's and a quiz's choices post their own words as buttons do, a quiz says after the send whether it
// was right, and a countdown counts on this device only. Wave 2 (#1627, ADR 265): inputs, buttons, links and Copy. A form's Send, or a
// button, posts one ordinary owner message through the chat's own send (wireChat): the page never sends anything a view
// did not show as text, and a view never approves, runs or changes anything. Inputs and buttons work on the newest bot
// message of a chat only; an older view is read-only, with "Sent: …" when it was sent. A component the catalog does not
// have yet is one quiet line.
const AnswerViews = (() => {
  let view = null; // the validator, once the server's catalog is in
  let words = null; // AnswerText over it: a reply as text

  // The catalog the server hands out, and what the page draws of it (the newest `since` it has code for).
  const DRAWS = 3;
  function use(catalog) {
    if (!catalog || typeof catalog !== 'object' || !catalog.components) return;
    view = AnswerView.of(catalog, { known: DRAWS });
    words = AnswerText.of(view, { tr });
  }
  // Asked once, from a server whose features name `ui-catalog`; without it a fence stays its code.
  async function load(api, features) {
    if (features.includes('ui-live')) ask = api; // a view's numbers can be live (#1630)
    if (view || !features.includes('ui-catalog')) return;
    try { use(await api('/ui-catalog')); } catch { /* the fences stay code */ }
  }
  const ready = () => !!view;
  const has = (src) => !!view && /^\s*```ui\s*$/m.test(String(src ?? ''));

  // ---------- what the owner keeps while the chat is drawn again ----------

  const kept = new Map(); // a part's key -> true (open) / false (closed) for a panel and its Data; a tab's key -> its number
  const typed = new Map(); // `${view key}.${path}` -> what the owner set in an input, until it is sent: the chat is built again often
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
  const figure = (n, ctx, path, drawing, cls = '', role = 'img') => `<figure class="av-chart ${cls}"><div class="av-plot" role="${role}" aria-label="${esc(chartLabel(n))}">${drawing}</div>${dataOf(n, ctx, path)}<figcaption>${source(n)}</figcaption></figure>`;

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
    return figure(n, ctx, path, drawing, 'pb-card', 'group'); // its legend is text a reader reads
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
    return figure(n, ctx, path, drawing, 'pb-card', 'group');
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
    return figure(n, ctx, path, drawing, 'pb-card', 'group'); // the dial is a meter of its own
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

  // ---------- inputs and actions (wave 2) ----------

  // An input is a real control with its label, drawn read-only: the chat's wiring (wireChat) opens it only on the newest bot
  // message. `path` says where it stands in the tree, as the form's text counts (AnswerText.fields); it is how the page finds
  // what the owner set. Nothing here has a style, a handler or an address of its own.
  const rangeText = (n, v) => (n.type === 'range' ? tr('{from} to {to}', { from: num(v[0]), to: num(v[1]) }) : num(v)) + (n.unit ? ` ${n.unit}` : '');
  const attrs = (n, path) => `data-av-in="${path}" data-kind="${n.type}" data-label="${esc(n.label)}"`;
  const field = (n, path, inner, cls = '') => `<fieldset class="av-field${cls}" ${attrs(n, path)}><legend class="av-label">${esc(n.label)}</legend>${inner}</fieldset>`;
  const checked = (on) => (on ? ' checked' : '');
  const step = (n) => (n.step > 0 ? num(n.step) : 'any');
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const options = (n, path, ctx, kind, v) => n.options.map((o) => `<label class="av-opt"><input type="${kind}" class="av-in"${kind === 'radio' ? ` name="av-${ctx.key}-${path.replace(/\./g, '-')}"` : ''} value="${esc(o)}"${checked(kind === 'radio' ? v === o : v.includes(o))} disabled><span>${esc(o)}</span></label>`).join('');
  function input(n, ctx, path) {
    const raw = typed.get(`${ctx.key}.${path}`);
    const v = words.start(n, raw);
    const label = `<span class="av-label">${esc(n.label)}</span>`;
    switch (n.type) {
      case 'text-input': return `<label class="av-field">${label}<input type="text" class="av-in" value="${esc(v)}"${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ''} maxlength="200" disabled ${attrs(n, path)}></label>`;
      case 'textarea': return `<label class="av-field">${label}<textarea class="av-in" rows="3"${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ''} maxlength="2000" disabled ${attrs(n, path)}>${esc(v)}</textarea></label>`;
      case 'number': {
        const bound = (name, x) => (Number.isFinite(x) ? ` ${name}="${num(x)}"` : '');
        const box = `<input type="number" class="av-in" value="${v === null ? '' : num(v)}"${bound('min', n.min)}${bound('max', n.max)} step="${step(n)}" inputmode="decimal" disabled ${attrs(n, path)}>`;
        return `<label class="av-field">${label}${n.unit ? `<span class="av-with">${box}<span class="av-unit">${esc(n.unit)}</span></span>` : box}</label>`;
      }
      case 'slider': {
        const [a, b] = words.ends(n);
        return `<label class="av-field"><span class="av-label">${esc(n.label)}<output class="av-out" data-unit="${esc(n.unit || '')}">${esc(rangeText(n, v))}</output></span><input type="range" class="av-in" value="${num(v)}" min="${num(a)}" max="${num(b)}" step="${step(n)}" aria-valuetext="${esc(rangeText(n, v))}" disabled ${attrs(n, path)}></label>`;
      }
      case 'range': {
        const [a, b] = words.ends(n);
        const ends = (i, name) => `<input type="range" class="av-in" value="${num(v[i])}" min="${num(a)}" max="${num(b)}" step="${step(n)}" aria-label="${esc(name)}" disabled>`;
        return field(n, path, `<div class="av-pair">${ends(0, tr('{label}, from', { label: n.label }))}${ends(1, tr('{label}, to', { label: n.label }))}</div><output class="av-out" data-unit="${esc(n.unit || '')}">${esc(rangeText(n, v))}</output>`, ' av-range');
      }
      case 'select': return `<label class="av-field">${label}<select class="av-in" disabled ${attrs(n, path)}><option value="">${tr('Choose')}</option>${n.options.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      case 'multi-select': return field(n, path, `<div class="av-opts">${options(n, path, ctx, 'checkbox', v)}</div>`);
      case 'radio': return field(n, path, `<div class="av-opts">${options(n, path, ctx, 'radio', v)}</div>`);
      case 'segmented': return field(n, path, `<div class="av-opts">${options(n, path, ctx, 'radio', v)}</div>`, ' av-seg');
      case 'checkbox': return `<label class="av-field av-check"><input type="checkbox" class="av-in"${checked(v)} disabled ${attrs(n, path)}><span>${esc(n.label)}</span></label>`;
      case 'toggle': return `<label class="av-field av-check av-toggle"><input type="checkbox" role="switch" class="av-in"${checked(v)} disabled ${attrs(n, path)}><span>${esc(n.label)}</span></label>`;
      case 'date': return `<label class="av-field">${label}<input type="date" class="av-in" value="${esc(v)}"${DAY.test(n.min || '') ? ` min="${esc(n.min)}"` : ''}${DAY.test(n.max || '') ? ` max="${esc(n.max)}"` : ''} disabled ${attrs(n, path)}></label>`;
      case 'time': return `<label class="av-field">${label}<input type="time" class="av-in" value="${esc(v)}" disabled ${attrs(n, path)}></label>`;
      case 'rating': {
        const max = Math.round(Math.min(Math.max(Number.isFinite(n.max) ? n.max : 5, 3), 10));
        const name = `av-${ctx.key}-${path.replace(/\./g, '-')}`;
        const star = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
        const stars = Array.from({ length: max }, (_, i) => `<label class="av-star"><input type="radio" class="av-in" name="${name}" value="${i + 1}"${checked(v === i + 1)} disabled><span class="sr-only">${esc(tr('{n} of {max}', { n: i + 1, max }))}</span>${star}</label>`).join('');
        return `<fieldset class="av-field av-rating" ${attrs(n, path)} data-max="${max}"><legend class="av-label">${esc(n.label)}</legend><div class="av-opts">${stars}</div></fieldset>`;
      }
      default: return unknown();
    }
  }
  // A button posts its `send` (200 characters at most), else its label; the page puts what it posts in data-say, so a view
  // that was sent can be told from the owner's next message. When it posts more than its label, the owner reads it on the
  // button before pressing, as text in the button (so a screen reader says it too): never a tooltip alone, which shows on
  // neither a touch screen nor the keyboard. The owner always sees exactly what is sent (ADR 265).
  const button = (n, path) => {
    const say = words.press(n), shown = words.shows(n);
    const inner = shown ? `<span class="av-btn-l">${esc(n.label)}</span><span class="av-btn-say">${esc(tr('Sends: {text}', { text: shown }))}</span>` : esc(n.label);
    return `<button type="button" class="btn av-btn t-${tone(n)}" disabled data-av-press="${path}" data-say="${esc(say)}">${inner}</button>`;
  };

  // ---------- the long tail (wave 3) ----------

  const locale = () => { try { return typeof I18n !== 'undefined' && I18n.locale ? I18n.locale : undefined; } catch { return undefined; } };
  const dayName = (iso, opts) => { try { return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { timeZone: 'UTC', ...opts }); } catch { return iso; } };

  // An outline as nested lists, each item as deep as AnswerText.outline allows.
  function tree(n) {
    const depths = AnswerText.outline(n.items.map((x) => x.depth));
    let html = '';
    n.items.forEach((x, i) => {
      const d = depths[i];
      if (i === 0) html += '<ul class="av-tree">';
      else if (d > depths[i - 1]) html += '<ul>';
      else { html += '</li>'; for (let k = depths[i - 1]; k > d; k--) html += '</ul></li>'; }
      html += `<li class="t-${tone(x)}"><span class="av-tree-t">${esc(x.text)}</span>${x.note ? `<small>${esc(x.note)}</small>` : ''}`;
    });
    html += '</li>'; for (let k = depths[depths.length - 1]; k > 0; k--) html += '</ul></li>'; html += '</ul>';
    return `<div class="av-block">${title(n.title)}${html}</div>`;
  }

  // A month as a table (a mark on the day that has an event, its events named for a screen reader) and its events as a list in date order.
  function calendar(n) {
    const m = AnswerText.month(n.month);
    const events = AnswerText.agenda(n.events || []);
    let grid = '';
    if (m) {
      const mm = String(m.month).padStart(2, '0');
      const heads = Array.from({ length: 7 }, (_, i) => `<th scope="col">${esc(dayName(`2024-01-0${i + 1}`, { weekday: 'short' }))}</th>`).join('');
      const cells = Array.from({ length: m.start }, () => '<td class="empty" aria-hidden="true"></td>');
      for (let d = 1; d <= m.days; d++) {
        const iso = `${m.year}-${mm}-${String(d).padStart(2, '0')}`;
        const here = events.filter((e) => e.date === iso);
        cells.push(here.length ? `<td class="has t-${tone(here[0])}"><span aria-hidden="true">${d}</span><span class="sr-only">${d}: ${esc(here.map((e) => e.title).join(', '))}</span></td>` : `<td class="day">${d}</td>`);
      }
      while (cells.length % 7) cells.push('<td class="empty" aria-hidden="true"></td>');
      const rows = Array.from({ length: cells.length / 7 }, (_, r) => `<tr>${cells.slice(r * 7, r * 7 + 7).join('')}</tr>`).join('');
      grid = `<table class="av-month"><caption>${esc(dayName(`${m.year}-${mm}-01`, { month: 'long', year: 'numeric' }))}</caption><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    const list = events.length ? `<ol class="av-agenda">${events.map((e) => `<li class="t-${tone(e)}">${AnswerText.realDay(e.date) ? `<time datetime="${esc(e.date)}">${esc(dayName(e.date, { day: 'numeric', month: 'short' }))}</time>` : `<span>${esc(e.date)}</span>`} ${esc(e.title)}</li>`).join('')}</ol>` : '';
    return `<div class="av-block av-cal">${title(n.title)}${grid}${list}</div>`;
  }

  // Columns of cards, side by side where there is room; it only shows them.
  function kanban(n) {
    const col = (c) => `<section class="av-col" aria-label="${esc(c.title)}"><h4>${esc(c.title)}<small> ${(c.cards || []).length}</small></h4>${(c.cards || []).length ? `<ul>${c.cards.map((x) => `<li class="t-${tone(x)}"><b>${esc(x.title)}</b>${x.text ? `<span>${esc(x.text)}</span>` : ''}</li>`).join('')}</ul>` : ''}</section>`;
    return `<div class="av-block">${title(n.title)}<div class="av-kanban">${n.columns.map(col).join('')}</div></div>`;
  }

  // A grid of numbers, each cell shaded by its share between the smallest and the biggest (--i, 0 to 1) and showing its number.
  function heatmap(n, ctx, path) {
    const shades = AnswerText.shade(n.values);
    const head = n.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('');
    const body = n.rows.map((r, i) => `<tr><th scope="row">${esc(r)}</th>${n.columns.map((_, j) => { const v = n.values[i]?.[j]; return Number.isFinite(v) ? `<td style="--i:${shades[i][j]}">${esc(num(v))}</td>` : '<td class="none"></td>'; }).join('')}</tr>`).join('');
    const drawing = `${n.title ? title(n.title, 'kit-chart-title') : ''}<div class="md-table"><table class="av-heat"><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    return figure(n, ctx, path, drawing, 'pb-card', 'group');
  }

  // A short bar with an icon and a word for its tone, so that it is not colour alone.
  function alert(n) {
    const t = TONES.includes(n.tone) ? n.tone : 'warn';
    const word = { good: tr('Done'), warn: tr('Warning'), bad: tr('Problem') }[t] || tr('Note');
    const icon = { good: '✓', warn: '!', bad: '!' }[t] || 'i';
    return `<div class="av-alert t-${t}" role="group" aria-label="${esc(word)}"><span class="av-alert-i" aria-hidden="true">${icon}</span><div>${n.title ? `<b>${esc(n.title)}</b>` : ''}${lines(n.text)}</div></div>`;
  }

  const countdown = (n) => {
    const left = words.countdown(n.to, Date.now());
    if (!left) return `<div class="av-countdown t-${tone(n)}"><span class="av-count-l">${esc(n.label)}</span><span class="av-count-n">${esc(n.to)}</span></div>`;
    tick();
    return `<div class="av-countdown t-${tone(n)}" role="timer" aria-label="${esc(n.label)}" data-av-count="${esc(n.to)}"><span class="av-count-l">${esc(n.label)}</span><time class="av-count-n">${esc(left.over ? tr('Time is up') : left.shows)}</time></div>`;
  };
  // Every countdown of the page is counted by one clock, on this device and nowhere else.
  let ticking = false;
  function tick() {
    if (ticking || typeof document === 'undefined' || typeof setInterval === 'undefined') return;
    ticking = true;
    setInterval(() => {
      if (document.hidden) return;
      $$('[data-av-count]').forEach((el) => {
        const left = words.countdown(el.dataset.avCount, Date.now());
        const out = el.querySelector('.av-count-n');
        const shown = left ? (left.over ? tr('Time is up') : left.shows) : null;
        if (out && shown != null && out.textContent !== shown) out.textContent = shown;
      });
    }, 1000);
  }

  // A poll's and a quiz's choices are buttons that post their own words (ADR 265), counted by the form's own rule (AnswerText.buttons).
  function poll(n, path) {
    const quiz = n.type === 'quiz';
    const correct = quiz && Number.isInteger(n.answer) && n.answer >= 0 && n.answer < n.options.length ? n.options[n.answer] : null;
    const choice = (o, i) => `<button type="button" class="btn av-btn av-choice t-neutral" disabled data-av-press="${path}.${i}" data-say="${esc(o)}">${esc(o)}</button>`;
    return `<div class="av-poll${quiz ? ' av-quiz' : ''}" role="group" aria-label="${esc(n.question)}"${correct !== null ? ` data-correct="${esc(correct)}"${n.explain ? ` data-explain="${esc(n.explain)}"` : ''}` : ''}><b class="av-q">${esc(n.question)}</b><div class="av-btns">${n.options.map(choice).join('')}</div>${correct !== null ? '<p class="av-reveal" role="status" hidden></p>' : ''}</div>`;
  }
  // What a quiz says of the choice that was sent: whether it was the right one and the answer's words; null while nothing was sent
  // that is one of its choices, and for a quiz that names no answer.
  function verdict(n, said) {
    if (!n.options.includes(said) || !Number.isInteger(n.answer) || n.answer < 0 || n.answer >= n.options.length) return null;
    const right = n.options[n.answer] === said;
    const first = right ? tr('Correct.') : tr('Not quite. The answer is {answer}.', { answer: n.options[n.answer] });
    return { right, text: n.explain ? `${first} ${n.explain}` : first };
  }

  // Where a file is, or '' when this reply is no bot's.
  function mediaBox(n, ctx, inner, fallback) {
    const src = address(n.src, ctx.botId);
    return src ? inner(src) : `<span class="av-missing">${esc(fallback)}</span>`;
  }

  // One node as HTML. path: where it stands in the tree, to tell the same kind of part apart (what the owner opened). A component bound
  // to a tile of the Board (#1630) is drawn from the tile's live values once the chat has them, from what the bot wrote before and
  // when it can't have them; its own box, `display: contents`, is what a live update swaps.
  function draw(n, ctx, path = '0') {
    if (!bound(n)) return drawNode(n, ctx, path);
    return `<div class="av-live" data-av-at="${path}">${drawNode(liveOf(ctx.key, path) || n, ctx, path)}</div>`;
  }
  function drawNode(n, ctx, path) {
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
      case 'tree': return tree(n);
      case 'calendar': return calendar(n);
      case 'kanban': return kanban(n);
      case 'alert': return alert(n);
      case 'empty-state': return `<div class="av-empty"><b>${esc(n.title)}</b>${n.text ? `<span>${esc(n.text)}</span>` : ''}${(n.children || []).length ? `<div class="av-btns" role="group">${kids(n, ctx, path)}</div>` : ''}</div>`;
      case 'countdown': return countdown(n);
      case 'poll': case 'quiz': return poll(n, path);
      case 'callout': return `<div class="kit-callout ${LEVEL[tone(n)]}">${n.title ? `<b>${esc(n.title)}</b>` : ''}<div>${lines(n.text)}</div></div>`;

      case 'chart': return chart(n, ctx, path);
      case 'pie': return pie(n, ctx, path);
      case 'scatter': return scatter(n, ctx, path);
      case 'histogram': return histogram(n, ctx, path);
      case 'sparkline': return sparkline(n, ctx, path);
      case 'gauge': return gauge(n, ctx, path);
      case 'heatmap': return heatmap(n, ctx, path);

      case 'image': return `<figure class="av-figure">${picture(n.src, n.alt, ctx.botId)}${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ''}</figure>`;
      case 'gallery': return `<div class="av-gallery">${n.items.map((x) => `<figure class="av-figure">${picture(x.src, x.alt, ctx.botId)}${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
      case 'video': return `<figure class="av-figure">${mediaBox(n, ctx, (src) => `<video controls preload="metadata" playsinline aria-label="${esc(n.alt)}" src="${esc(src)}"></video>`, n.alt)}${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ''}</figure>`;
      case 'audio': return `<figure class="av-figure av-audio"><figcaption>${esc(n.title)}</figcaption>${mediaBox(n, ctx, (src) => `<audio controls preload="none" aria-label="${esc(n.title)}" src="${esc(src)}"></audio>`, tr("Can't play this here"))}</figure>`;
      case 'file': { const name = n.title || n.src.path.split('/').pop(); return mediaBox(n, ctx, (src) => `<a class="av-file" href="${esc(src)}" download="${esc(n.src.path.split('/').pop())}">${FILE_ICON}<span>${esc(name)}</span></a>`, name); }
      case 'link-card': return linkCard(n);
      case 'products': return products(n, ctx);

      case 'text-input': case 'textarea': case 'number': case 'slider': case 'range': case 'select': case 'multi-select': case 'radio': case 'checkbox':
      case 'toggle': case 'date': case 'time': case 'rating': case 'segmented': return input(n, ctx, path);
      case 'button': return button(n, path);
      case 'button-group': return `<div class="av-btns" role="group"${n.label ? ` aria-label="${esc(n.label)}"` : ''}>${kids(n, ctx, path)}</div>`;
      case 'link': return `<a class="btn av-ln" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.label)}<span class="sr-only"> (${tr('opens in a new tab')})</span></a>`;
      case 'copy': return `<button type="button" class="btn av-copy" data-av-copy="${esc(n.text)}">${esc(n.label)}</button>`;
      default: return unknown();
    }
  }

  // One view: the fence's alt names it for a screen reader.
  function html(v, botId = '') {
    const key = hash(JSON.stringify(v));
    if (v.root.type === 'unknown') return `${altLine(v.alt)}${unknown()}`;
    const act = words.fields(v.root).length ? 'form' : words.buttons(v.root).length ? 'press' : '';
    if (act) { trees.delete(key); trees.set(key, v.root); if (trees.size > 300) trees.delete(trees.keys().next().value); }
    // A form has one Send; the line under it says what was sent, once something was.
    const tail = act ? `${act === 'form' ? `<div class="av-actions"><button type="button" class="btn primary av-send" data-av-send disabled>${tr('Send')}</button></div>` : ''}<p class="av-sent" role="status" hidden></p>` : '';
    const live = boundIn(v.root).length > 0;
    if (live) { written.delete(key); written.set(key, { root: v.root, botId }); if (written.size > 300) written.delete(written.keys().next().value); }
    return `<div class="av" role="group" aria-label="${esc(v.alt)}" data-av="${key}"${act ? ` data-av-act="${act}"` : ''}${live ? ' data-av-live' : ''}>${draw(v.root, { botId, key })}${tail}</div>`;
  }
  const trees = new Map(); // a view's key -> its tree, for the views that can be sent (what the page needs to read a form)
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
      const text = mdParts(mdBlocks(!done && i === all.length - 1 ? draftSource(p.text) : p.text), botId);
      return botId ? text.map((h) => linkPaths(h, botId)) : text; // the paths of a bot's text open in the viewer, as in any reply
    });
  }

  // ---------- live numbers from the Board (#1630, ADR 264 amendment, ADR 071) ----------

  // A kpi, gauge, sparkline, chart or table may name a tile (`tile`, with `bind`): the tile is its source, its logins, its scripts, the
  // owner's OK on a script and its refresh. The view keeps the values it was written with, which show first and which Copy, a room and
  // every other reader see; an open chat then asks botdot for the tile's values (POST /dashboard/live, as a page's blocks are filled
  // in) and draws them over the written ones, again when the live feed says a tile changed. No polling of its own. A tile that is
  // gone, waits for the owner or can't be read leaves the written values, with no error.
  const BOUND = ['kpi', 'gauge', 'sparkline', 'chart', 'table'];
  const bound = (n) => BOUND.includes(n.type) && typeof n.tile === 'string' && n.tile !== '';
  // The nodes of a tree that bind, with their paths (the paths draw() gives them).
  function boundIn(n, path = '0', out = []) {
    if (bound(n)) out.push({ path, node: n });
    (n.children || []).forEach((c, i) => boundIn(c, `${path}.${i}`, out));
    return out;
  }
  let ask = null; // the page's api(), once the server says `ui-live`
  const written = new Map(); // a view's key -> { root, botId }: the tree as it was written, for the views that bind
  const filled = new Map(); // a view's key -> { at, nodes: { path: the node with the tile's values }, tiles: [ids] }
  const asking = new Set();
  const STALE = 20000; // a chat drawn again within this long of an answer asks nothing new
  const liveOf = (key, path) => (filled.get(key) ? filled.get(key).nodes[path] || null : null);

  async function fetchLive(key) {
    const w = written.get(key);
    if (!ask || !w || asking.has(key)) return;
    asking.add(key);
    try {
      const list = boundIn(w.root);
      const r = await ask('/dashboard/live', { method: 'POST', body: { ...(w.botId ? { bot: w.botId } : {}), nodes: list.map((x) => x.node) } });
      if (!r || !Array.isArray(r.nodes)) return;
      const nodes = {};
      list.forEach((x, i) => { if (r.nodes[i] && r.nodes[i].type === x.node.type) nodes[x.path] = r.nodes[i]; });
      filled.delete(key);
      filled.set(key, { at: Date.now(), nodes, tiles: Array.isArray(r.tiles) ? r.tiles : [] });
      if (filled.size > 300) filled.delete(filled.keys().next().value);
      repaintLive(key);
    } catch { /* the written values stay */ } finally { asking.delete(key); }
  }
  // Each place a view is drawn: only the boxes of its bound components are drawn again, so what the owner typed and opened stays.
  function repaintLive(key) {
    const w = written.get(key);
    if (!w || typeof document === 'undefined') return;
    const ctx = { botId: w.botId, key };
    const nodes = boundIn(w.root);
    for (const av of $$(`.av[data-av="${key}"]`)) {
      for (const box of $$('.av-live', av)) {
        const at = nodes.find((x) => x.path === box.dataset.avAt);
        if (!at) continue;
        const html = drawNode(liveOf(key, at.path) || at.node, ctx, at.path);
        if (box.innerHTML !== html) box.innerHTML = html;
      }
      wire(av);
    }
  }
  // The views of a chat that are due: those never asked, or asked longer ago than STALE.
  function liveScan(root) {
    if (!ask || !root || typeof document === 'undefined') return;
    const views = [...(root.matches && root.matches('.av[data-av-live]') ? [root] : []), ...$$('.av[data-av-live]', root)];
    for (const av of views) {
      if (!chatOf(av)) continue; // a chat of the owner's only: a room and a document show the written values
      const key = av.dataset.av;
      const got = filled.get(key);
      if (got) repaintLive(key); // what the chat has already: at once, before the answer
      if (!got || Date.now() - got.at > STALE) fetchLive(key);
    }
  }
  // The live feed says a tile changed (no id: the Board did): the views in the open chat that read it ask again.
  function tileChanged(id) {
    if (!ask || typeof document === 'undefined') return;
    const keys = new Set($$('.av[data-av-live]').filter((av) => chatOf(av)).map((av) => av.dataset.av));
    for (const key of keys) {
      const got = filled.get(key);
      if (got && id && !got.tiles.includes(id)) continue;
      fetchLive(key);
    }
  }

  // ---------- sending from a view (wave 2, ADR 265) ----------

  const lineOf = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
  // What a view said it sent, read from the owner's message that follows it: `next` is its text (or null: none follows), `says`
  // what its buttons post, `labels` the labels of its inputs. The message itself when it is one of the buttons' words, or has a
  // line "Label: …" for every input; else null. This is how a view stays "Sent" when the chat is drawn again or opened later,
  // with nothing kept but the chat's own messages.
  function sentFrom(next, { says = [], labels = [] } = {}) {
    if (next == null) return null;
    const t = lineOf(next);
    if (!t) return null;
    if (says.some((x) => lineOf(x) === t)) return t;
    const lines = t.split('\n');
    return labels.length && labels.every((l) => lines.some((x) => x.startsWith(`${l}: `))) ? t : null;
  }
  // What a view has sent, from the chat first: `mine` are the texts of the owner's messages after the view (up to the next bot message,
  // a waiting one included), `pending` what this page posted that the chat may not show yet. The chat is the truth: once it shows the
  // message the post is forgotten, so a message the owner takes back opens the view again. A post counts only until the chat shows it
  // (it is on its way, not yet drawn as a bubble). → { sent: the text or null, pending: what is still not shown (or null) }.
  function sendOf({ mine = [], says = [], labels = [], pending = null }) {
    const shown = mine.map((t) => sentFrom(t, { says, labels })).find((t) => t != null) || null;
    if (shown != null) return { sent: shown, pending: null };
    return { sent: pending ?? null, pending: pending ?? null };
  }
  // The text an owner's bubble holds: the message as it was written, from its data-text (every owner bubble carries it, escaped), since
  // the drawn bubble is not that text: an @mention is a chip without its "@" and a leading /command a mark. The drawn text only
  // when the bubble has none.
  const textOf = (b) => (b.dataset && b.dataset.text != null ? b.dataset.text : ($('.clamp', b) || b).textContent);
  // The id of the newest bot message a chat's views answer: the last one that is whole, from the bot to the owner. A reply still
  // being written, a failed one and a message between bots are not. bubbles: [{ from: 'bot' | 'me', id, working?, problem?, folded? }].
  function newest(bubbles) {
    const live = bubbles.filter((b) => b.from === 'bot' && !b.working && !b.problem && !b.folded);
    return live.length ? live[live.length - 1].id : null;
  }
  // newest: this is the newest bot message; sent: what was sent from it (sentFrom), or null.
  const stateOf = ({ newest: latest, sent }) => (sent != null ? { state: 'sent', said: sent } : latest ? { state: 'open' } : { state: 'closed' });

  // The value of an input, as the form's text reads it (AnswerText.valueOf's `raw`).
  function read(el) {
    const kind = el.dataset.kind;
    const ins = (sel) => [...el.querySelectorAll(sel)];
    switch (kind) {
      case 'range': return ins('input').map((i) => Number(i.value));
      case 'multi-select': return ins('input:checked').map((i) => i.value);
      case 'radio': case 'segmented': return ins('input:checked').map((i) => i.value)[0] ?? '';
      case 'rating': return Number(ins('input:checked').map((i) => i.value)[0] || 0);
      case 'checkbox': case 'toggle': return !!el.checked;
      case 'slider': return Number(el.value);
      case 'number': return el.value.trim() === '' ? '' : Number(el.value);
      default: return el.value;
    }
  }
  const chats = new WeakMap(); // a chat's element -> its send: (text, key) => Promise<boolean>
  const watchers = new WeakMap();
  const chatOf = (el) => { for (let e = el.parentElement; e; e = e.parentElement) if (chats.has(e)) return e; return null; };

  // Open, close and mark each view of a chat: the newest bot message's can be sent, the others are read-only, and a view that was
  // sent says "Sent: …" with what it sent.
  function settle(root) {
    const views = $$('.av[data-av-act]', root);
    if (!views.length) return;
    const all = $$('.bubble.from-bot, .bubble.from-me', root);
    const items = all.map((b, i) => ({ from: b.classList.contains('from-me') ? 'me' : 'bot', id: i, working: !!b.closest('[data-live], [data-pending]'), problem: b.classList.contains('problem'), folded: !!b.closest('.notes-fold') }));
    const latest = newest(items);
    const seen = new Set();
    for (const av of views) {
      // The same view twice in a chat (a bot asked again) must not share its radio groups: the later one gets its own names.
      if (seen.has(av.dataset.av) && !av._avNamed) { av._avNamed = true; $$('input[type="radio"]', av).forEach((r) => { r.name = `${r.name}-${views.indexOf(av)}`; }); }
      seen.add(av.dataset.av);
      const at = all.indexOf(av.closest('.bubble.from-bot'));
      // Every owner message between this view and the next bot message may be its send: the owner can write something else
      // first and press the button after, and the view must stay sent on the next redraw.
      const after = at < 0 ? [] : all.slice(at + 1);
      const upTo = after.findIndex((b) => b.classList.contains('from-bot'));
      const mine = (upTo < 0 ? after : after.slice(0, upTo)).filter((b) => b.classList.contains('from-me'));
      const says = $$('[data-av-press]', av).map((b) => b.dataset.say);
      const labels = $$('[data-av-in][data-label]', av).map((f) => f.dataset.label);
      const { sent, pending } = sendOf({ mine: mine.map(textOf), says, labels, pending: av._avSent });
      av._avSent = pending; // the chat shows it now, or it is still on its way
      paint(av, stateOf({ newest: at >= 0 && at === latest, sent }));
    }
  }
  // What a poll or a quiz shows once its choice was sent: the choice that went is marked (not by colour alone: it is pressed), and a
  // quiz says whether it was right. Open again, or never sent: nothing marked, nothing said.
  function mark(av, { state, said }) {
    for (const box of $$('.av-poll', av)) {
      const choices = $$('[data-av-press]', box);
      const out = $('.av-reveal', box);
      const sent = state === 'sent';
      const v = sent && out ? verdict({ options: choices.map((c) => c.dataset.say), answer: choices.findIndex((c) => c.dataset.say === box.dataset.correct), explain: box.dataset.explain }, said) : null;
      for (const c of choices) {
        const went = sent && c.dataset.say === said;
        if (sent) c.setAttribute('aria-pressed', String(went)); else c.removeAttribute('aria-pressed');
        const result = v && ((went && (v.right ? 'right' : 'wrong')) || (!v.right && c.dataset.say === box.dataset.correct && 'right'));
        if (result) c.setAttribute('data-result', result); else c.removeAttribute('data-result');
      }
      if (out) { out.hidden = !v; out.textContent = v ? v.text : ''; }
    }
  }
  function paint(av, { state, said }) {
    mark(av, { state, said });
    const off = state !== 'open' || !!av._avBusy;
    $$('.av-in, [data-av-press], [data-av-send]', av).forEach((c) => { if (c.disabled !== off) c.disabled = off; });
    av.dataset.avState = state;
    const line = $('.av-sent', av);
    if (!line) return;
    const shown = state === 'sent' ? tr('Sent: {text}', { text: said }) : state === 'closed' ? tr('Not sent') : '';
    if (line.textContent !== shown) line.textContent = shown;
    if (line.hidden !== !shown) line.hidden = !shown;
  }
  // The chat's own send takes the views' messages: send(text, key) -> Promise<boolean>, as for a quick answer. Called whenever the
  // chat is drawn again; the views are settled at once and again whenever the chat changes (the owner's bubble arrives, a reply).
  function wireChat(root, send) {
    if (!view || !root) return;
    chats.set(root, send);
    settle(root);
    liveScan(root);
    if (typeof MutationObserver === 'undefined') return;
    const has = !!root.querySelector('.av[data-av-act]');
    let w = watchers.get(root);
    if (!has) { if (w) { w.obs.disconnect(); watchers.delete(root); } return; }
    if (w) return;
    w = { obs: null, queued: false };
    w.obs = new MutationObserver(() => {
      if (w.queued) return;
      w.queued = true;
      setTimeout(() => { w.queued = false; settle(root); }, 0);
    });
    w.obs.observe(root, { childList: true, subtree: true });
    watchers.set(root, w);
  }
  // Post a view's message through the chat; the view waits until it went, and stays read-only after: a view is sent once. What went is
  // kept in _avSent only until the chat shows the message (sendOf); a failed send keeps nothing, and a taken-back one opens the view.
  async function post(av, text, send) {
    if (!text || av._avBusy || av.dataset.avState !== 'open') return;
    if (av._avLast?.text !== text) av._avLast = { text, key: messageKey() }; // the same text again is the same message
    av._avBusy = true;
    paint(av, { state: 'open' });
    let went = false;
    try { went = await send(text, av._avLast.key, null); } finally { av._avBusy = false; }
    if (went) { av._avSent = text; typed.forEach((_, k) => { if (k.startsWith(`${av.dataset.av}.`)) typed.delete(k); }); }
    if (av.isConnected) { const chat = chatOf(av); if (chat) settle(chat); else paint(av, went ? { state: 'sent', said: text } : { state: 'open' }); }
  }
  const values = (av) => Object.fromEntries($$('[data-av-in]', av).map((f) => [f.dataset.avIn, read(f)]));

  // The tooltips of the charts drawn under `root`, once each.
  function wire(root) {
    $$('.av .kit-plot[data-chart]:not([data-wired])', root).forEach((el) => {
      el.dataset.wired = '1';
      wireCharts(el.parentElement);
    });
    liveScan(root); // the numbers of a view that binds to a tile
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
    // A button, or a form's Send: one ordinary message of the owner's, through the chat's own send.
    document.addEventListener('click', (e) => {
      const press = e.target.closest?.('[data-av-press]');
      const sendBtn = e.target.closest?.('[data-av-send]');
      const b = press || sendBtn;
      if (!b) return;
      const av = b.closest('.av');
      const chat = av && chatOf(av);
      const send = chat && chats.get(chat);
      const tree = av && trees.get(av.dataset.av);
      if (!send || !tree || b.disabled) return;
      post(av, press ? press.dataset.say : words.form(tree, values(av)), send);
    });
    // Copy copies its text; it is no send, and works on an older view too.
    document.addEventListener('click', async (e) => {
      const b = e.target.closest?.('[data-av-copy]');
      if (!b) return;
      if (!(await copyText(b.dataset.avCopy))) return toast(tr("Couldn't copy"), true);
      // The label is kept once, so a second tap within the 1.5 s never stores "Copied" as the label.
      if (b.dataset.avLabel == null) b.dataset.avLabel = b.textContent;
      b.textContent = tr('Copied');
      clearTimeout(b._avCopied);
      b._avCopied = setTimeout(() => { b.textContent = b.dataset.avLabel; }, 1500);
    });
    // What the owner set stays when the chat is drawn again; a slider says its number; a range keeps its ends in order.
    document.addEventListener('input', (e) => {
      const el = e.target;
      const f = el.closest?.('.av [data-av-in]');
      if (!f) return;
      if (f.dataset.kind === 'range') {
        const [a, b] = [...f.querySelectorAll('input')];
        if (Number(a.value) > Number(b.value)) { if (el === a) b.value = a.value; else a.value = b.value; }
      }
      if (f.dataset.kind === 'slider' || f.dataset.kind === 'range') {
        const out = (f.dataset.kind === 'slider' ? f.closest('label') : f).querySelector('output');
        const v = read(f);
        out.textContent = (Array.isArray(v) ? tr('{from} to {to}', { from: num(v[0]), to: num(v[1]) }) : num(v)) + (out.dataset.unit ? ` ${out.dataset.unit}` : '');
        if (f.dataset.kind === 'slider') f.setAttribute('aria-valuetext', out.textContent);
      }
      const av = f.closest('.av');
      if (typed.size > 300) typed.clear();
      typed.set(`${av.dataset.av}.${f.dataset.avIn}`, read(f));
    });
    // Enter in a one-line box goes to the next input, and from the last one sends (as a card of questions does); a phone's Enter is a new line.
    document.addEventListener('keydown', (e) => {
      const el = e.target;
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || el.tagName !== 'INPUT' || !['text', 'number', 'date', 'time'].includes(el.type) || matchMedia('(pointer: coarse)').matches) return;
      const av = el.closest?.('.av[data-av-act="form"]');
      if (!av || av.dataset.avState !== 'open') return;
      e.preventDefault();
      const boxes = $$('input.av-in, textarea.av-in, select.av-in', av).filter((x) => !x.disabled);
      const at = boxes.indexOf(el);
      if (boxes[at + 1]) boxes[at + 1].focus(); else $('[data-av-send]', av)?.click();
    });
    // A picture that can't be had leaves its place, with the words that say what it shows.
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (img?.tagName === 'IMG' && img.parentElement?.classList.contains('av-img')) img.remove();
    }, true);
  }

  return {
    use, load, ready, has, parts, html, wire, wireChat, tileChanged, sentFrom, sendOf, textOf, newest, stateOf, verdict, mark,
    alt: (src, opts) => (words ? words.alt(src, opts) : String(src ?? '')),
    text: (src, opts) => (words ? words.text(src, opts) : String(src ?? '')),
  };
})();
