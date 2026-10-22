// Tiles built from blocks (see dashboard.js). What a tile shows (its face), the pop-up a tap opens (its
// panel) and its dot are written by the Chief or a bot as small blocks. botdot checks them here, and turns
// them into plain blocks for the clients: values filled in, rules and colours worked out, so the web page
// and the apps only draw what they get.
//
// Blocks read the tile's data: "value" is what its read answered (after its pick), and each named read in
// `reads` is there under its name ("value.attributes.brightness", "forecast.0.temperature"). Text takes
// {{path}} with filters: {{value.state|map:on=On,off=Off}}, {{value.attributes.brightness|percent:255}} %.
// {{value|ago}} turns a time into words ("9 hours ago") each time the tile is looked at, so it keeps counting.
//
//   showing   text, value (a big number), kpi (a number with its change, a sparkline and a bar), dot, list,
//             progress, gauge, chart (line, area, bar, stacked or horizontal bars; one or more series), status (a
//             pill: ok, warn, err, info, plan), callout (a box that stands out), image, chat (a link to its bot)
//   controls  switch, button, slider, color, choice. Each runs one of the tile's actions with what was picked
//             as {{value}} (a colour also as {{rgb}}, a switch also as {{onoff}}).
//   layout    row, column (blocks side by side, or under each other)
//
// Any block can have rules: [{ when: path, above / below / is / not / empty, set: { color, hidden, text, filled, level } }].
//
// A kpi or chart bound to one number keeps that number's recent values, each with its time, so it shows how it
// changed ("▲ 0.8 since 8:00") and a line of it. A value tile keeps its value's the same way.
const { pickValue } = require('./pick');

const SHOWING = ['text', 'value', 'kpi', 'dot', 'list', 'progress', 'gauge', 'chart', 'status', 'callout', 'image', 'chat'];
const CONTROLS = ['switch', 'button', 'slider', 'color', 'choice'];
const LAYOUT = ['row', 'column'];
const TYPES = [...SHOWING, ...CONTROLS, ...LAYOUT];
const COLOR_NAMES = ['ok', 'warn', 'bad', 'faint', 'muted', 'text', 'bot'];
const SIZES = ['small', 'wide', 'big', 'row'];
const TAPS = ['panel', 'refresh', 'chat', 'none'];
const LEVELS = ['ok', 'warn', 'err', 'info', 'plan']; // a status pill's or a callout's; "bad" is taken for err
const STYLES = ['line', 'area', 'bar', 'stacked', 'hbar'];
const GOOD = ['up', 'down', 'none'];
const MAX_SERIES = 4;
const MAX_BARS = 12;
const MAX_BLOCKS = 40; // face and panel together
const MAX_DEPTH = 3;
const MAX_HISTORY = 96;
const FILTERS = ['round', 'scale', 'percent', 'map', 'default', 'upper', 'lower', 'join', 'count', 'ago'];
const NAME = /^[a-z][a-z0-9_]{0,23}$/i;

const text = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => (v === '' || v == null || typeof v === 'boolean' ? NaN : Number(v));
const ON = /^(on|true|1|yes|open|opened|home|playing|unlocked|active|running|heat|cool|auto)$/i;
const UNKNOWN = /^(unavailable|unknown|none|null|)$/i;

// ---------- checking what the Chief wrote ----------

// ctx: { reads: names the data has ("value" and the named reads), images: image reads, actions: action names, count }
function checkPath(p, where, ctx) {
  const s = text(p, 200);
  if (!s) throw new Error(`${where}: say which value (e.g. "value.state")`);
  if (!/^[\w.[\]-]+$/.test(s)) throw new Error(`${where}: "${s}" isn't a path like "value.attributes.brightness"`);
  const head = s.split(/[.[]/)[0];
  if (!ctx.reads.includes(head)) {
    throw new Error(`${where}: "${s}" must start with ${ctx.reads.map((r) => `"${r}"`).join(' or ')} (the tile's read, or one of its named reads)`);
  }
  return s;
}

// A text with {{path|filter}} parts in it.
function checkTemplate(v, where, ctx, max = 500) {
  const s = String(v ?? '').slice(0, max);
  for (const [, inner] of s.matchAll(/\{\{([^}]*)\}\}/g)) {
    const [p, ...filters] = inner.split('|').map((x) => x.trim());
    checkPath(p, where, ctx);
    for (const f of filters) {
      const name = f.split(':')[0];
      if (!FILTERS.includes(name)) throw new Error(`${where}: unknown filter "${name}" (there are ${FILTERS.join(', ')})`);
    }
  }
  return s;
}

function checkColor(v, where, ctx) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (COLOR_NAMES.includes(s)) return s;
  if (/^\{\{[^}]+\}\}$/.test(s)) return checkTemplate(s, where, ctx, 200);
  throw new Error(`${where}: a colour is "#rrggbb", one of ${COLOR_NAMES.join(', ')}, or "{{path}}" to a colour in the data (like [255, 180, 60])`);
}

// A level: one of LEVELS, or "{{path}}" to one in the data (a map filter turns states into levels).
function checkLevel(v, where, ctx) {
  const s = String(v ?? '').trim();
  if (s === 'bad') return 'err';
  if (LEVELS.includes(s)) return s;
  if (/^\{\{[^}]+\}\}$/.test(s)) return checkTemplate(s, where, ctx, 200);
  throw new Error(`${where}: a level is one of ${LEVELS.join(', ')}, or "{{path}}" to one in the data`);
}

function checkAction(name, where, ctx) {
  const s = text(name, 40);
  if (!s) throw new Error(`${where}: say which action it runs`);
  if (!ctx.actions.includes(s)) throw new Error(`${where}: there's no action "${s}". Give the tile actions: { "${s}": { type: "http", … } }${ctx.actions.length ? ` (it has ${ctx.actions.join(', ')})` : ''}`);
  return s;
}

const bounded = (v, dflt) => (Number.isFinite(num(v)) ? Number(v) : dflt);

function checkRules(rules, where, ctx) {
  if (rules == null) return undefined;
  if (!Array.isArray(rules)) throw new Error(`${where}.rules: give a list`);
  if (rules.length > 8) throw new Error(`${where}.rules: at most 8`);
  return rules.map((r, i) => {
    const w = `${where}.rules[${i}]`;
    if (!r || typeof r !== 'object') throw new Error(`${w}: give { when, …, set }`);
    const out = { when: checkPath(r.when, w, ctx) };
    if (r.above != null) out.above = bounded(r.above, 0);
    if (r.below != null) out.below = bounded(r.below, 0);
    if (r.is != null) out.is = (Array.isArray(r.is) ? r.is : [r.is]).slice(0, 12).map((x) => text(x, 80));
    if (r.not != null) out.not = (Array.isArray(r.not) ? r.not : [r.not]).slice(0, 12).map((x) => text(x, 80));
    if (r.empty != null) out.empty = !!r.empty;
    const set = r.set && typeof r.set === 'object' ? r.set : {};
    out.set = {};
    if (set.color != null) out.set.color = checkColor(set.color, `${w}.set.color`, ctx);
    if (set.hidden != null) out.set.hidden = !!set.hidden;
    if (set.filled != null) out.set.filled = !!set.filled;
    if (set.text != null) out.set.text = checkTemplate(set.text, `${w}.set.text`, ctx, 200);
    if (set.level != null) out.set.level = checkLevel(set.level, `${w}.set.level`, ctx);
    if (!Object.keys(out.set).length) throw new Error(`${w}: say what it changes in set (color, hidden, text, filled, level)`);
    return out;
  });
}

function checkBlock(b, where, ctx, depth) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(`${where}: give a block like { "type": "text", "text": "…" }`);
  const type = b.type;
  if (!TYPES.includes(type)) throw new Error(`${where}: type must be one of ${TYPES.join(', ')}`);
  if (++ctx.count > MAX_BLOCKS) throw new Error(`A tile holds at most ${MAX_BLOCKS} blocks`);
  const w = `${where} (${type})`;
  const out = { type };
  const label = () => { if (b.label != null) out.label = checkTemplate(b.label, w, ctx, 80); };
  switch (type) {
    case 'text':
      out.text = checkTemplate(b.text, w, ctx);
      if (!out.text.trim()) throw new Error(`${w}: write its text`);
      if (b.size != null) { if (!['small', 'normal', 'large'].includes(b.size)) throw new Error(`${w}: size is small, normal or large`); out.size = b.size; }
      if (b.muted) out.muted = true;
      if (b.markdown) out.markdown = true;
      if (b.lines != null) out.lines = Math.min(Math.max(Math.round(bounded(b.lines, 3)), 1), 20);
      break;
    case 'value':
      out.text = checkTemplate(b.text ?? (b.bind ? `{{${b.bind}}}` : ''), w, ctx, 200);
      if (!out.text.trim()) throw new Error(`${w}: give bind (a path) or text`);
      if (b.unit != null) out.unit = text(b.unit, 12);
      if (b.color != null) out.color = checkColor(b.color, w, ctx);
      break;
    case 'kpi':
      out.text = checkTemplate(b.text ?? (b.bind ? `{{${b.bind}}}` : ''), w, ctx, 200);
      if (!out.text.trim()) throw new Error(`${w}: give bind (a path) or text`);
      if (b.bind != null) out.bind = checkPath(b.bind, w, ctx);
      if (b.unit != null) out.unit = text(b.unit, 12);
      if (b.of != null) out.of = checkTemplate(b.of, w, ctx, 40);
      if (b.sub != null) out.sub = checkTemplate(b.sub, w, ctx, 200);
      if (b.subColor != null) out.subColor = checkColor(b.subColor, w, ctx);
      if (b.color != null) out.color = checkColor(b.color, w, ctx);
      if (b.good != null) { if (!GOOD.includes(b.good)) throw new Error(`${w}: good is ${GOOD.join(', ')} (which way is good news)`); out.good = b.good; }
      if (b.spark === false) out.spark = false;
      if (b.change === false) out.change = false;
      if (b.max != null) {
        out.min = bounded(b.min, 0);
        out.max = bounded(b.max, 100);
        if (out.max === out.min) throw new Error(`${w}: min and max can't be the same`);
      }
      out.points = Math.min(Math.max(Math.round(bounded(b.points, 24)), 4), MAX_HISTORY);
      if (!out.bind) { delete out.points; delete out.spark; delete out.change; } // no history without a path
      label();
      break;
    case 'status':
      out.text = checkTemplate(b.text, w, ctx, 80);
      if (!out.text.trim()) throw new Error(`${w}: write its text`);
      out.level = checkLevel(b.level ?? 'info', w, ctx);
      break;
    case 'callout':
      out.text = checkTemplate(b.text, w, ctx, 1000);
      if (!out.text.trim()) throw new Error(`${w}: write its text`);
      out.level = checkLevel(b.level ?? 'info', w, ctx);
      if (b.title != null) out.title = checkTemplate(b.title, w, ctx, 80);
      break;
    case 'dot':
      if (b.on != null) out.on = checkPath(b.on, w, ctx);
      if (b.onValue != null) out.onValue = text(b.onValue, 40);
      if (b.color != null) out.color = checkColor(b.color, w, ctx);
      if (b.big) out.big = true;
      label();
      break;
    case 'list':
      out.bind = checkPath(b.bind, w, ctx);
      if (b.item != null) out.item = text(b.item, 100);
      out.max = Math.min(Math.max(Math.round(bounded(b.max, 8)), 1), 20);
      break;
    case 'progress':
    case 'gauge':
      out.bind = checkPath(b.bind, w, ctx);
      out.min = bounded(b.min, 0);
      out.max = bounded(b.max, 100);
      if (out.max === out.min) throw new Error(`${w}: min and max can't be the same`);
      if (b.unit != null) out.unit = text(b.unit, 12);
      if (b.color != null) out.color = checkColor(b.color, w, ctx);
      label();
      break;
    case 'chart': {
      if (b.style != null) { if (!STYLES.includes(b.style)) throw new Error(`${w}: style is one of ${STYLES.join(', ')}`); if (b.style !== 'line') out.style = b.style; }
      if (b.series != null) {
        if (!Array.isArray(b.series) || !b.series.length || b.series.length > MAX_SERIES) throw new Error(`${w}: series is 1 to ${MAX_SERIES} of { "bind": path, "label": "CPU", "color": … }`);
        if (out.style === 'hbar') throw new Error(`${w}: horizontal bars take one bind (a list or an object of numbers), not series`);
        out.series = b.series.map((x, i) => {
          if (!x || typeof x !== 'object') throw new Error(`${w}.series[${i}]: give { "bind": path, "label": "…" }`);
          return { bind: checkPath(x.bind, `${w}.series[${i}]`, ctx), ...(x.label != null ? { label: text(x.label, 30) } : {}), ...(x.color != null ? { color: checkColor(x.color, `${w}.series[${i}]`, ctx) } : {}) };
        });
        out.bind = out.series[0].bind;
      } else out.bind = checkPath(b.bind, w, ctx);
      out.points = Math.min(Math.max(Math.round(bounded(b.points, 24)), 4), MAX_HISTORY);
      if (b.color != null) out.color = checkColor(b.color, w, ctx);
      if (b.unit != null) out.unit = text(b.unit, 12);
      if (b.item != null) out.item = text(b.item, 100); // in a list of objects: the number of each
      if (b.labelItem != null) out.labelItem = text(b.labelItem, 100); // and its name, under its bar or point
      if (b.max != null) out.max = bounded(b.max, 100); // horizontal bars: what a full bar is (else the largest)
      label();
      break;
    }
    case 'image':
      out.read = text(b.read, 24);
      if (!ctx.images.includes(out.read)) throw new Error(`${w}: read must name one of the tile's reads with "image": true${ctx.images.length ? ` (${ctx.images.join(', ')})` : ''}`);
      if (b.height != null) { if (!['small', 'normal', 'large'].includes(b.height)) throw new Error(`${w}: height is small, normal or large`); out.height = b.height; }
      if (b.fit != null) { if (!['cover', 'contain'].includes(b.fit)) throw new Error(`${w}: fit is cover or contain`); out.fit = b.fit; }
      break;
    case 'chat':
      label();
      break;
    case 'switch':
      out.on = checkPath(b.on, w, ctx);
      if (b.onValue != null) out.onValue = text(b.onValue, 40);
      if (b.action != null) out.action = checkAction(b.action, w, ctx);
      else if (b.onAction != null || b.offAction != null) { out.onAction = checkAction(b.onAction, `${w} onAction`, ctx); out.offAction = checkAction(b.offAction, `${w} offAction`, ctx); }
      else throw new Error(`${w}: give action (it gets {{value}} true or false, and {{onoff}}), or onAction and offAction`);
      label();
      break;
    case 'button':
      out.label = checkTemplate(b.label, w, ctx, 60);
      if (!out.label.trim()) throw new Error(`${w}: give it a label`);
      out.action = checkAction(b.action, w, ctx);
      if (b.value !== undefined) { if (JSON.stringify(b.value).length > 500) throw new Error(`${w}: keep value short`); out.value = b.value; }
      break;
    case 'slider':
      if (b.bind != null) out.bind = checkPath(b.bind, w, ctx);
      out.action = checkAction(b.action, w, ctx);
      out.min = bounded(b.min, 0);
      out.max = bounded(b.max, 100);
      if (out.max <= out.min) throw new Error(`${w}: max must be above min`);
      out.step = Math.abs(bounded(b.step, 1)) || 1;
      if (b.unit != null) out.unit = text(b.unit, 12);
      if (b.percent) out.percent = true; // shown as a percentage of min–max (a light's 0–255 brightness as 0–100 %)
      label();
      break;
    case 'color':
      if (b.bind != null) out.bind = checkPath(b.bind, w, ctx);
      out.action = checkAction(b.action, w, ctx);
      label();
      break;
    case 'choice': {
      const opts = Array.isArray(b.options) ? b.options : [];
      if (!opts.length || opts.length > 12) throw new Error(`${w}: give 1 to 12 options, e.g. ["Warm", "Cool"] or [{ "label": "Warm", "value": "warm" }]`);
      out.options = opts.map((o) => {
        const x = o && typeof o === 'object' ? o : { label: o, value: o };
        const value = typeof x.value === 'number' || typeof x.value === 'boolean' ? x.value : text(x.value ?? x.label, 80);
        return { label: text(x.label ?? x.value, 30), value };
      });
      if (b.bind != null) out.bind = checkPath(b.bind, w, ctx);
      out.action = checkAction(b.action, w, ctx);
      label();
      break;
    }
    case 'row':
    case 'column':
      if (depth >= MAX_DEPTH) throw new Error(`${w}: rows and columns go at most ${MAX_DEPTH} deep`);
      if (!Array.isArray(b.blocks) || !b.blocks.length) throw new Error(`${w}: give its blocks`);
      out.blocks = b.blocks.map((x, i) => checkBlock(x, `${where}.blocks[${i}]`, ctx, depth + 1));
      break;
    default:
  }
  const rules = checkRules(b.rules, w, ctx);
  if (rules) out.rules = rules;
  return out;
}

function checkBlocks(list, where, ctx) {
  if (list == null) return null;
  if (!Array.isArray(list)) throw new Error(`${where}: give a list of blocks`);
  return list.map((b, i) => checkBlock(b, `${where}[${i}]`, ctx, 1));
}

// The tile's own dot: { on, onValue, color, big, rules }, or false for none.
function checkDot(d, ctx) {
  if (d == null) return null;
  if (d === false) return false;
  if (typeof d !== 'object') throw new Error('dot: give { on, color, big } or false');
  const b = checkBlock({ ...d, type: 'dot' }, 'dot', ctx, 1);
  delete b.type;
  delete b.label;
  return b;
}

// Everything about a tile's look, checked. t: the tile with its sources already checked.
function check(input, t) {
  const images = Object.entries(t.reads || {}).filter(([, s]) => s.image).map(([n]) => n);
  const ctx = {
    reads: ['value', ...Object.keys(t.reads || {}).filter((n) => !images.includes(n))], // "value": its read, or what its bot put there
    images,
    actions: [...['do', 'turnOn', 'turnOff'].filter((a) => t[a]), ...Object.keys(t.actions || {})],
    count: 0,
  };
  const out = {
    dot: checkDot(input.dot, ctx),
    face: checkBlocks(input.face, 'face', ctx),
    panel: checkBlocks(input.panel, 'panel', ctx),
    tap: null,
  };
  if (input.tap != null && input.tap !== '') {
    const tap = text(input.tap, 40);
    if (!TAPS.includes(tap) && !ctx.actions.includes(tap)) throw new Error(`tap is ${TAPS.join(', ')}, or the name of one of its actions${ctx.actions.length ? ` (${ctx.actions.join(', ')})` : ''}`);
    if (tap === 'panel' && !out.panel) throw new Error('tap "panel" needs a panel: the blocks the pop-up shows');
    out.tap = tap;
  }
  return out;
}

// Named reads or actions: { name: source }. clean: the source checker from dashboard.js.
function checkNamed(obj, what, clean, reserved = []) {
  if (obj == null) return null;
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${what}: give { name: source }`);
  const entries = Object.entries(obj).filter(([, s]) => s != null);
  if (entries.length > 12) throw new Error(`${what}: at most 12`);
  const out = {};
  for (const [name, s] of entries) {
    if (!NAME.test(name) || reserved.includes(name)) throw new Error(`${what}: "${name}" isn't a good name (letters, digits and _, not ${reserved.join(', ')})`);
    out[name] = clean(s, `${what}.${name}`);
  }
  return Object.keys(out).length ? out : null;
}

// ---------- filling in a tile's blocks with its data ----------

// "#rrggbb" from what a light reports: [r, g, b], "#rrggbb", "rgb(r, g, b)".
function toHex(v) {
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => Number.isFinite(Number(x)))) {
    return `#${v.slice(0, 3).map((x) => Math.min(Math.max(Math.round(Number(x)), 0), 255).toString(16).padStart(2, '0')).join('')}`;
  }
  const s = String(v ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  const m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? toHex(m.slice(1, 4)) : null;
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const get = (scope, p) => pickValue(scope, p);
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || UNKNOWN.test(String(v));

function shortText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return v.map(shortText).join(', ');
  if (typeof v === 'object') return String(v.title ?? v.name ?? v.summary ?? v.message ?? v.text ?? JSON.stringify(v));
  return String(v);
}

// A time (ISO 8601, or epoch milliseconds) as words, counted down to the whole unit; anything else as it is.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ago(v, now) {
  const s = typeof v === 'string' ? v.trim() : v;
  const ms = typeof s === 'number' || /^\d+$/.test(s ?? '') ? Number(s) : /^\d{4}-\d{2}-\d{2}/.test(s ?? '') ? Date.parse(s) : NaN;
  if (!Number.isFinite(ms) || ms < 1e11) return v; // not a time ("n/a", "", 42)
  const words = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  const min = Math.floor((now - ms) / 60e3);
  if (min < 1) return 'just now'; // a time in the future too
  if (min < 60) return words(min, 'minute');
  if (min < 24 * 60) return words(Math.floor(min / 60), 'hour');
  if (min < 7 * 24 * 60) return words(Math.floor(min / (24 * 60)), 'day');
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function filter(v, f, now = Date.now()) {
  const i = f.indexOf(':');
  const name = i < 0 ? f : f.slice(0, i);
  const arg = i < 0 ? '' : f.slice(i + 1);
  const n = num(v);
  switch (name) {
    case 'round': return Number.isFinite(n) ? n.toFixed(Math.min(Math.max(Number(arg) || 0, 0), 6)) : v;
    case 'scale': return Number.isFinite(n) && Number.isFinite(Number(arg)) ? Math.round(n * Number(arg) * 1e6) / 1e6 : v;
    case 'percent': return Number.isFinite(n) && Number(arg) ? Math.round((n / Number(arg)) * 100) : v;
    case 'map': {
      const pairs = arg.split(',').map((x) => x.split('='));
      const hit = pairs.find(([k]) => String(k).trim().toLowerCase() === String(v ?? '').toLowerCase());
      return hit ? (hit[1] ?? '').trim() : v;
    }
    case 'default': return isEmpty(v) ? arg : v;
    case 'upper': return String(v ?? '').toUpperCase();
    case 'lower': return String(v ?? '').toLowerCase();
    case 'join': return Array.isArray(v) ? v.map(shortText).join(arg || ', ') : v;
    case 'count': return Array.isArray(v) ? v.length : v == null ? 0 : 1;
    case 'ago': return ago(v, now);
    default: return v;
  }
}

function fill(template, scope, now = Date.now()) {
  return String(template ?? '').replace(/\{\{([^}]*)\}\}/g, (_, inner) => {
    const [p, ...fs] = inner.split('|').map((x) => x.trim());
    let v = get(scope, p);
    for (const f of fs) v = filter(v, f, now);
    return shortText(v);
  }).trim();
}

// A colour for the clients: "#rrggbb", one of the names (they know those), or null (the tile's own colour).
function colorOf(spec, scope) {
  if (!spec || spec === 'bot') return null;
  if (spec.startsWith('{{')) {
    const inner = spec.slice(2, -2).split('|')[0].trim();
    return toHex(get(scope, inner)) || (COLOR_NAMES.includes(fill(spec, scope)) ? fill(spec, scope) : null);
  }
  return spec;
}

function isOn(v, onValue) {
  if (v == null || (typeof v !== 'boolean' && UNKNOWN.test(String(v)))) return null;
  return onValue ? String(v) === onValue : v === true || ON.test(String(v));
}

function applyRules(b, scope) {
  const over = {};
  for (const r of b.rules || []) {
    const v = get(scope, r.when);
    const n = num(v);
    const ok = (r.above == null || (Number.isFinite(n) && n > r.above))
      && (r.below == null || (Number.isFinite(n) && n < r.below))
      && (r.is == null || r.is.some((x) => x.toLowerCase() === String(v ?? '').toLowerCase()))
      && (r.not == null || !r.not.some((x) => x.toLowerCase() === String(v ?? '').toLowerCase()))
      && (r.empty == null || isEmpty(v) === r.empty);
    if (ok) Object.assign(over, r.set);
  }
  return over;
}

// A level for the clients, from what the block says or a rule set: one of LEVELS, else info.
function levelOf(spec, scope) {
  const s = String(spec ?? '').startsWith('{{') ? fill(spec, scope).toLowerCase() : String(spec ?? '');
  if (s === 'bad') return 'err';
  return LEVELS.includes(s) ? s : 'info';
}

// The last n of a path's recent values, with their times (epoch ms) when every one of them has one.
function recent(ctx, p, n) {
  const points = (ctx.history?.[p] || []).slice(-n);
  const at = (ctx.times?.[p] || []).slice(-points.length);
  return { points, times: points.length && at.length === points.length && at.every(Number.isFinite) ? at : null };
}
const decimals = (n) => (String(n).split('.')[1] || '').length;
// How a number changed over its recent values: { text, dir: up | down | flat, good: true | false | null }.
// good: which way is good news ("up", the default; "down" for errors or a queue; "none").
function deltaOf(points, good = 'up') {
  const first = points[0];
  const last = points[points.length - 1];
  const d = last - first;
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const text = String(Number(Math.abs(d).toFixed(Math.min(Math.max(decimals(first), decimals(last)), 2))));
  return { text, dir, good: dir === 'flat' || good === 'none' ? null : dir === good };
}

// A chart's data, filled in: { points, labels? } of one series from a list in the data (numbers, or objects
// with `item`), or else from the path's recent values ({ points, times }).
function seriesOf(b, p, scope, ctx) {
  const v = get(scope, p);
  if (Array.isArray(v)) {
    const rows = v.slice(-b.points);
    const out = { points: rows.map((x) => num(b.item ? pickValue(x, b.item) : x)).map((n) => (Number.isFinite(n) ? n : null)) };
    if (b.labelItem) out.labels = rows.map((x) => text(shortText(pickValue(x, b.labelItem)), 20));
    return out;
  }
  return recent(ctx, p, b.points);
}

// Horizontal bars: one per item of a list (with `item` and `labelItem`) or per field of an object of numbers.
function barsOf(b, scope) {
  const v = get(scope, b.bind);
  const rows = Array.isArray(v) ? v.map((x, i) => [b.labelItem ? shortText(pickValue(x, b.labelItem)) : shortText(x?.label ?? x?.name ?? i + 1), num(b.item ? pickValue(x, b.item) : x)])
    : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => [k, num(x)]) : [];
  const kept = rows.filter(([, n]) => Number.isFinite(n)).slice(0, MAX_BARS);
  const max = b.max ?? Math.max(...kept.map(([, n]) => n), 0);
  return kept.map(([label, n]) => ({ label: text(label, 40), text: `${shortText(n)}${b.unit ? ` ${b.unit}` : ''}`, ratio: max > 0 ? Math.min(Math.max(n / max, 0), 1) : 0 }));
}

const ratio = (v, min, max) => (Number.isFinite(num(v)) ? Math.min(Math.max((Number(v) - min) / (max - min), 0), 1) : null);

// One block, filled in. key: where it is ("f0", "p1.2"), for the controls' answers.
function resolveBlock(b, key, scope, ctx) {
  const over = applyRules(b, scope);
  if (over.hidden) return null;
  const color = over.color !== undefined ? colorOf(over.color, scope) : colorOf(b.color, scope);
  const label = over.text !== undefined ? fill(over.text, scope) : b.label != null ? fill(b.label, scope) : undefined;
  const out = { type: b.type };
  switch (b.type) {
    case 'text':
      Object.assign(out, { text: over.text !== undefined ? fill(over.text, scope) : fill(b.text, scope) }, b.size && { size: b.size }, b.muted && { muted: true }, b.markdown && { markdown: true }, b.lines && { lines: b.lines });
      break;
    case 'value':
      Object.assign(out, { text: over.text !== undefined ? fill(over.text, scope) : fill(b.text, scope) }, b.unit && { unit: b.unit }, color && { color });
      break;
    case 'dot': {
      const on = b.on ? isOn(get(scope, b.on), b.onValue) : true;
      Object.assign(out, { filled: over.filled ?? on }, color && { color }, b.big && { big: true }, label && { label });
      break;
    }
    case 'list': {
      const v = get(scope, b.bind);
      const items = Array.isArray(v) ? v : isEmpty(v) ? [] : String(v).split('\n');
      out.items = items.map((x) => text(shortText(b.item ? pickValue(x, b.item) : x), 200)).filter(Boolean).slice(0, 20);
      out.max = b.max;
      break;
    }
    case 'progress':
    case 'gauge': {
      const v = get(scope, b.bind);
      const n = num(v);
      Object.assign(out, { ratio: ratio(v, b.min, b.max), text: label ?? (Number.isFinite(n) ? `${shortText(n)}${b.unit ? ` ${b.unit}` : ''}` : '') }, color && { color });
      break;
    }
    case 'kpi': {
      out.text = over.text !== undefined ? fill(over.text, scope) : fill(b.text, scope);
      if (b.unit) out.unit = b.unit;
      if (b.of != null) { const of = fill(b.of, scope); if (of) out.of = of; }
      if (b.sub != null) { const sub = fill(b.sub, scope); if (sub) out.sub = sub; }
      const subColor = colorOf(b.subColor, scope);
      if (out.sub && subColor) out.subColor = subColor;
      if (color) out.color = color;
      if (label) out.label = label;
      if (b.bind) {
        const { points, times } = recent(ctx, b.bind, b.points);
        if (points.length >= 2 && b.spark !== false) Object.assign(out, { points }, times && { times });
        if (points.length >= 2 && b.change !== false) Object.assign(out, { delta: deltaOf(points, b.good) }, times && { since: new Date(times[0]).toISOString() });
      }
      if (b.max != null) out.ratio = ratio(b.bind ? get(scope, b.bind) : out.text, b.min, b.max);
      break;
    }
    case 'chart': {
      if (b.style) out.style = b.style;
      if (b.style === 'hbar') {
        Object.assign(out, { points: [], bars: barsOf(b, scope) }, color && { color }, label && { text: label });
        break;
      }
      const series = (b.series || [{ bind: b.bind }]).map((x) => ({ ...x, ...seriesOf(b, x.bind, scope, ctx) }));
      const first = series[0];
      Object.assign(out, { points: first.points.filter(Number.isFinite) }, color && { color }, label && { text: label }, b.unit && { unit: b.unit });
      if (b.series) out.series = series.map((x) => { const c = colorOf(x.color, scope); return { points: x.points, ...(x.label ? { label: x.label } : {}), ...(c ? { color: c } : {}) }; });
      if (first.times) out.times = first.times;
      if (first.labels) out.labels = first.labels;
      break;
    }
    case 'status':
      Object.assign(out, { text: over.text !== undefined ? fill(over.text, scope) : fill(b.text, scope), level: levelOf(over.level ?? b.level, scope) });
      if (!out.text) return null;
      break;
    case 'callout':
      Object.assign(out, { text: over.text !== undefined ? fill(over.text, scope) : fill(b.text, scope), level: levelOf(over.level ?? b.level, scope) });
      if (b.title != null) { const title = fill(b.title, scope); if (title) out.title = title; }
      if (!out.text) return null;
      break;
    case 'image':
      Object.assign(out, { src: `/dashboard/tiles/${encodeURIComponent(ctx.id)}/image/${encodeURIComponent(b.read)}?v=${encodeURIComponent(ctx.at || '')}` }, b.height && { height: b.height }, b.fit && { fit: b.fit });
      break;
    case 'chat':
      if (label) out.label = label;
      break;
    case 'switch':
      Object.assign(out, { key, on: isOn(get(scope, b.on), b.onValue) }, label && { label });
      break;
    case 'button':
      Object.assign(out, { key, label: fill(b.label, scope) });
      break;
    case 'slider': {
      const n = b.bind ? num(get(scope, b.bind)) : NaN;
      Object.assign(out, { key, value: Number.isFinite(n) ? Math.min(Math.max(n, b.min), b.max) : null, min: b.min, max: b.max, step: b.step }, b.unit && { unit: b.unit }, b.percent && { percent: true }, label && { label });
      break;
    }
    case 'color':
      Object.assign(out, { key, value: b.bind ? toHex(get(scope, b.bind)) : null }, label && { label });
      break;
    case 'choice': {
      const v = b.bind ? get(scope, b.bind) : undefined;
      const hit = b.options.find((o) => String(o.value).toLowerCase() === String(v ?? '').toLowerCase());
      Object.assign(out, { key, options: b.options, value: hit ? hit.value : null }, label && { label });
      break;
    }
    case 'row':
    case 'column':
      out.blocks = resolveList(b.blocks, key, scope, ctx);
      if (!out.blocks.length) return null;
      break;
    default:
  }
  return out;
}

function resolveList(list, prefix, scope, ctx) {
  return (list || []).map((b, i) => resolveBlock(b, prefix.length === 1 ? `${prefix}${i}` : `${prefix}.${i}`, scope, ctx)).filter(Boolean);
}

// ---------- the ready-made looks of the six kinds ----------

// A value tile's number as it changed: its recent values, a sparkline of them and the change, as a kpi has them.
// Which way is good news comes from its levels: "warn at 70, bad at 90" makes up bad news.
function valueSpark(t, ctx) {
  const { points, times } = recent(ctx, 'value', 24);
  if (points.length < 2) return {};
  const good = t.levels ? (t.levels.bad >= t.levels.warn ? 'down' : 'up') : 'none';
  return { points, ...(times ? { times, since: new Date(times[0]).toISOString() } : {}), delta: deltaOf(points, good) };
}

// The tile as the clients draw it: { dot, face, panel, tap, short }. data: { value, …named reads }; shaped: the
// value as its kind shows it (see dashboard.js shape()); history: the charts' earlier values.
function look(t, { data = {}, shaped = null, history = {}, times = {}, at = null } = {}) {
  const scope = { ...data };
  const ctx = { id: t.id, history, times, at };
  let dot = { filled: true };
  let face = [];
  let panel = null;
  let tap = 'none';
  switch (t.kind) {
    case 'switch':
      dot = { filled: shaped === true ? true : shaped === false ? false : null, big: true };
      tap = 'toggle';
      break;
    case 'button':
      dot = { filled: true, big: true };
      tap = 'act';
      break;
    case 'value':
      dot = shaped?.level ? { filled: true, color: shaped.level } : { filled: true };
      face = [{ type: 'value', text: shaped?.text || '', ...(t.unit ? { unit: t.unit } : {}), ...valueSpark(t, ctx) }];
      tap = t.do ? 'act' : t.read ? 'refresh' : 'chat';
      break;
    case 'list':
      face = [{ type: 'list', items: Array.isArray(shaped) ? shaped : [], max: 3 }];
      panel = [{ type: 'list', items: Array.isArray(shaped) ? shaped : [], max: 20 }, { type: 'chat' }];
      tap = 'panel';
      break;
    case 'note':
      face = [{ type: 'text', text: shaped || '', markdown: true, lines: 3 }];
      panel = [{ type: 'text', text: shaped || '', markdown: true }, { type: 'chat' }];
      tap = 'panel';
      break;
    case 'group':
      dot = null;
      tap = 'group';
      break;
    default:
  }
  if (t.dot === false) dot = null;
  else if (t.dot) {
    const d = resolveBlock({ ...t.dot, type: 'dot' }, 'd', scope, ctx);
    dot = d ? { filled: d.filled, ...(d.color ? { color: d.color } : {}), ...(d.big ? { big: true } : {}) } : null;
  }
  if (t.face) face = resolveList(t.face, 'f', scope, ctx);
  if (t.panel) panel = resolveList(t.panel, 'p', scope, ctx);
  if (t.tap) tap = TAPS.includes(t.tap) ? t.tap : 'act';
  else if (t.panel && t.kind !== 'group') tap = 'panel';
  // In the one-line strip: the first value it shows.
  const first = (list) => { for (const b of list || []) { if (b.type === 'value' && b.text) return `${b.text}${b.unit ? ` ${b.unit}` : ''}`; const x = b.blocks && first(b.blocks); if (x) return x; } return ''; };
  return { dot, face, panel, tap, short: first(face) };
}

// ---------- a control's answer ----------

// The block a key points at: "f0", "p1.2".
function blockAt(t, key) {
  const m = String(key || '').match(/^([fp])(\d+(?:\.\d+)*)$/);
  if (!m) return null;
  let list = m[1] === 'f' ? t.face : t.panel;
  let b = null;
  for (const i of m[2].split('.').map(Number)) {
    b = list?.[i];
    if (!b) return null;
    list = b.blocks;
  }
  return b;
}

// What the owner did with a control: which action runs, and the values it fills in.
function control(t, key, value) {
  const b = blockAt(t, key);
  if (!b || !CONTROLS.includes(b.type)) throw new Error('That control is gone. Pull to refresh.');
  switch (b.type) {
    case 'switch': {
      if (typeof value !== 'boolean') throw new Error('A switch takes true or false');
      return { action: b.action || (value ? b.onAction : b.offAction), vars: { value, onoff: value ? 'on' : 'off' }, bind: b.on, value };
    }
    case 'button':
      return { action: b.action, vars: { value: b.value ?? null }, bind: null };
    case 'slider': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error('A slider takes a number');
      const v = Math.min(Math.max(Math.round((n - b.min) / b.step) * b.step + b.min, b.min), b.max);
      const clean = Math.round(v * 1e6) / 1e6;
      return { action: b.action, vars: { value: clean }, bind: b.bind, value: clean };
    }
    case 'color': {
      const hex = toHex(value);
      if (!hex) throw new Error('A colour is "#rrggbb"');
      return { action: b.action, vars: { value: hex, rgb: rgbOf(hex) }, bind: b.bind, value: hex };
    }
    case 'choice': {
      const hit = b.options.find((o) => String(o.value) === String(value));
      if (!hit) throw new Error('That isn\'t one of its options');
      return { action: b.action, vars: { value: hit.value }, bind: b.bind, value: hit.value };
    }
    default:
      throw new Error('That control is gone.');
  }
}

// A source with {{value}}, {{rgb}} and {{onoff}} filled in. A body field that is just "{{value}}" keeps its
// type (a number stays a number, a colour's rgb stays a list); inside other text it's written out.
const VAR = /\{\{\s*(value|rgb|onoff)\s*\}\}/g;
const ONLY_VAR = /^\{\{\s*(value|rgb|onoff)\s*\}\}$/;
function fillSource(source, vars) {
  if (!source || !vars) return source;
  const str = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const inText = (s) => String(s).replace(VAR, (_, k) => str(vars[k]));
  const walk = (x) => {
    if (typeof x === 'string') { const m = x.match(ONLY_VAR); return m ? (vars[m[1]] ?? null) : inText(x); }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]));
    return x;
  };
  const out = { ...source };
  if (out.type === 'http') {
    out.url = String(out.url).replace(VAR, (_, k) => encodeURIComponent(str(vars[k])));
    if (out.body != null) out.body = typeof out.body === 'string' ? inText(out.body) : walk(out.body);
  }
  if (out.type === 'bot') out.message = inText(out.message);
  return out;
}

// The paths the charts plot, so each refresh keeps their values (a chart tile keeps reading while nobody looks).
function chartPaths(t) {
  const out = new Set();
  const walk = (list) => { for (const b of list || []) { if (b.type === 'chart' && b.style !== 'hbar') for (const x of b.series || [{ bind: b.bind }]) out.add(x.bind); walk(b.blocks); } };
  walk(t.face);
  walk(t.panel);
  return [...out];
}
// Every path whose recent values a tile keeps: its charts', its kpis', and a value tile's own value.
function historyPaths(t) {
  const out = new Set(chartPaths(t));
  const walk = (list) => { for (const b of list || []) { if (b.type === 'kpi' && b.bind) out.add(b.bind); walk(b.blocks); } };
  walk(t.face);
  walk(t.panel);
  if (t.kind === 'value' && !t.face) out.add('value');
  return [...out];
}

// Put a picked value where the tile's data has it, so a control shows its new state before the read after it.
function setAt(data, p, value) {
  const parts = String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  if (!parts.length || parts.some((x) => x.endsWith('[]'))) return;
  let o = data;
  for (const k of parts.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') return; // not there: leave it to the read
    o = o[k];
  }
  const last = parts[parts.length - 1];
  const prev = o[last];
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value) && Array.isArray(prev)) o[last] = rgbOf(value);
  else if (typeof value === 'boolean' && typeof prev === 'string') o[last] = value ? 'on' : 'off';
  else o[last] = value;
}

module.exports = { TYPES, CONTROLS, SIZES, TAPS, LEVELS, COLOR_NAMES, STYLES, GOOD, MAX_HISTORY, MAX_SERIES, MAX_BARS, check, checkBlock, checkNamed, look, resolveBlock, control, fillSource, chartPaths, historyPaths, setAt, fill, toHex, blockAt, deltaOf };
