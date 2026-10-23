// ---------- the Board ----------

// Tiles the Chief put together (lib/dashboard.js): switches, buttons, values, lists and notes, or tiles
// built from blocks. The server sends each tile's look filled in (dot, face, panel, tap); this only draws it.
// Values are read again while this page is open; new ones arrive on the live feed.
const tileScripts = (t) => [t.read, t.do, t.turnOn, t.turnOff, ...Object.values(t.reads || {}), ...Object.values(t.actions || {})].filter((x) => x?.type === 'script').map((x) => x.script);
// A group has no bot of its own: it takes the colour of the bot whose tiles are in it (the Chief's when they're mixed).
const tileColor = (t) => t.color || botById(t.bot || groupBot(t))?.color || CHIEF_COLOR;
function groupBot(t) {
  if (t.kind !== 'group') return null;
  const owners = new Set((state.dash?.tiles || []).filter((x) => x.parent === t.id && x.bot).map((x) => x.bot));
  return owners.size === 1 ? [...owners][0] : null;
}
// The tiles of the Board that the list's strip and the keypad's line show: those at its top, approved. A tile's mark
// is its dot (filled when a switch is on).
// Whether this server takes a choice of them (#447).
const canHome = () => (state.features || []).includes('home-tiles');
// With `home` from the server (#447): the tiles chosen for home, in their order; from an older one, every tile at the top.
function boardTiles() {
  const tiles = state.dash?.tiles || [];
  if (!Array.isArray(state.dash?.home)) return tiles.filter((t) => !t.parent && t.approved !== false);
  const byId = new Map(tiles.map((t) => [t.id, t]));
  return state.dash.home.map((id) => byId.get(id)).filter(Boolean);
}
const tileMark = (t) => { const dot = t.look?.dot; return `<i${dot && dot.filled !== true ? ' class="off"' : ''} style="--c:${tintOf(dot?.color, t)}"></i>`; };
const BOARD_EMPTY = '<span class="none"><b>Board</b> · Nothing on it yet</span>';
// The strip at the top of the list: each tile's dot and name, and a value's value (a switch's dot is filled
// when it's on). As many as fit; a tap opens the Board. With no tile to show, it says so beside the Board's
// name. Not there until the Board has loaded.
function dashStrip() {
  if (!state.dash) return '';
  const tile = (t) => `<span class="t">${tileMark(t)}${esc(t.title)}${t.look?.short ? ` <b>${esc(t.look.short)}</b>` : ''}</span>`;
  return `<button class="dash-strip ${state.view === 'dashboard' ? 'active' : ''}" data-contact="dashboard" title="Board">
    <svg class="board-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>
    <span class="tiles">${boardTiles().map(tile).join('') || BOARD_EMPTY}</span><span class="more">›</span></button>`;
}
// The tiles that don't fit whole are left out, not cut off.
function fitStrip() {
  const row = $('#contacts .dash-strip .tiles');
  if (!row) return;
  const ts = $$('.t', row);
  ts.forEach((t) => (t.hidden = false));
  const end = row.getBoundingClientRect().right;
  let full = false;
  for (const t of ts) if (full || (full = t.getBoundingClientRect().right > end + 0.5)) t.hidden = true;
}
new ResizeObserver(() => fitStrip()).observe($('#contacts')); // a wider or narrower list, or the list shown again

let dashLoading = null;
function loadDash(quiet = false) {
  if (dashLoading) return dashLoading;
  dashLoading = api(quiet ? '/dashboard?quiet' : '/dashboard/refresh', quiet ? {} : { method: 'POST' }).then((d) => { state.dash = d; renderContacts(); showNeeds(); drawHomePick(); if (state.view === 'dashboard') renderDashboard(); })
    .catch(() => {}).finally(() => { dashLoading = null; });
  return dashLoading;
}
// While it's on screen, the stale tiles are read again every little while. Elsewhere the strip over the list is
// looked at again once a minute, so a tile's "5 minutes ago" moves on, and on coming back to the page at once.
let dashTicks = 0;
setInterval(() => {
  if (document.hidden) return;
  dashTicks += 1;
  if (state.view === 'dashboard') loadDash();
  else if (dashTicks % 4 === 0) loadDash(true);
}, 15_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDash(state.view !== 'dashboard'); });

const LEVEL = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--err)' };
const TINT = { ...LEVEL, faint: 'var(--faint)', muted: 'var(--muted)', text: 'var(--text)' };
// Words take ok's and warn's text shades, which pass 4.5:1 where the dots' colours don't.
const TEXT_TINT = { ...TINT, ok: 'var(--ok-text)', warn: 'var(--warn-text)' };
// A colour from a tile's look: "#rrggbb", a theme name, or none (the tile's own colour).
const tintOf = (c, t, words = false) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : (words ? TEXT_TINT : TINT)[c] || esc(tileColor(t)));
const tapped = new Map(); // tile id → "Asked" and the like, for a moment after a tap
const popped = new Set(); // tiles whose tap just worked: the card pops once, no words

const dotHTML = (d, t) => (d ? `<i class="tile-dot ${d.big ? 'big' : ''} ${d.filled === false ? 'off' : d.filled == null ? 'unknown' : ''}" style="--c:${tintOf(d.color, t)}"></i>` : '');

// A tile's blocks (see lib/tile-blocks.js). where: "face" (on the tile) or "panel" (its pop-up).
function blocksHTML(list, t, where) {
  return (list || []).map((b) => blockHTML(b, t, where)).join('');
}
function blockHTML(b, t, where) {
  const faint = '<div class="faint">·</div>';
  const ctl = (kind) => `data-ctl="${esc(b.key)}" data-ctl-kind="${kind}"`;
  switch (b.type) {
    case 'text':
      if (!b.text) return faint;
      if (b.markdown) return `<div class="tile-note md ${b.lines ? 'folded' : ''} ${b.size || ''} ${b.muted ? 'muted' : ''}" ${b.lines ? `style="--lines:${b.lines}"` : ''}>${md(b.text)}</div>`;
      return `<div class="b-text ${b.size || ''} ${b.muted ? 'muted' : ''} ${b.lines ? 'clamp' : ''}" ${b.lines ? `style="--lines:${b.lines}"` : ''}>${esc(b.text)}</div>`;
    case 'value':
      // With its recent values (a value tile's own number): drawn as a kpi, its change and a sparkline beside it.
      if (b.points?.length >= 2 || b.delta) return kitKpi(b, tintOf(b.color, t), (c) => tintOf(c, t, true));
      return b.text ? `<div class="tile-val" ${b.color ? `style="color:${tintOf(b.color, t, true)}"` : ''}>${esc(b.text)}${b.unit ? `<span class="unit">${esc(b.unit)}</span>` : ''}</div>` : `<div class="tile-val">${faint}</div>`;
    case 'kpi':
      return kitKpi(b, tintOf(b.color, t), (c) => tintOf(c, t, true));
    case 'status':
      return kitStatus(b);
    case 'callout':
      return kitCallout(b);
    case 'dot':
      return `<span class="b-dot">${dotHTML(b, t)}${b.label ? `<span>${esc(b.label)}</span>` : ''}</span>`;
    case 'list':
      return b.items.length ? `<ul class="tile-list">${b.items.slice(0, b.max).map((l) => `<li>${esc(l)}</li>`).join('')}${b.items.length > b.max ? '<li class="faint">…</li>' : ''}</ul>` : faint;
    case 'progress':
      return `<div class="b-progress"><div class="bar"><i style="width:${Math.round((b.ratio ?? 0) * 100)}%;--c:${tintOf(b.color, t)}"></i></div>${b.text ? `<span>${esc(b.text)}</span>` : ''}</div>`;
    case 'gauge': {
      const arc = 'M 8 48 A 40 40 0 0 1 88 48';
      return `<div class="b-gauge"><svg viewBox="0 0 96 54" aria-hidden="true"><path d="${arc}" class="track" pathLength="100"/><path d="${arc}" class="fill" pathLength="100" stroke-dasharray="${Math.round((b.ratio ?? 0) * 100)} 100" style="--c:${tintOf(b.color, t)}"/></svg><span>${esc(b.text || '·')}</span></div>`;
    }
    case 'chart':
      // A small tile's face has no room for the axes' numbers; the tooltip says them.
      return kitChart(b, tintOf(b.color, t), (c) => tintOf(c, t), { axes: where === 'panel' || (t.size && t.size !== 'small') });
    case 'table':
      return kitTable(b, `${t.id}:${where}:${b.key}`);
    case 'image':
      return `<img class="b-img ${b.height || 'normal'} ${b.fit || 'cover'}" src="/api${esc(b.src)}" alt="" loading="lazy" draggable="false">`;
    case 'chat': {
      const bot = botById(t.bot);
      return bot ? `<button class="link-btn tile-chat" data-tile-chat>${b.label ? esc(b.label) : botLabel(bot)} ›</button>` : '';
    }
    case 'switch':
      return `<label class="b-switch" data-ctl-wrap>${b.label ? `<span>${esc(b.label)}</span>` : ''}<span class="switch"><input type="checkbox" ${b.on ? 'checked' : ''} ${ctl('switch')} aria-label="${esc(b.label || t.title)}"><span></span></span></label>`;
    case 'button':
      return `<button class="btn sm b-btn" ${ctl('button')}>${esc(b.label)}</button>`;
    case 'slider': {
      const v = b.value ?? b.min;
      return `<label class="b-slider ${b.value == null ? 'unset' : ''}" data-ctl-wrap><span class="lbl">${b.label ? `<span>${esc(b.label)}</span>` : ''}<b data-show>${b.value == null ? '·' : esc(sliderText(b, b.value))}</b></span><input type="range" min="${b.min}" max="${b.max}" step="${b.step}" value="${v}" ${ctl('slider')} aria-label="${esc(b.label || t.title)}"></label>`;
    }
    case 'color':
      if (where === 'face') return `<button class="b-swatch" ${ctl('color-open')} style="--c:${b.value || 'var(--line-2)'}" aria-label="${esc(b.label || 'Colour')}"></button>`;
      return `<div class="b-color" data-ctl-wrap>${b.label ? `<span class="lbl">${esc(b.label)}</span>` : ''}<div class="wheel" ${ctl('color')} role="slider" aria-label="${esc(b.label || 'Colour')}" tabindex="0">${b.value ? `<i class="mark" style="${wheelSpot(b.value)};--c:${b.value}"></i>` : ''}</div></div>`;
    case 'choice':
      return `<div class="b-choice" data-ctl-wrap>${b.label ? `<span class="lbl">${esc(b.label)}</span>` : ''}<div class="seg">${b.options.map((o) => `<button class="${String(o.value) === String(b.value) ? 'on' : ''}" ${ctl('choice')} data-v="${esc(JSON.stringify(o.value))}">${esc(o.label)}</button>`).join('')}</div></div>`;
    case 'row':
      return `<div class="b-row">${blocksHTML(b.blocks, t, where)}</div>`;
    case 'column':
      return `<div class="b-col">${blocksHTML(b.blocks, t, where)}</div>`;
    default:
      return '';
  }
}
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const sliderText = (b, v) => (b.percent ? `${Math.round(((v - b.min) / (b.max - b.min)) * 100)} %` : `${fmtNum(v)}${b.unit ? ` ${b.unit}` : ''}`);

// The colour wheel: hue around it (red at the right, going clockwise), white in the middle. Brightness is a slider of its own.
function hsvHex(h, s) {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
function hexHs(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0 };
}
function wheelSpot(hex) {
  const { h, s } = hexHs(hex);
  const a = (h * Math.PI) / 180;
  return `left:${(50 + Math.cos(a) * s * 50).toFixed(1)}%;top:${(50 + Math.sin(a) * s * 50).toFixed(1)}%`;
}

// A tile whose face is one number (a value or a kpi) has a kpi's head: its dot a small square beside its title,
// muted. A small one takes half a phone's width.
const isKpiTile = (t) => t.kind !== 'group' && (t.look?.face || []).length === 1 && ['value', 'kpi'].includes(t.look.face[0].type);
// Switches and buttons as they come (no blocks of their own) are rows of one Controls box.
const isControlRow = (t) => ['switch', 'button'].includes(t.kind) && !(t.look?.face || []).length && (t.size || (t.wide ? 'wide' : 'small')) === 'small';
const hasMarkdown = (list) => (list || []).some((b) => (b.type === 'text' && b.markdown) || hasMarkdown(b.blocks));

// sourced: its heading already says where its values come from.
function tileHTML(t, waiting, sourced = false) {
  const look = t.look || { dot: { filled: true }, face: [], tap: 'none' };
  let dot = dotHTML(look.dot, t);
  let body = blocksHTML(look.face, t, 'face');
  // A group: one dot per tile inside (filled when on, in its own colour).
  if (t.kind === 'group') {
    const inside = (state.dash?.tiles || []).filter((x) => x.parent === t.id);
    dot = '';
    body = `<div class="group-dots">${inside.map((x) => {
      const d = x.look?.dot;
      return `<i class="${d && d.filled !== true ? 'off' : ''}" style="--c:${tintOf(d?.color, x)}"></i>`;
    }).join('') || '<span class="faint">·</span>'}</div>`;
  }
  const note = waiting ? 'Waiting for your OK' : tapped.get(t.id) || (t.error ? "Couldn't update" : '');
  const pressed = look.tap === 'toggle' ? ` aria-pressed="${look.dot?.filled === true}"` : '';
  const open = t.kind === 'group' && openGroups.has(t.id);
  const size = t.size || (t.wide ? 'wide' : 'small');
  const kpi = isKpiTile(t);
  // Quietly at the end of its head: that a bot or the Chief wrote it, or how long ago it last read its value
  // ("1 min ago"; where it reads from stays in its title). A note says when it was written.
  const aside = t.ai && hasMarkdown(look.face) ? '<span class="tile-ai">written by AI</span>' : t.source && !kpi && !sourced ? ageHTML(Date.parse(t.at || '') || 0, t.source) : '';
  const when = t.kind === 'note' && t.at ? `<span class="tile-when">${esc(kitClock(Date.parse(t.at)))}</span>` : '';
  return `<div role="button" tabindex="0" class="tile kind-${t.kind} size-${size} ${kpi ? 'kpi-tile' : ''} ${kpi && size === 'small' ? 'compact' : ''} ${look.dot?.big ? 'big-dot' : ''} ${waiting ? 'waiting' : ''} ${open ? 'open' : ''} ${popped.has(t.id) ? 'pop' : ''}" data-tile="${esc(t.id)}"${pressed}${t.kind === 'group' ? ` aria-expanded="${open}"` : ''} title="${esc(t.error || '')}">
    <div class="tile-head">${dot}<span class="tile-title">${esc(t.title)}</span>${when}${aside}${PEN_BTN()}</div>
    ${body}
    ${note ? `<div class="tile-sub">${esc(note)}</div>` : ''}
  </div>`;
}

// The pencil on a tile (#430), shown on hover: it opens the ask for a change. Only when the server takes one.
const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const canAsk = () => (state.features || []).includes('tile-change');
const PEN_BTN = () => (canAsk() ? `<button type="button" class="tile-edit" data-tile-edit aria-label="Change">${PEN}</button>` : '');

// A switch or a button as a row of the Controls box: its title and line, and a switch (on, off, not known) or a go mark.
const GO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
function controlRowHTML(t, waiting) {
  const look = t.look || {};
  const note = waiting ? 'Waiting for your OK' : tapped.get(t.id) || (t.error ? "Couldn't update" : '');
  const on = look.dot?.filled;
  const end = t.kind === 'switch' ? `<span class="sw ${on === true ? 'on' : on === false ? '' : 'unknown'}" aria-hidden="true"></span>` : `<span class="go">${GO}</span>`;
  return `<div role="button" tabindex="0" class="tile ctl-row kind-${t.kind} ${waiting ? 'waiting' : ''} ${popped.has(t.id) ? 'pop' : ''}" data-tile="${esc(t.id)}"${look.tap === 'toggle' ? ` aria-pressed="${on === true}"` : ''} title="${esc(t.error || '')}">
    <span class="n"><span class="tile-title">${esc(t.title)}</span>${note ? `<span class="tile-sub">${esc(note)}</span>` : ''}</span>${PEN_BTN()}${end}
  </div>`;
}

// The tiles under one heading as they are drawn: one by one, and the switches and buttons that follow each other
// as the rows of one Controls box.
function boardRuns(ts) {
  const out = [];
  for (const t of ts) {
    const last = out[out.length - 1];
    if (!isControlRow(t)) out.push({ tile: t });
    else if (last?.rows) last.rows.push(t);
    else out.push({ rows: [t] });
  }
  return out;
}
// Beside a heading: the bots its tiles come from; at its end, when their values come from one source for all of
// them ("script · 30 s"), how long ago they last read, said there once and not on each tile.
const sectionBots = (ts) => [...new Set(ts.map((t) => botById(t.bot)?.name).filter(Boolean))].join(', ');
const sectionSource = (ts) => { const all = [...new Set(ts.map((t) => t.source).filter(Boolean))]; return all.length === 1 ? all[0] : ''; };
// "3s ago", "2 min ago", "2 h ago": the age of a value, from its seconds.
function ageWords(secs) {
  const s = Math.max(0, Math.floor(secs));
  return `${s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`} ago`;
}
// "Live · updated 3s ago": the age of the newest value on the Board; nothing while none has come.
const liveWords = (secs) => `Live · updated ${ageWords(secs)}`;
const newestAt = (tiles) => Math.max(0, ...(tiles || []).map((t) => Date.parse(t.at || '') || 0));
// The age of a value that was read at `at` (ms), counting every second; its source ("http · 1 min") on hover.
const ageHTML = (at, source) => (at ? `<span class="tile-src" data-age="${at}" title="${esc(source)}">${esc(ageWords((Date.now() - at) / 1000))}</span>` : '');
setInterval(() => {
  if (state.view !== 'dashboard') return;
  const el = $('#view-dashboard [data-live]');
  if (el) el.textContent = liveWords((Date.now() - newestAt(state.dash?.tiles)) / 1000);
  $$('#view-dashboard [data-age]').forEach((x) => { x.textContent = ageWords((Date.now() - Number(x.dataset.age)) / 1000); });
}, 1000);
// The heading shown (its name), or all of them (''); kept in this browser.
let boardFilter = (() => { try { return localStorage.getItem('board-filter') || ''; } catch { return ''; } })();

function renderDashboard() {
  const root = $('#view-dashboard');
  const d = state.dash;
  if (!d) { root.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (tileDrag) return; // redrawing would drop the tile you're dragging
  if (ctlHeld) { ctlHeld.later = true; return; } // nor while a slider or the colour wheel is in your hand
  renderPanel();
  const waiting = new Set((d.pending || []).map((t) => t.id));
  const sig = JSON.stringify([d, [...tapped], [...popped], [...openGroups], boardFilter, state.bots.map((b) => [b.color, b.name])]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  const loose = d.tiles.filter((t) => !t.parent);
  const groups = [['', loose.filter((t) => !t.section)], ...d.sections.map((s) => [s, loose.filter((t) => t.section === s)])].filter(([, ts]) => ts.length);
  const named = groups.map(([name]) => name).filter(Boolean);
  if (!named.includes(boardFilter)) boardFilter = '';
  const shown = groups.filter(([name]) => !boardFilter || name === boardFilter);
  // A group tile, and when it's open, its tiles right below it across the whole width.
  const withInside = (t, sourced) => tileHTML(t, waiting.has(t.id), sourced) + (t.kind === 'group' && openGroups.has(t.id)
    ? `<div class="dash-inside"><div class="dash-grid" data-section="${esc(t.section)}" data-parent="${esc(t.id)}">${d.tiles.filter((x) => x.parent === t.id).map((x) => tileHTML(x, waiting.has(x.id))).join('') || '<div class="faint">Nothing in it yet.</div>'}</div></div>` : '');
  const runHTML = (r, sourced) => (r.tile ? withInside(r.tile, sourced) : `<div class="ctl-box"><div class="tile-head"><span class="tile-title">Controls</span></div>${r.rows.map((t) => controlRowHTML(t, waiting.has(t.id))).join('')}</div>`);
  const newest = newestAt(d.tiles);
  root.innerHTML = `
    <div class="section-head board-head"><div>${BACK_BTN}<h1>Board</h1></div>
      <div class="board-tools">${newest ? `<span class="board-live" data-live>${esc(liveWords((Date.now() - newest) / 1000))}</span>` : ''}${named.length > 1 ? `<div class="seg board-filter">${['', ...named].map((n) => `<button class="${n === boardFilter ? 'on' : ''}" data-filter="${esc(n)}">${esc(n || 'All')}</button>`).join('')}</div>` : ''}</div></div>
    ${d.tiles.length ? '' : `<div class="dash-empty">
      <p>Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary.</p>
      <p>Nothing is on it yet. Tell the Chief or any bot, for example: <i>“Put a shopping list on my board.”</i></p>
    </div>`}
    ${shown.map(([name, ts]) => {
    const by = sectionBots(ts);
    const from = name ? sectionSource(ts) : '';
    return `${name ? `<h3 class="dash-sec">${esc(name)}${by ? ` <span class="by">${esc(by)}</span>` : ''}${from ? ageHTML(newestAt(ts.filter((t) => t.source)), from) : ''}</h3>` : ''}<div class="dash-grid" data-section="${esc(name)}">${boardRuns(ts).map((r) => runHTML(r, !!from)).join('')}</div>`;
  }).join('')}
    ${(d.suggestions || []).length ? `<h3 class="dash-sec">Suggested</h3><div class="dash-grid">${d.suggestions.map(suggestedHTML).join('')}</div>` : ''}`;
  $$('[data-tile]', root).forEach((el) => {
    const t = d.tiles.find((x) => x.id === el.dataset.tile);
    wireTile(el, t, waiting.has(el.dataset.tile));
    if (t && !waiting.has(t.id)) wireControls(el, t);
  });
  $$('[data-filter]', root).forEach((el) => {
    el.onclick = () => {
      boardFilter = el.dataset.filter;
      try { localStorage.setItem('board-filter', boardFilter); } catch { /* private window */ }
      renderDashboard();
    };
  });
  wireTileDrags(root);
  if (asking) placeAsk();
  wireCharts(root);
  wireTables(root);
  // A folded note that has more to it fades out at the bottom.
  $$('.tile-note.folded', root).forEach((el) => el.classList.toggle('more', el.scrollHeight > el.clientHeight + 2));
  $$('[data-sug]', root).forEach((el) => {
    const x = tileSuggestions().find((y) => y.s.id === el.dataset.sug);
    $('[data-sug-add]', el).onclick = () => answerSuggestion(x, true);
    $('[data-sug-no]', el).onclick = () => answerSuggestion(x, false);
  });
}

// A tile a bot suggested: faded, who and why, Add or ✕ (its script, if it has one, opens under it).
function suggestedHTML(s) {
  const t = s.tile;
  const b = botById(s.bot);
  return `<div class="tile suggested ${t.wide ? 'wide' : ''}" data-sug="${esc(s.id)}">
    <div class="tile-head"><i class="tile-dot" style="--c:${esc(b?.color || CHIEF_COLOR)}"></i><span class="tile-title">${esc(t.title)}</span></div>
    <div class="tile-why">${b ? `<b>${esc(b.name)}</b> · ` : ''}${esc(s.reason)}</div>
    ${(t.scripts || []).length ? `<details class="tile-script"><summary>Its script</summary>${t.scripts.map((sc) => `<pre>${esc(sc)}</pre>`).join('')}</details>` : ''}
    <div class="tile-actions"><button class="btn sm" data-sug-no aria-label="Not this one">✕</button><button class="btn sm primary" data-sug-add>Add</button></div>
  </div>`;
}
async function answerSuggestion(x, add) {
  if (!x) return;
  try { await api(`/dashboard/suggestions/${x.s.id}`, { method: 'POST', body: { add } }); } catch (e) { toast(e.message, true); }
  loadDash(true);
}

// A tap does the tile's thing; a long press (or right-click) offers to remove it.
function wireTile(el, t, waiting) {
  if (!t) return;
  let timer = null, long = false;
  const cancel = () => clearTimeout(timer);
  const manage = () => (canAsk() ? openAsk(t) : removeTile(t)); // a long press, a right-click: change it or remove it
  el.onpointerdown = (e) => { long = false; if (e.pointerType === 'touch') timer = setTimeout(() => { long = true; manage(); }, 550); }; // a mouse drags instead
  el.onpointerup = cancel;
  el.onpointerleave = cancel;
  el.onpointercancel = cancel;
  el.oncontextmenu = (e) => { if (e.target.closest('[data-ctl-wrap], [data-ctl]')) return; e.preventDefault(); cancel(); if (!long) manage(); long = true; };
  const pen = $('[data-tile-edit]', el);
  if (pen) {
    pen.onpointerdown = (e) => e.stopPropagation();
    pen.onclick = (e) => { e.stopPropagation(); openAsk(t); };
  }
  el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); } };
  el.onclick = (e) => {
    if (e.target.closest('[data-ctl-wrap], [data-ctl], [data-tile-chat]')) return; // a control on the tile does its own thing
    if (long) { long = false; return; }
    if (t.kind === 'group') { openGroups.has(t.id) ? openGroups.delete(t.id) : openGroups.add(t.id); saveOpenGroups(); return renderDashboard(); }
    waiting ? setView('needs') : tapTile(t);
  };
}

// ---------- moving tiles by dragging ----------
// The tile moves live among the others while you drag (they make room); letting go saves its heading,
// its group and its place. Held over a closed group tile, it goes into that group.
const TILE_DRAG = 'application/x-botdot-tile';
let tileDrag = null; // { id, el, isGroup, into }
function wireTileDrags(root) {
  $$('[data-tile]', root).forEach((el) => {
    el.draggable = true;
    el.ondragstart = (e) => {
      const t = state.dash.tiles.find((x) => x.id === el.dataset.tile);
      e.dataTransfer.setData(TILE_DRAG, el.dataset.tile);
      e.dataTransfer.effectAllowed = 'move';
      tileDrag = { id: el.dataset.tile, el, isGroup: t?.kind === 'group', into: null };
      setTimeout(() => el.classList.add('drag-ghost'));
    };
    el.ondragend = () => { el.classList.remove('drag-ghost'); $$('.tile.drop-into').forEach((x) => x.classList.remove('drop-into')); if (tileDrag && !tileDrag.dropped) { tileDrag = null; delete root.dataset.sig; renderDashboard(); } };
    el.ondragover = (e) => {
      if (!tileDrag || !e.dataTransfer.types.includes(TILE_DRAG) || el === tileDrag.el) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      // Over the middle of a closed group: into it.
      const isGroup = el.classList.contains('kind-group');
      const middle = Math.abs(e.clientX - (r.left + r.width / 2)) < r.width / 4;
      $$('.tile.drop-into').forEach((x) => x !== el && x.classList.remove('drop-into'));
      if (isGroup && !tileDrag.isGroup && middle && !openGroups.has(el.dataset.tile)) { el.classList.add('drop-into'); tileDrag.into = el.dataset.tile; return; }
      el.classList.remove('drop-into');
      tileDrag.into = null;
      // A row of a Controls box moves among its rows; over a box it is not in, a tile goes around the whole box.
      const box = el.closest('.ctl-box');
      const node = box && !box.contains(tileDrag.el) ? box : el;
      const grid = node.parentElement;
      if (tileDrag.isGroup && grid.dataset.parent) return; // a group stays out of groups
      const at = node.getBoundingClientRect();
      const after = node.classList.contains('ctl-row') ? e.clientY > at.top + at.height / 2 : e.clientX > at.left + at.width / 2;
      let spot = after ? node.nextElementSibling : node;
      if (after && spot?.classList.contains('dash-inside')) spot = spot.nextElementSibling; // an open group keeps its tiles right below it
      if (spot === tileDrag.el) return;
      grid.insertBefore(tileDrag.el, spot);
      moveInsideAlong();
    };
    el.ondrop = (e) => dropTile(e);
  });
  // Over the empty part of a grid (or of an open group): at its end.
  $$('.dash-grid[data-section]', root).forEach((grid) => {
    grid.ondragover = (e) => {
      if (!tileDrag || !e.dataTransfer.types.includes(TILE_DRAG)) return;
      if (tileDrag.isGroup && grid.dataset.parent) return;
      e.preventDefault();
      if (e.target === grid && grid.lastElementChild !== tileDrag.el) { grid.append(tileDrag.el); moveInsideAlong(); }
    };
    grid.ondrop = (e) => dropTile(e);
  });
}
// A dragged open group takes its tiles' block along, right after it.
function moveInsideAlong() {
  const el = tileDrag?.el;
  if (!el?.classList.contains('open')) return;
  const inside = $$('.dash-inside').find((x) => x.querySelector(`[data-parent="${CSS.escape(el.dataset.tile)}"]`));
  if (inside && el.nextElementSibling !== inside) el.after(inside);
}
async function dropTile(e) {
  e.preventDefault();
  e.stopPropagation();
  const drag = tileDrag;
  if (!drag || drag.dropped) return;
  drag.dropped = true;
  let body;
  if (drag.into) body = { parent: drag.into };
  else {
    // Its heading's grid, and the tile after it there (in a Controls box too; not inside an open group).
    const grid = drag.el.closest('.dash-grid');
    const all = grid ? $$('[data-tile]', grid).filter((x) => x.closest('.dash-grid') === grid) : [];
    const next = all[all.indexOf(drag.el) + 1];
    body = { section: grid?.dataset.section || '', parent: grid?.dataset.parent || null, before: next?.dataset.tile || null };
  }
  try { await api(`/dashboard/tiles/${drag.id}/move`, { method: 'POST', body }); } catch (err) { toast(err.message, true); }
  tileDrag = null;
  delete $('#view-dashboard').dataset.sig;
  await loadDash(true);
  renderDashboard();
}

// A tile's panel: its pop-up in the middle (the Board stays as it is). A note or list shows all of it
// there, with a way into its bot's chat; a light its on/off, brightness and colour wheel. It follows the tile's new values.
let panelOpen = null; // { id, m, sig }
// How often a tile refreshes, in words, for its pop-up (#42): `every` as the owner chose it, 0 for only when
// tapped; nothing for a tile that reads nothing, or from a server that doesn't say. The Chief changes it.
function refreshLine(t) {
  const n = t.every;
  if (typeof n !== 'number') return '';
  const unit = (k, one) => (k === 1 ? `every ${one}` : `every ${k} ${one}s`);
  const when = n === 0 ? 'only when tapped'
    : `${n % 86400 === 0 ? unit(n / 86400, 'day') : n % 3600 === 0 ? unit(n / 3600, 'hour') : n % 60 === 0 ? unit(n / 60, 'minute') : unit(n, 'second')} while the Board is open`;
  return `Refreshes ${when}. Ask the Chief of Staff to change it.`;
}
function openTilePanel(t, only = null) {
  const m = openModal(`
    <div class="modal-head"><h2>${esc(t.title)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body tile-full tile-panel"></div>`);
  m.classList.add('tile-pop'); // the one dialog every pop-up uses: narrow only for this one
  panelOpen = { id: t.id, m, only, sig: null };
  // A click beside it closes it (the dialog's own backdrop; its padding counts as inside).
  const away = (e) => {
    if (e.target !== m) return;
    const r = m.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) m.close();
  };
  m.addEventListener('click', away);
  m.addEventListener('close', () => { m.classList.remove('tile-pop'); m.removeEventListener('click', away); panelOpen = null; }, { once: true });
  renderPanel();
}
function renderPanel() {
  if (!panelOpen || ctlHeld) return;
  const t = state.dash?.tiles.find((x) => x.id === panelOpen.id);
  if (!t) { panelOpen.m.close(); return; }
  const list = panelOpen.only ? [findBlock(t.look?.face, panelOpen.only)].filter(Boolean) : t.look?.panel;
  const sig = JSON.stringify([list, t.every]);
  if (sig === panelOpen.sig) return;
  panelOpen.sig = sig;
  const body = $('.tile-panel', panelOpen.m);
  const every = panelOpen.only ? '' : refreshLine(t);
  body.innerHTML = (blocksHTML(list, t, 'panel') || '<div class="faint">·</div>') + (every ? `<div class="faint tile-every">${esc(every)}</div>` : '');
  wireControls(body, t);
  wireCharts(body);
  wireTables(body);
  const link = $('[data-tile-chat]', body);
  if (link) link.onclick = () => { panelOpen?.m.close(); setView('bot', t.bot); };
}
function findBlock(list, key) {
  for (const b of list || []) { if (b.key === key) return b; const x = findBlock(b.blocks, key); if (x) return x; }
  return null;
}

// ---------- a tile's controls: switches, buttons, sliders, the colour wheel, choices ----------
let ctlHeld = null; // a slider or the wheel being dragged: the page isn't redrawn under your finger
function holdCtl(tileEl) {
  ctlHeld = { later: false, tileEl };
  if (tileEl) tileEl.draggable = false; // a slider moves, not the tile
  const up = () => {
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    setTimeout(() => {
      const later = ctlHeld?.later;
      if (ctlHeld?.tileEl) ctlHeld.tileEl.draggable = true;
      ctlHeld = null;
      if (later) { delete $('#view-dashboard').dataset.sig; renderDashboard(); }
      renderPanel();
    }, 0);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function wireControls(root, t) {
  const tileEl = root.closest?.('[data-tile]') || (root.dataset?.tile ? root : null);
  $$('[data-ctl-wrap], [data-ctl], [data-tile-chat]', root).forEach((el) => {
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); holdCtl(tileEl); });
    el.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
  });
  const chat = $('[data-tile-chat]', root);
  if (chat && tileEl) chat.onclick = (e) => { e.stopPropagation(); setView('bot', t.bot); };
  $$('[data-ctl]', root).forEach((el) => {
    const key = el.dataset.ctl;
    switch (el.dataset.ctlKind) {
      case 'switch':
        el.onchange = () => sendCtl(t, key, el.checked);
        break;
      case 'button':
        el.onclick = (e) => { e.stopPropagation(); sendCtl(t, key, null, { pop: true }); };
        break;
      case 'slider': {
        const show = $('[data-show]', el.closest('.b-slider'));
        const b = findBlock(t.look?.panel, key) || findBlock(t.look?.face, key) || {};
        el.oninput = () => { el.closest('.b-slider').classList.remove('unset'); show.textContent = sliderText(b, Number(el.value)); };
        el.onchange = () => sendCtl(t, key, Number(el.value));
        break;
      }
      case 'choice':
        el.onclick = (e) => {
          e.stopPropagation();
          $$('button', el.parentElement).forEach((b) => b.classList.toggle('on', b === el));
          sendCtl(t, key, JSON.parse(el.dataset.v));
        };
        break;
      case 'color-open':
        el.onclick = (e) => { e.stopPropagation(); openTilePanel(t, key); };
        break;
      case 'color':
        wireWheel(el, (hex, done) => sendCtl(t, key, hex, { quiet: !done }));
        break;
      default:
    }
  });
}

// Drag on the wheel: the mark follows, the light follows a few times a second, and once more when you let go.
function wireWheel(el, send) {
  let last = 0, timer = null, hex = null;
  const pick = (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const sat = Math.min(Math.hypot(x, y) * 2, 1);
    hex = hsvHex(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, sat);
    let mark = $('.mark', el);
    if (!mark) { mark = document.createElement('i'); mark.className = 'mark'; el.append(mark); }
    mark.setAttribute('style', `${wheelSpot(hex)};--c:${hex}`);
    const now = Date.now();
    clearTimeout(timer);
    if (now - last > 350) { last = now; send(hex, false); } else timer = setTimeout(() => { last = Date.now(); send(hex, false); }, 350);
  };
  el.onpointerdown = (e) => { el.setPointerCapture(e.pointerId); pick(e); el.onpointermove = pick; };
  el.onpointerup = () => { el.onpointermove = null; clearTimeout(timer); if (hex) send(hex, true); };
  el.onpointercancel = el.onpointerup;
}

async function sendCtl(t, key, value, { pop: popIt = false, quiet = false } = {}) {
  try {
    const r = await api(`/dashboard/tiles/${t.id}/act`, { method: 'POST', body: { block: key, value } });
    if (quiet) return; // the wheel mid-drag: the last one updates the page
    state.dash.tiles = state.dash.tiles.map((x) => (x.id === t.id ? { ...x, ...r } : x));
    if (popIt) { popped.add(t.id); setTimeout(() => { popped.delete(t.id); renderDashboard(); }, 500); }
    renderDashboard();
    renderPanel();
  } catch (e) {
    toast(e.message, true);
    loadDash(true);
  }
}

// Groups you opened stay open (in this browser).
const openGroups = new Set((() => { try { return JSON.parse(localStorage.getItem('dash-open') || '[]'); } catch { return []; } })());
function saveOpenGroups() { try { localStorage.setItem('dash-open', JSON.stringify([...openGroups])); } catch { /* private window */ } }

// ---------- asking the Chief to change a tile (#430) ----------
// Under the tile on a wide screen; a sheet from the bottom with its title on a phone. Enter sends, Shift+Enter is a
// new line, Esc or a tap beside it closes it. The trash removes the tile (asked first, as a long press did).
const BIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/></svg>';
const UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
let asking = null; // { t, pop, dim }
const askSheet = () => matchMedia('(max-width: 760px)').matches;
function openAsk(t) {
  closeAsk();
  const sheet = askSheet();
  const pop = document.createElement('div');
  pop.className = `ask-pop${sheet ? ' ask-sheet' : ''}`;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', t.title);
  pop.innerHTML = `${sheet ? `<h2>${esc(t.title)}</h2>` : ''}<textarea rows="3" placeholder="What should change?"></textarea>
    <div class="row"><button type="button" class="rm" data-ask-rm aria-label="Remove from Board">${BIN}</button><button type="button" class="send off" data-ask-send aria-label="Send">${UP}</button></div>`;
  const dim = sheet ? Object.assign(document.createElement('div'), { className: 'ask-dim' }) : null;
  if (dim) { dim.onclick = closeAsk; document.body.append(dim); }
  document.body.append(pop);
  asking = { t, pop, dim };
  const ta = $('textarea', pop);
  const sendBtn = $('[data-ask-send]', pop);
  ta.oninput = () => sendBtn.classList.toggle('off', !ta.value.trim());
  ta.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeAsk(); }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAsk(); }
  };
  sendBtn.onclick = sendAsk;
  $('[data-ask-rm]', pop).onclick = () => { closeAsk(); removeTile(t); };
  placeAsk();
  ta.focus();
}
function placeAsk() {
  if (!asking) return;
  const el = $(`#view-dashboard [data-tile="${CSS.escape(asking.t.id)}"]`);
  if (!el) return closeAsk();
  el.classList.add('asking');
  if (asking.pop.classList.contains('ask-sheet')) return;
  const r = el.getBoundingClientRect();
  const w = Math.min(Math.max(300, r.width), innerWidth - 32);
  const h = asking.pop.offsetHeight;
  const below = r.bottom + 8 + h <= innerHeight - 8;
  asking.pop.style.width = `${w}px`;
  asking.pop.style.left = `${Math.max(16, Math.min(r.left, innerWidth - w - 16))}px`;
  asking.pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
}
function closeAsk() {
  if (!asking) return;
  asking.pop.remove();
  asking.dim?.remove();
  $$('#view-dashboard .tile.asking').forEach((x) => x.classList.remove('asking'));
  asking = null;
}
async function sendAsk() {
  if (!asking || asking.sending) return;
  const { t, pop } = asking;
  const text = $('textarea', pop).value.trim();
  if (!text) return;
  asking.sending = true;
  try {
    await api(`/dashboard/tiles/${t.id}/change`, { method: 'POST', body: { text } });
  } catch (e) {
    if (asking?.pop === pop) asking.sending = false;
    return toast(e.message, true);
  }
  if (asking?.pop === pop) closeAsk(); // not another tile's ask, opened while this one went
  tapped.set(t.id, `Sent to ${chiefName()}`);
  renderDashboard();
  setTimeout(() => { tapped.delete(t.id); renderDashboard(); }, 2500);
}
document.addEventListener('pointerdown', (e) => {
  if (asking && !asking.dim && !asking.pop.contains(e.target) && !e.target.closest('[data-tile-edit]')) closeAsk();
}, true);
window.addEventListener('resize', () => placeAsk());
document.addEventListener('scroll', () => placeAsk(), true);

// ---------- the tiles on home (#447) ----------
// Every approved tile of the Board, those on home first in their order, each with a check; a grip drags a checked one
// to another place. Each change is saved at once (PUT /dashboard/layout { home }). Under the pencil on a wide screen;
// a sheet from the bottom on a phone. Esc or a tap beside it closes it.
let homePick = null; // { pop, dim, anchor }
const homePickOpen = () => !!homePick;
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
function homeRows() {
  const on = boardTiles().map((t) => t.id);
  const rest = (state.dash?.tiles || []).filter((t) => t.approved !== false && !on.includes(t.id)).map((t) => t.id);
  return { on, rest };
}
function openHomePick(anchor) {
  closeHomePick();
  closeAsk();
  const sheet = askSheet();
  const pop = document.createElement('div');
  pop.className = `ask-pop home-pop${sheet ? ' ask-sheet' : ''}`;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Tiles on home');
  const dim = sheet ? Object.assign(document.createElement('div'), { className: 'ask-dim' }) : null;
  if (dim) { dim.onclick = closeHomePick; document.body.append(dim); }
  document.body.append(pop);
  homePick = { pop, dim, anchor };
  anchor.classList.add('editing');
  drawHomePick();
  $('[data-home-row]', pop)?.focus();
}
function drawHomePick() {
  if (!homePick || homePick.dragging) return;
  const { pop } = homePick;
  const byId = new Map((state.dash?.tiles || []).map((t) => [t.id, t]));
  const { on, rest } = homeRows();
  const row = (id, checked) => `<div class="home-row${checked ? ' on' : ''}" data-home-row="${esc(id)}" role="checkbox" aria-checked="${checked}" tabindex="0">
    <span class="home-grip"${checked ? ' data-home-grip' : ''}>${checked ? GRIP : ''}</span><span class="home-chk"></span><span class="home-t">${esc(byId.get(id)?.title || '')}</span></div>`;
  pop.innerHTML = `<div class="home-list">${on.map((id) => row(id, true)).join('')}</div>${on.length && rest.length ? '<div class="home-sep"></div>' : ''}<div class="home-list">${rest.map((id) => row(id, false)).join('')}</div>`;
  $$('[data-home-row]', pop).forEach((el) => {
    el.onclick = (e) => { if (!e.target.closest('[data-home-grip]')) toggleHome(el.dataset.homeRow); };
    el.onkeydown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleHome(el.dataset.homeRow); }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nudgeHome(el.dataset.homeRow, e.key === 'ArrowUp' ? -1 : 1); }
    };
  });
  $$('[data-home-grip]', pop).forEach((g) => (g.onpointerdown = (e) => dragHome(e, g.closest('[data-home-row]'))));
  placeHomePick();
}
function placeHomePick() {
  if (!homePick || homePick.pop.classList.contains('ask-sheet')) return;
  const at = $('[data-home-edit]', homePick.anchor) || homePick.anchor;
  if (!at.isConnected) return closeHomePick();
  const r = at.getBoundingClientRect();
  const w = Math.min(320, innerWidth - 32);
  homePick.pop.style.width = `${w}px`;
  homePick.pop.style.left = `${Math.max(16, Math.min(r.right - w, innerWidth - w - 16))}px`;
  homePick.pop.style.top = `${r.bottom + 8}px`;
  homePick.pop.style.maxHeight = `${Math.max(160, innerHeight - r.bottom - 24)}px`;
}
function closeHomePick() {
  if (!homePick) return;
  homePick.pop.remove();
  homePick.dim?.remove();
  homePick.anchor.classList.remove('editing');
  homePick = null;
}
// The new list saved, and drawn at once: the line, and the list here.
async function saveHome(home) {
  const before = state.dash.home;
  state.dash.home = home;
  renderContacts();
  drawHomePick();
  try { await api('/dashboard/layout', { method: 'PUT', body: { home } }); } catch (e) { state.dash.home = before; renderContacts(); drawHomePick(); toast(e.message, true); }
}
function toggleHome(id) {
  const on = homeRows().on;
  saveHome(on.includes(id) ? on.filter((x) => x !== id) : [...on, id]);
  requestAnimationFrame(() => homePick && $(`[data-home-row="${CSS.escape(id)}"]`, homePick.pop)?.focus());
}
function nudgeHome(id, by) {
  const on = homeRows().on;
  const i = on.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= on.length) return;
  [on[i], on[j]] = [on[j], on[i]];
  saveHome(on);
  requestAnimationFrame(() => homePick && $(`[data-home-row="${CSS.escape(id)}"]`, homePick.pop)?.focus());
}
// A checked row follows the pointer among the checked ones, and the order is saved where it is let go.
function dragHome(e, el) {
  e.preventDefault();
  const list = el.parentElement;
  homePick.dragging = true;
  el.classList.add('dragging');
  // On the document: moving the row in the list would end a capture on it.
  const move = (m) => {
    const others = [...list.children].filter((x) => x !== el);
    const next = others.find((x) => { const r = x.getBoundingClientRect(); return m.clientY < r.top + r.height / 2; });
    if (next) { if (el.nextElementSibling !== next) list.insertBefore(el, next); } else if (list.lastElementChild !== el) list.append(el);
  };
  const end = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    el.classList.remove('dragging');
    if (!homePick) return;
    homePick.dragging = false;
    const order = [...list.children].map((x) => x.dataset.homeRow);
    if (order.join() !== homeRows().on.join()) saveHome(order); else drawHomePick();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}
document.addEventListener('pointerdown', (e) => {
  if (homePick && !homePick.dim && !homePick.pop.contains(e.target) && !e.target.closest('[data-home-edit]')) closeHomePick();
}, true);
document.addEventListener('keydown', (e) => { if (homePick && e.key === 'Escape') closeHomePick(); });
window.addEventListener('resize', () => placeHomePick());

function removeTile(t) {
  const inside = t.kind === 'group' ? (state.dash?.tiles || []).filter((x) => x.parent === t.id) : [];
  if (inside.length) return removeGroup(t, inside.length);
  if (!confirm(`Remove “${t.title}” from your Board?`)) return;
  api(`/dashboard/tiles/${t.id}`, { method: 'DELETE' }).then(() => loadDash(true)).catch((e) => toast(e.message, true));
}

// A group with tiles in it: only the group (its tiles stay, loose), or everything.
function removeGroup(t, n) {
  const m = openModal(`
    <div class="modal-head"><h2>Remove “${esc(t.title)}”?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body"><p style="margin:0">It holds ${n === 1 ? 'one tile' : `${n} tiles`}.</p></div>
    <div class="modal-foot">
      <button class="btn" data-dismiss>Cancel</button>
      <button class="btn" id="rm-group">Only the group</button>
      <button class="btn danger" id="rm-all">The group and its tiles</button>
    </div>`);
  const go = (all) => { m.close(); api(`/dashboard/tiles/${t.id}${all ? '?all' : ''}`, { method: 'DELETE' }).then(() => loadDash(true)).catch((e) => toast(e.message, true)); };
  $('#rm-group', m).onclick = () => go(false);
  $('#rm-all', m).onclick = () => go(true);
}

// What a tile says when its bot was busy: the request waits among the owner's messages (docs/api.md, "A message that waits").
const tileWaits = (t) => `${botById(t.bot)?.name || 'Its bot'} will do it when it is free`;
async function tapTile(t) {
  const tap = t.look?.tap || 'none';
  if (tap === 'panel') return openTilePanel(t);
  if (tap === 'chat' || tap === 'none') { if (tap === 'chat' && botById(t.bot)) setView('bot', t.bot); return; }
  const flash = (text) => { tapped.set(t.id, text); renderDashboard(); setTimeout(() => { tapped.delete(t.id); renderDashboard(); }, 2500); };
  const pop = () => { popped.add(t.id); renderDashboard(); setTimeout(() => { popped.delete(t.id); renderDashboard(); }, 500); };
  const on = t.look.dot?.filled !== true;
  if (tap === 'toggle') { state.dash.tiles = state.dash.tiles.map((x) => (x.id === t.id ? { ...x, value: on, look: { ...x.look, dot: { ...x.look.dot, filled: on } } } : x)); renderDashboard(); }
  if (t.asks) flash(`Asked ${botById(t.bot)?.name || 'its bot'}`);
  try {
    const { queued, ...r } = await api(`/dashboard/tiles/${t.id}/tap`, { method: 'POST', body: tap === 'toggle' ? { on } : {} });
    state.dash.tiles = state.dash.tiles.map((x) => (x.id === t.id ? { ...x, ...r } : x));
    if (t.asks && queued === true) flash(tileWaits(t)); // its bot is working: the request waits its turn
    if (tap === 'act' && !t.asks) pop();
    else renderDashboard();
  } catch (e) {
    toast(e.message, true);
    loadDash(true);
  }
}
