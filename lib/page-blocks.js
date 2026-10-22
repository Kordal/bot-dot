// Blocks in a bot's page (#395, ADR 071): between its Markdown, a fence named after a block of the kit holds the block
// as JSON, and the apps draw it with the Board's own block kit (public/blocks.js, BlockKit.kt):
//
//   ```kpi
//   { "label": "Done", "value": 42, "of": 58, "points": [30, 34, 36, 42], "sub": "6 this week" }
//   ```
//
//   hero     eyebrow, title, lead, tags: the top of a page
//   kpi      a number (value), with unit, of, sub, its recent values (points: a sparkline and the change), good, max
//   chart    line, area, bar, stacked or hbar (style); points or series [{ label, points }], labels; bars [{ label, value }]
//   status   a pill: text, level (ok, warn, err, info, plan)
//   callout  a box that stands out: title, text, level
//   grid     blocks side by side: { columns, blocks }. A fence that holds a list is a grid of that block.
//   table    rows the owner sorts, searches and filters (#396): { title, columns: [{ label, type, … }], rows, filter,
//            sort, pageSize }; on a phone, a list. Its rows written out ([[…]] or [{…}]), or read from a tile's list.
//
// A block either carries its own values (written by the bot), or binds to a tile of the Board ("tile": its id or
// title) and reads what the tile read, as a block of the tile would: { "tile": "Disk", "bind": "value.used" }, text
// with {{value}}, a chart's series of binds. Its numbers then stay live with no AI run: the tile reads them, and a page
// that is open is told on the live feed. A kpi or chart bound to one number keeps its recent values, as on the Board.
//
// botdot checks every block and fills it in here; the apps only draw what they get, never HTML from the bot (rule 6,
// ADR 065). A block that cannot be drawn is a quiet line on the page, never a broken page. Controls are not on a page.
const tb = require('./tile-blocks');

const TYPES = ['hero', 'kpi', 'chart', 'status', 'callout', 'grid', 'table'];

// What save_page tells a bot and the Chief of the blocks (lib/self-mcp.js, lib/mcp-server.js).
const SAY = 'A page can also hold blocks the app draws in its own style, each a fenced block named after it with one JSON object: ' +
  '```hero {"eyebrow":"Report","title":"…","lead":"one line","tags":["…"]}; ```kpi {"label":"Done","value":42,"of":58,"unit":"…","sub":"6 this week","points":[30,36,42],"good":"up"}; ' +
  '```chart {"title":"…","style":"line|area|bar|stacked|hbar","labels":["W1","W2"],"series":[{"label":"Closed","points":[3,5]}]} (hbar: "bars":[{"label":"Chat","value":11}]); ' +
  '```status {"text":"…","level":"ok|warn|err|info|plan"}; ```callout {"title":"…","text":"…","level":"warn"}; ```grid {"columns":2,"blocks":[{"type":"chart",…},…]}; ' +
  '```table {"title":"Features","columns":[{"label":"Feature"},{"label":"State","type":"status","levels":{"Done":"ok","In progress":"info","Planned":"plan"}},{"label":"Ref","type":"ref","link":"https://github.com/owner/repo/issues/{n}"},{"label":"Changed","type":"date"}],"rows":[["Copy button","Done","#285 · PR #288","2026-10-20"]],"filter":"State","sort":"Feature"} ' +
  '(column types text, number, date, status, ref; the owner sorts, searches and filters it, a phone shows it as a list; bound to a tile, "bind" names its list and each column\'s "item" the field of a row). ' +
  'A fence holding a list is a row of that block (```kpi [{…},{…},{…}]). For numbers that stay live with no rewrite, bind a kpi, chart, status or callout to a tile of the Board instead of writing values: ' +
  '{"tile":"<its id or title>","bind":"value.used"} (text takes {{value}}); a source the page needs is a tile, suggested as any tile. Never HTML. save_page says which blocks cannot be drawn.';
const IN_GRID = ['kpi', 'chart', 'status', 'callout'];
const MAX_BLOCKS = 60; // on one page, those in grids counted
const MAX_POINTS = 120;
const MAX_COLUMNS = 4;
const BOUND = [...IN_GRID, 'table']; // the blocks that can read a tile
const OPEN = /^```([a-z]+)\s*$/;
const FENCE = /^(`{3,}|~{3,})/;

const text = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => (v === '' || v == null || typeof v === 'boolean' ? NaN : Number(v));
const fail = (msg) => { throw new Error(msg); };

// The page as it is drawn: Markdown, and the kit's fences in it, in order. A fence inside another code fence stays
// that code. [{ md } | { type, json }]
function split(markdown) {
  const parts = [];
  let md = [];
  const lines = String(markdown ?? '').split('\n');
  const flush = () => { if (md.join('\n').trim()) parts.push({ md: md.join('\n') }); md = []; };
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(OPEN);
    if (open && TYPES.includes(open[1])) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) body.push(lines[j++]);
      flush();
      // A fence never closed takes nothing with it: it cannot be drawn, and the lines after it stay the page's.
      if (j >= lines.length) { parts.push({ type: open[1], json: null }); continue; }
      parts.push({ type: open[1], json: body.join('\n') });
      i = j;
      continue;
    }
    const other = lines[i].match(FENCE);
    md.push(lines[i]);
    if (other) {
      // Another code fence: kept as it is, up to its own closing line.
      const close = new RegExp(`^${other[1][0] === '`' ? '`' : '~'}{${other[1].length},}\\s*$`);
      for (i++; i < lines.length; i++) { md.push(lines[i]); if (close.test(lines[i])) break; }
    }
  }
  flush();
  return parts;
}
const hasBlocks = (markdown) => split(markdown).some((p) => p.type);

// ---------- checking one block ----------

function color(v, where) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (tb.COLOR_NAMES.includes(s)) return s;
  return fail(`${where}: a colour is "#rrggbb" or one of ${tb.COLOR_NAMES.join(', ')}`);
}
function level(v, where) {
  const s = String(v ?? 'info').trim();
  if (s === 'bad') return 'err';
  return tb.LEVELS.includes(s) ? s : fail(`${where}: level is one of ${tb.LEVELS.join(', ')}`);
}
function numbers(v, where) {
  if (v == null) return [];
  if (!Array.isArray(v)) fail(`${where}: give a list of numbers`);
  return v.slice(-MAX_POINTS).map((x) => (x == null ? null : Number.isFinite(num(x)) ? Number(x) : fail(`${where}: "${x}" is not a number`)));
}
const strings = (v, n, max) => (Array.isArray(v) ? v.slice(0, n).map((x) => text(x, max)) : []);

// A block bound to a tile, checked as a block of that tile is (lib/tile-blocks.js), with the tile's reads. board:
// { tile(ref) } (lib/dashboard.js forPage).
function bound(b, type, where, board) {
  const got = board?.tile(b.tile);
  if (!got) fail(`${where}: there's no tile "${text(b.tile, 60)}" on the Board. Bind to a tile by its id or title, or write the values yourself.`);
  const t = got.tile;
  const images = Object.entries(t.reads || {}).filter(([, s]) => s.image).map(([n]) => n);
  const ctx = { reads: ['value', ...Object.keys(t.reads || {}).filter((n) => !images.includes(n))], images: [], actions: [], count: 0 };
  const { tile: _, ...rest } = b;
  const spec = { ...rest, type };
  if (spec.title != null && spec.label == null && type !== 'callout') spec.label = spec.title;
  if (spec.value != null && spec.text == null) spec.text = String(spec.value);
  delete spec.value;
  if (type !== 'callout') delete spec.title;
  return { ...tb.checkBlock(spec, where, ctx, 1), tile: t.id };
}

function one(b, type, where, board, ctx) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail(`${where}: give one block as a JSON object`);
  if (b.type != null && b.type !== type) fail(`${where}: this is a ${type} block (its fence says so), not ${text(b.type, 20)}`);
  if (++ctx.count > MAX_BLOCKS) fail(`A page holds at most ${MAX_BLOCKS} blocks`);
  if (b.tile != null && BOUND.includes(type)) return bound(b, type, where, board);
  const out = { type };
  switch (type) {
    case 'hero':
      out.title = text(b.title, 120) || fail(`${where}: give it a title`);
      if (b.eyebrow != null) out.eyebrow = text(b.eyebrow, 60);
      if (b.lead != null) out.lead = text(b.lead, 400);
      if (b.tags != null) out.tags = strings(b.tags, 8, 30).filter(Boolean);
      break;
    case 'kpi':
      out.text = text(b.value ?? b.text, 40);
      if (!out.text) fail(`${where}: give its value`);
      for (const k of ['label', 'sub']) if (b[k] != null) out[k] = text(b[k], k === 'sub' ? 120 : 60);
      for (const k of ['unit', 'of']) if (b[k] != null) out[k] = text(b[k], 20);
      if (b.color != null) out.color = color(b.color, where);
      if (b.subColor != null) out.subColor = color(b.subColor, where);
      if (b.good != null) out.good = tb.GOOD.includes(b.good) ? b.good : fail(`${where}: good is ${tb.GOOD.join(', ')} (which way is good news)`);
      if (b.points != null) out.points = numbers(b.points, `${where}.points`).filter(Number.isFinite);
      if (b.change === false) out.change = false;
      if (b.max != null) {
        out.min = Number.isFinite(num(b.min)) ? Number(b.min) : 0;
        out.max = Number.isFinite(num(b.max)) ? Number(b.max) : fail(`${where}: max is a number`);
        if (out.max === out.min) fail(`${where}: min and max can't be the same`);
      }
      break;
    case 'chart': {
      const style = b.style ?? 'line';
      if (!tb.STYLES.includes(style)) fail(`${where}: style is one of ${tb.STYLES.join(', ')}`);
      if (style !== 'line') out.style = style;
      if (b.title ?? b.label) out.text = text(b.title ?? b.label, 80);
      if (b.unit != null) out.unit = text(b.unit, 12);
      if (b.color != null) out.color = color(b.color, where);
      if (style === 'hbar') {
        if (!Array.isArray(b.bars) || !b.bars.length) fail(`${where}: horizontal bars take bars: [{ "label": "Chat", "value": 11 }]`);
        out.bars = b.bars.slice(0, tb.MAX_BARS).map((x, i) => {
          const n = num(x?.value);
          if (!Number.isFinite(n)) fail(`${where}.bars[${i}]: give { "label": …, "value": a number }`);
          return { label: text(x.label, 40), value: n, ...(x.text != null ? { text: text(x.text, 20) } : {}) };
        });
        if (b.max != null) out.max = Number.isFinite(num(b.max)) ? Number(b.max) : fail(`${where}: max is a number`);
        break;
      }
      if (b.series != null) {
        if (!Array.isArray(b.series) || !b.series.length || b.series.length > tb.MAX_SERIES) fail(`${where}: series is 1 to ${tb.MAX_SERIES} of { "label": "…", "points": [numbers] }`);
        out.series = b.series.map((x, i) => ({ points: numbers(x?.points, `${where}.series[${i}].points`), ...(x?.label != null ? { label: text(x.label, 30) } : {}), ...(x?.color != null ? { color: color(x.color, `${where}.series[${i}]`) } : {}) }));
      } else out.series = [{ points: numbers(b.points, `${where}.points`) }];
      if (!out.series.some((s) => s.points.length)) fail(`${where}: give its points`);
      if (b.labels != null) out.labels = strings(b.labels, MAX_POINTS, 20);
      break;
    }
    case 'status':
      out.text = text(b.text, 80) || fail(`${where}: write its text`);
      out.level = level(b.level, where);
      break;
    case 'callout':
      out.text = String(b.text ?? '').trim().slice(0, 1000) || fail(`${where}: write its text`);
      out.level = level(b.level, where);
      if (b.title != null) out.title = text(b.title, 80);
      break;
    case 'table': {
      Object.assign(out, tb.checkTable(b, where));
      if (!Array.isArray(b.rows)) fail(`${where}: give its rows: [["Copy button", "Done"], …] or [{ "Feature": "Copy button", … }], or bind it to a tile`);
      if (b.rows.length > tb.MAX_ROWS) fail(`${where}: a table holds at most ${tb.MAX_ROWS} rows`);
      out.rows = b.rows.map((r, i) => (r && typeof r === 'object' ? r : fail(`${where}.rows[${i}]: a row is a list of its cells, or an object`)));
      break;
    }
    case 'grid': {
      if (!Array.isArray(b.blocks) || !b.blocks.length) fail(`${where}: give its blocks, e.g. { "columns": 3, "blocks": [{ "type": "kpi", … }] }`);
      out.blocks = b.blocks.slice(0, 12).map((x, i) => {
        const t = x?.type;
        if (!IN_GRID.includes(t)) fail(`${where}.blocks[${i}]: a grid holds ${IN_GRID.join(', ')} blocks (say which with "type")`);
        return one(x, t, `${where}.blocks[${i}]`, board, ctx);
      });
      out.columns = Math.min(Math.max(Math.round(num(b.columns)) || Math.min(out.blocks.length, 3), 1), MAX_COLUMNS);
      break;
    }
    default:
  }
  return out;
}

// One fence: its JSON read and checked. A list in a fence is a grid of that block.
function check(type, json, where, board, ctx = { count: 0 }) {
  if (json == null) fail(`${where}: its fence is never closed with \`\`\``);
  let v;
  try { v = JSON.parse(json); } catch { return fail(`${where}: its JSON can't be read`); }
  if (Array.isArray(v)) {
    if (!IN_GRID.includes(type)) fail(`${where}: a list of blocks works for ${IN_GRID.join(', ')}`);
    return one({ blocks: v.map((x) => ({ ...(x && typeof x === 'object' ? x : {}), type })), columns: Math.min(v.length, MAX_COLUMNS) }, 'grid', where, board, ctx);
  }
  return one(v, type, where, board, ctx);
}

// ---------- filling in ----------

// A block as the apps get it: as lib/tile-blocks.js fills a block of a tile in, so the kit draws both.
function resolve(b, board) {
  if (b.tile) {
    const got = board?.tile(b.tile);
    if (!got) return { type: 'error', text: 'Its tile is gone from the Board.' };
    const { tile: _, ...spec } = b;
    return tb.resolveBlock(spec, 'g', got.data, { id: got.tile.id, history: got.history, times: got.times, at: got.at }); // null: its rules hide it
  }
  switch (b.type) {
    case 'kpi': {
      const { points = [], good, change, min, max, ...out } = b;
      if (points.length >= 2) {
        out.points = points;
        if (change !== false) out.delta = tb.deltaOf(points, good);
      }
      if (max != null) {
        const n = num(String(b.text).replace(/,/g, ''));
        if (Number.isFinite(n)) out.ratio = Math.min(Math.max((n - min) / (max - min), 0), 1);
      }
      return out;
    }
    case 'chart': {
      if (b.style === 'hbar') {
        const top = b.max ?? Math.max(...b.bars.map((x) => x.value), 0);
        const { max: _, ...out } = b;
        return { ...out, points: [], bars: b.bars.map((x) => ({ label: x.label, text: x.text ?? `${Math.round(x.value * 100) / 100}${b.unit ? ` ${b.unit}` : ''}`, ratio: top > 0 ? Math.min(Math.max(x.value / top, 0), 1) : 0 })) };
      }
      const { series, ...out } = b;
      out.points = series[0].points.filter(Number.isFinite);
      // A gap (null) is kept in the series, so each point stays under its label.
      if (series.length > 1 || series[0].label || series[0].color || series[0].points.some((x) => x == null)) out.series = series;
      return out;
    }
    case 'table': {
      const { rows, columns: _, filter: __, sort: ___, label: ____, ...out } = b;
      return { ...out, ...tb.tableOf(b, rows) };
    }
    case 'grid':
      return { ...b, blocks: b.blocks.map((x) => resolve(x, board)).filter(Boolean) };
    default:
      return b;
  }
}

// The page as the apps draw it: { parts: [{ md } | { block } | { block: { type: "error", text } }], tiles }: tiles, the
// ids of the tiles its blocks read, so that an app redraws them when one of those changes on the live feed.
function render(markdown, board) {
  const tiles = new Set();
  const ctx = { count: 0 };
  let n = 0;
  const parts = split(markdown).map((p) => {
    if (!p.type) return p;
    n++;
    try {
      const b = check(p.type, p.json, `Block ${n} (${p.type})`, board, ctx);
      for (const x of [b, ...(b.blocks || [])]) if (x.tile) tiles.add(x.tile);
      const block = resolve(b, board);
      return block ? { block } : null;
    } catch (e) {
      return { block: { type: 'error', text: e.message } };
    }
  }).filter(Boolean);
  return { parts, tiles: [...tiles] };
}

// For save_page: what is wrong with its blocks (for the bot to fix), and the paths of each tile whose recent values
// the page's kpis and charts show ({ tileId: [paths] }), so the tile keeps them as it keeps its own.
function inspect(markdown, board) {
  const problems = [];
  const keeps = {};
  const ctx = { count: 0 };
  let n = 0;
  for (const p of split(markdown)) {
    if (!p.type) continue;
    n++;
    try {
      const b = check(p.type, p.json, `Block ${n} (${p.type})`, board, ctx);
      for (const x of [b, ...(b.blocks || [])]) {
        if (!x.tile) continue;
        const paths = x.type === 'chart' && x.style !== 'hbar' ? (x.series || [{ bind: x.bind }]).map((s) => s.bind) : x.type === 'kpi' && x.bind ? [x.bind] : [];
        if (paths.length) keeps[x.tile] = [...new Set([...(keeps[x.tile] || []), ...paths])];
      }
    } catch (e) {
      problems.push(e.message);
    }
  }
  return { problems, keeps };
}

// ---------- as text, for a document and a download ----------

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const arrow = (d) => (d ? `${d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '–'} ${d.text}` : '');
const kpiValue = (b) => [`${b.text || '–'}${b.unit ? ` ${b.unit}` : ''}`, b.of ? `of ${b.of}` : ''].filter(Boolean).join(' ');
const clock = (ms) => new Date(ms).toTimeString().slice(0, 5); // the server's clock, the owner's own

function plainBlock(b) {
  switch (b.type) {
    case 'hero': return [b.eyebrow ? `*${b.eyebrow}*` : '', `# ${b.title}`, b.lead || '', b.tags?.length ? b.tags.join(' · ') : ''].filter(Boolean).join('\n\n');
    case 'kpi': return `**${b.label || 'Value'}:** ${kpiValue(b)}${b.delta ? ` (${arrow(b.delta)})` : ''}${b.sub ? `. ${b.sub}` : ''}`;
    case 'status': return `**${b.level.toUpperCase()}** ${b.text}`;
    case 'callout': return `> ${b.title ? `**${b.title}** ` : ''}${String(b.text).replace(/\n/g, '\n> ')}`;
    case 'error': return '*(A block that could not be drawn.)*';
    case 'table': return `${b.text ? `**${b.text}**\n\n` : ''}${table(b.head.map((h) => h.label), b.rows.map((r) => r.map((c) => c.text)))}`;
    case 'chart': {
      const title = b.text ? `**${b.text}**\n\n` : '';
      if (b.style === 'hbar') return `${title}${table(['', 'Value'], (b.bars || []).map((x) => [x.label, x.text]))}`;
      const series = b.series?.length ? b.series : [{ points: b.points || [] }];
      const n = Math.max(...series.map((s) => s.points.length), 0);
      const name = (i) => b.labels?.[i] ?? (b.times?.[i] ? clock(b.times[i]) : String(i + 1));
      const unit = b.unit ? ` ${b.unit}` : '';
      return `${title}${table(['', ...series.map((s, i) => s.label || (series.length > 1 ? `Series ${i + 1}` : 'Value'))], Array.from({ length: n }, (_, i) => [name(i), ...series.map((s) => (Number.isFinite(s.points[i]) ? `${Math.round(s.points[i] * 100) / 100}${unit}` : ''))]))}`;
    }
    case 'grid': {
      if (b.blocks.every((x) => x.type === 'kpi')) return table(['', 'Value', 'Change', ''], b.blocks.map((x) => [x.label || '', kpiValue(x), arrow(x.delta), x.sub || '']));
      if (b.blocks.every((x) => x.type === 'status')) return b.blocks.map(plainBlock).join(' · ');
      return b.blocks.map(plainBlock).join('\n\n');
    }
    default: return '';
  }
}

// The page in plain Markdown, its blocks written out with the values they show now: text and tables. parts: what
// render() made of it.
const plainOf = (parts) => `${parts.map((p) => (p.md != null ? p.md.replace(/^\n+|\n+$/g, '') : plainBlock(p.block))).filter(Boolean).join('\n\n')}\n`;
const plain = (markdown, board) => plainOf(render(markdown, board).parts);

module.exports = { TYPES, SAY, split, hasBlocks, check, render, inspect, plain, plainOf };
