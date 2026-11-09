// A bot's mark, drawn as SVG from the one definition the botdot server hands out (GET /api/figure,
// lib/figure.json; docs/adr/003-one-figure-definition-for-all-apps.md): a tile in the bot's colour with
// its icon, a ring or a dot for its state (the definition's `tile`, docs/adr/169-a-bot-is-an-icon-on-a-
// tile-in-its-colour.md). A definition without `tile` is drawn as ADR 003's head: the face of its state
// and its hat. This file is only a renderer: the tile, the icons, the head, the faces, their movements
// and the hats all come from the definition.
//
//   Figure.use(definition)   check it and draw from it from now on (throws when it's not one this page knows);
//                            the bare heads already on the page are drawn again from it
//   Figure.svg(state, color, outfit) the head as SVG markup: the state's face, in the colour, with its hat
//   Figure.small(color, outfit, bot) the small mark beside a bot's name: the head and its hat, no eyes, still;
//                            bot (its id, when given) is kept on the mark as data-bot, so the page can find it
//   Figure.css()             the movements as CSS keyframes (use() puts them on the page)
//   Figure.chief()           the Chief of Staff's fixed outfit, from the definition
//   Figure.CHIEF             given as the outfit: the Chief's, whichever definition is in use when it is drawn
//
// Three <g>, one inside the other: l-head (everything), l-eyes (the face) and l-pupils (what looks
// around). A layer that moves in a state gets CSS keyframes. --ph (set from the clock) keeps a movement
// where it was when the head is drawn again. Until a definition is in use, svg() draws the one bare
// head built in here, which carries what was asked for (data-asked) so that use() can draw it properly
// when the definition arrives late.
//
// An outfit is { hat }: the name of a hat in the definition's kit, or a hat given inline as { shapes }
// (docs/adr/004-pieces-as-restricted-shape-lists.md). A hat is a short list of shapes, drawn here shape
// by shape from its numbers; nothing in it is used as markup. A hat this page can't draw whole (a name
// the kit lacks, a shape it doesn't know) is left out, and the head is drawn without it. The limits of
// a hat are checked on the server (lib/pieces.js), not here.

(function (root) {

const VERSION = 2; // the format this renderer knows
const CHIEF = 'chief'; // in place of an outfit: the one the definition gives the Chief of Staff
const EASINGS = { linear: 'linear', 'ease-in-out': 'cubic-bezier(.42, 0, .58, 1)' };
const NAME = /^[a-z][a-z0-9_]*$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const GREY = '#888780';
// The layers, outermost first, and what a pose may say of each.
const LAYERS = { head: ['move', 'turn'], eyes: ['move', 'scale'], pupils: ['move'] };
// No definition (it didn't load, or isn't one this page knows): one bare head looking ahead, no states, no hat.
const BARE = {
  box: [24, 24], head: { cx: 12, cy: 16.5, r: 7.5 }, tones: { white: '#ffffff', ink: '#24231f' },
  eyes: [{ shape: 'circle', cx: 8.8, cy: 17.1, r: 2.2, fill: 'white' }, { shape: 'circle', cx: 15.2, cy: 17.1, r: 2.2, fill: 'white' }],
  pupils: [{ shape: 'circle', cx: 8.8, cy: 17.1, r: 1.2, fill: 'ink' }, { shape: 'circle', cx: 15.2, cy: 17.1, r: 1.2, fill: 'ink' }],
};

let def = null;
let moves = '';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(num);
const n = (v) => String(Math.round(v * 1000) / 1000);
const paint = (color) => String(color || GREY).replace(/[^#\w(),.% -]/g, '') || GREY;
// A bare head remembers what it stands for: text in an attribute, read back by redraw() as data only.
const attr = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const asked = (what) => ` data-asked="${attr(JSON.stringify(what))}"`;

// What a path may be made of, and how many numbers each command takes.
const COMMANDS = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
const HAT_TONES = ['main', 'deep']; // a hat is in two tones of the bot's colour
const FACE_TONES = ['main', 'deep', 'white', 'ink']; // a face also has the white of an eye and the ink of a pupil

function fail(why) { throw new Error(`Figure definition: ${why}`); }

// A number of a shape, as SVG text. Anything else stops the shape's piece.
function numberOf(v) {
  if (!num(v)) throw new Error('not a number');
  return n(v);
}
// One shape: filled, stroked or both, each in one of the tones. A tone that is not one of them stops the
// shape's piece, like a shape that is not one: a piece is drawn whole or not at all.
function shapeSvg(s, tones) {
  for (const k of ['fill', 'stroke']) if (s[k] !== undefined && !tones.includes(s[k])) throw new Error('not a tone');
  const fill = s.fill ?? 'none';
  const stroke = s.stroke ?? 'none';
  if (fill === 'none' && stroke === 'none') throw new Error('no tone');
  const look = `class="f-${fill} s-${stroke}"${stroke === 'none' ? '' : ` stroke-width="${numberOf(s.width)}"`}`;
  if (s.shape === 'rect') return `<rect ${look} x="${numberOf(s.x)}" y="${numberOf(s.y)}" width="${numberOf(s.w)}" height="${numberOf(s.h)}"${s.r === undefined ? '' : ` rx="${numberOf(s.r)}"`}/>`;
  if (s.shape === 'circle') return `<circle ${look} cx="${numberOf(s.cx)}" cy="${numberOf(s.cy)}" r="${numberOf(s.r)}"/>`;
  if (s.shape === 'line') return `<line ${look} x1="${numberOf(s.x1)}" y1="${numberOf(s.y1)}" x2="${numberOf(s.x2)}" y2="${numberOf(s.y2)}"/>`;
  if (s.shape === 'path' && Array.isArray(s.d)) {
    return `<path ${look} d="${s.d.map((c) => {
      if (!Array.isArray(c) || !Object.hasOwn(COMMANDS, c[0]) || c.length !== COMMANDS[c[0]] + 1) throw new Error('not a path command');
      return c[0] + c.slice(1).map(numberOf).join(' ');
    }).join('')}"/>`;
  }
  throw new Error('not a shape');
}
const shapesSvg = (shapes, tones) => shapes.map((s) => shapeSvg(s || {}, tones)).join('');

// Where the layers are (the still pose, or a key over it): each layer's move, turn and scale.
function checkPose(p, what) {
  if (p === undefined) return;
  if (Array.isArray(p) && !p.length) return; // an empty list says nothing of any layer
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${what} is not a pose`);
  for (const [layer, may] of Object.entries(LAYERS)) {
    const v = p[layer];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${what}: ${layer} says move, turn or scale`);
    for (const k of ['move', 'turn', 'scale']) {
      if (v[k] === undefined) continue;
      if (!may.includes(k)) fail(`${what}: ${layer} has no ${k}`);
      if (k === 'turn' ? !num(v[k]) : !pair(v[k])) fail(`${what}: ${layer}'s ${k} must be ${k === 'turn' ? 'a number' : '[x, y]'}`);
    }
  }
}

function check(d) {
  if (!d || typeof d !== 'object') fail('not an object');
  if (d.version !== VERSION) fail(`version ${d.version} is not one this page knows`);
  if (!pair(d.box) || !(d.box[0] > 0 && d.box[1] > 0)) fail('box must be [width, height]');
  if (!d.head || ![d.head.cx, d.head.cy, d.head.r].every(num) || !(d.head.r > 0)) fail('head must be { cx, cy, r }');
  if (!HEX.test(d.tones?.white) || !HEX.test(d.tones?.ink)) fail('tones must give white and ink as #rrggbb');
  if (!pair(d.pivot?.head) || !pair(d.pivot?.eyes)) fail('pivot must give head and eyes as [x, y]');
  if (d.attach?.hat !== undefined && !(pair(d.attach.hat?.at) && num(d.attach.hat.scale) && d.attach.hat.scale > 0)) fail('attach.hat must be { at, scale }');
  if (!d.states || typeof d.states !== 'object' || !Object.hasOwn(d.states, d.default)) fail('default must name one of the states');
  for (const [name, s] of Object.entries(d.states)) {
    if (!NAME.test(name)) fail(`"${name}" can't be a state's name`);
    if (!s || !Array.isArray(s.eyes) || !Array.isArray(s.pupils)) fail(`${name} has no face`);
    try { shapesSvg(s.eyes, FACE_TONES); shapesSvg(s.pupils, FACE_TONES); } catch (e) { fail(`${name}: its face has a shape this page can't draw (${e.message})`); }
    checkPose(s.pose, name);
    if (s.opacity !== undefined && !(num(s.opacity) && s.opacity >= 0 && s.opacity <= 1)) fail(`${name}: opacity is 0 to 1`);
    if (!s.move) continue;
    const { seconds, easing, keys } = s.move;
    if (!(num(seconds) && seconds > 0)) fail(`${name}: seconds must be more than 0`);
    if (!Object.hasOwn(EASINGS, easing)) fail(`${name}: the easing is linear or ease-in-out`);
    if (!Array.isArray(keys) || keys.length < 2) fail(`${name}: a movement has two keys or more`);
    keys.forEach((k, i) => {
      checkPose(k, `${name}, key ${i}`);
      if (!num(k.at) || (i ? k.at <= keys[i - 1].at : k.at !== 0)) fail(`${name}: keys start at 0 and go up`);
    });
    if (keys.at(-1).at !== 1) fail(`${name}: the last key is at 1`);
    const same = (k) => JSON.stringify(Object.keys(LAYERS).map((layer) => Object.entries(k[layer] || {}).sort()));
    if (same(keys[0]) !== same(keys.at(-1))) fail(`${name}: the last key must equal the first, or the loop jumps`);
  }
  if (d.tile !== undefined) checkTile(d);
  if (d.small !== undefined) {
    const v = d.small?.view;
    if (!Array.isArray(v) || v.length !== 4 || !v.every(num) || !(v[2] > 0 && v[3] > 0)) fail('small: view must be [x, y, width, height]');
  }
  return d;
}

// The tile (ADR 169): checked whole, so a page never draws half of one. An icon the page can't draw is
// left out when it is drawn, as a hat is.
function checkTile(d) {
  const t = d.tile;
  const r = t?.rect;
  if (!r || ![r.x, r.y, r.w, r.h, r.r].every(num) || !(r.w > 0 && r.h > 0 && r.r >= 0)) fail('tile: rect must be { x, y, w, h, r }');
  if (!HEX.test(t.mute?.toward) || !(num(t.mute.by) && t.mute.by >= 0 && t.mute.by <= 1)) fail('tile: mute must be { toward, by }');
  if (!pair(t.icon?.at) || !(num(t.icon.scale) && t.icon.scale > 0)) fail('tile: icon must be { at, scale }');
  if (!HEX.test(t.ink)) fail('tile: ink must be #rrggbb');
  if (!t.ring || ![t.ring.r, t.ring.width, t.ring.arc, t.ring.seconds].every(num) || !(t.ring.r > 0 && t.ring.seconds > 0 && t.ring.arc > 0 && t.ring.arc <= 1)) fail('tile: ring must be { r, width, arc, seconds }');
  if (!t.dot || ![t.dot.cx, t.dot.cy, t.dot.r, t.dot.gap].every(num) || !(t.dot.r > 0)) fail('tile: dot must be { cx, cy, r, gap }');
  for (const [name, v] of Object.entries(t.states || {})) {
    if (!v || typeof v !== 'object' || Object.keys(v).some((k) => !['ring', 'dot'].includes(k) || !HEX.test(v[k]))) fail(`tile: the state ${name} is { ring } or { dot }, a #rrggbb`);
  }
  const v = t.small?.view;
  if (t.small !== undefined && (!Array.isArray(v) || v.length !== 4 || !v.every(num) || !(v[2] > 0 && v[3] > 0))) fail('tile: small.view must be [x, y, width, height]');
  if (t.motion !== undefined) checkMotion(t.motion, d.states);
}

// How a tile moves when its bot's state changes (ADR 169): times in seconds, fractions of the run that ended well.
function checkMotion(m, states) {
  const secs = (x) => num(x) && x > 0 && x <= 5;
  const part = (x) => Array.isArray(x) && x.length === 2 && x.every(num) && x[0] >= 0 && x[0] <= x[1] && x[1] <= 1;
  const curve = (x) => Array.isArray(x) && x.length === 4 && x.every(num) && x[0] >= 0 && x[0] <= 1 && x[2] >= 0 && x[2] <= 1;
  if (!m || !['out', 'in', 'settle'].every((k) => curve(m.easing?.[k]))) fail('tile: motion.easing must be { out, in, settle }, each [x1, y1, x2, y2]');
  if (![m.ring?.in, m.ring?.out, m.dot?.in, m.dot?.out, m.fade, m.still].every(secs)) fail('tile: motion must give ring { in, out }, dot { in, out }, fade and still in seconds');
  const p = m.pulse;
  if (!p || !Array.isArray(p.states) || !p.states.every((x) => typeof x === 'string') || !(num(p.after) && p.after >= 0) || !secs(p.seconds) || !(num(p.grow) && p.grow > 1) || !(num(p.width) && p.width > 0)) fail('tile: motion.pulse must be { states, after, seconds, grow, width }');
  const d = m.done;
  if (!d || ![d.from, d.to].every((x) => Object.hasOwn(states, x)) || !secs(d.seconds) || !part(d.icon) || !part(d.draw) || !part(d.hold) || !(num(d.width) && d.width > 0)) fail('tile: motion.done must be { from, to (two states), seconds, icon, draw, hold, width, check }');
  if (!Array.isArray(d.check) || d.check.length < 2 || d.check[0]?.[0] !== 'M' || !d.check.every((c) => Array.isArray(c) && ['M', 'L'].includes(c[0]) && c.length === 3 && num(c[1]) && num(c[2]))) fail('tile: motion.done.check is a path of M and L');
  if (!(num(m.press) && m.press > 0.5 && m.press <= 1)) fail('tile: motion.press is how large a pressed tile is drawn, 0.5 to 1');
}

// Every layer's place in a state: its pose, or one key of its movement over it.
function poseOf(s, key) {
  const out = {};
  for (const layer of Object.keys(LAYERS)) out[layer] = { ...s.pose?.[layer], ...key?.[layer] };
  return out;
}
// A layer's transform: moved, then turned and scaled about its pivot. As an SVG attribute (no units), or
// as CSS (px and deg). The same four steps every time, so that a movement is the numbers changing.
function layerAt(d, layer, p, css = false) {
  const v = p[layer] || {};
  const [mx, my] = v.move || [0, 0];
  const [px, py] = d.pivot?.[layer] || [0, 0];
  const [sx, sy] = v.scale || [1, 1];
  const [u, deg, sep] = css ? ['px', 'deg', ', '] : ['', '', ' '];
  return `translate(${n(mx + px)}${u}${sep}${n(my + py)}${u}) rotate(${n(v.turn || 0)}${deg}) scale(${n(sx)}${sep}${n(sy)}) translate(${n(-px)}${u}${sep}${n(-py)}${u})`;
}

// Keyframes for the layers that move in each state, and nothing for what stays still.
function movesCss() {
  const out = [];
  const t = def.tile;
  if (t) { // the ring turns about the middle of the box; still under reduced motion, as every .fig g
    out.push('@keyframes fig-tile-turn { to { transform: rotate(360deg); } }');
    out.push(`.fig .t-ring { transform-origin: ${n(def.box[0] / 2)}px ${n(def.box[1] / 2)}px; animation: fig-tile-turn ${n(t.ring.seconds)}s linear var(--ph, 0s) infinite; }`);
    if (t.motion) out.push(...motionCss(t.motion));
  }
  for (const [name, s] of Object.entries(def.states)) {
    if (!s.move) continue;
    const timing = `${n(s.move.seconds)}s ${EASINGS[s.move.easing]} var(--ph, 0s) infinite`;
    for (const layer of Object.keys(LAYERS)) {
      const frames = s.move.keys.map((k) => layerAt(def, layer, poseOf(s, k), true));
      if (frames.every((f) => f === frames[0])) continue;
      out.push(`@keyframes fig-${name}-${layer} { ${s.move.keys.map((k, i) => `${n(k.at * 100)}% { transform: ${frames[i]}; }`).join(' ')} }`);
      out.push(`.fig-${name} .l-${layer} { animation: fig-${name}-${layer} ${timing}; }`);
    }
  }
  return out.join('\n');
}

// A tile's moves when its state changes: each starts --ago before now (zero or less), so a tile drawn again in
// the middle of one carries on where it was. Under reduced motion what appears or goes only fades.
function motionCss(m) {
  const cb = (k) => `cubic-bezier(${m.easing[k].map(n).join(', ')})`;
  const at = 'var(--ago, 0s)';
  const pc = (x) => `${n(x * 100)}%`;
  const d = m.done;
  const still = `${n(m.still)}s`;
  const lit = Math.min(d.draw[0] + m.still / d.seconds, d.hold[0]);
  return [
    '.fig-tile .m-dot, .fig-tile .m-pulse { transform-box: fill-box; transform-origin: center; }',
    '.fig-tile .m-pulse, .fig-tile .t-check { fill: none; stroke-linecap: round; stroke-linejoin: round; }',
    '@keyframes fig-m-in { from { opacity: 0; } }',
    '@keyframes fig-m-out { to { opacity: 0; } }',
    '@keyframes fig-m-grow { from { transform: scale(0); } }',
    '@keyframes fig-m-shrink { to { transform: scale(0); } }',
    '@keyframes fig-m-fade { from { opacity: var(--was, 1); } }',
    `@keyframes fig-m-pulse { from { opacity: 0.8; transform: scale(1); } to { opacity: 0; transform: scale(${n(m.pulse.grow)}); } }`,
    `@keyframes fig-m-icon { 0% { opacity: 1; } ${pc(d.icon[0])} { opacity: 0; } ${pc(d.icon[1])} { opacity: 0; } 100% { opacity: 1; } }`,
    `@keyframes fig-m-check { 0% { opacity: 0; stroke-dashoffset: 1; } ${pc(d.draw[0])} { opacity: 1; stroke-dashoffset: 1; animation-timing-function: ${cb('out')}; } ${pc(d.draw[1])} { opacity: 1; stroke-dashoffset: 0; } ${pc(d.hold[0])} { opacity: 1; stroke-dashoffset: 0; } ${pc(d.hold[1])}, 100% { opacity: 0; stroke-dashoffset: 0; } }`,
    `@keyframes fig-m-check-still { 0%, ${pc(d.draw[0])} { opacity: 0; } ${pc(lit)}, ${pc(d.hold[0])} { opacity: 1; } ${pc(d.hold[1])}, 100% { opacity: 0; } }`,
    `.fig-tile .m-ring.in { animation: fig-m-in ${n(m.ring.in)}s ${cb('out')} ${at} both; }`,
    `.fig-tile .m-ring.out { animation: fig-m-out ${n(m.ring.out)}s ${cb('in')} ${at} both; }`,
    `.fig-tile .m-dot.in { animation: fig-m-grow ${n(m.dot.in)}s ${cb('settle')} ${at} both; }`,
    `.fig-tile .m-dot.out { animation: fig-m-shrink ${n(m.dot.out)}s ${cb('in')} ${at} both; }`,
    `.fig-tile .m-pulse { animation: fig-m-pulse ${n(m.pulse.seconds)}s ${cb('out')} calc(${at} + ${n(m.pulse.after)}s) both; }`,
    `.fig-tile.m-done .t-icon { animation: fig-m-icon ${n(d.seconds)}s linear ${at} both; }`,
    `.fig-tile .t-check { stroke-dasharray: 1; animation: fig-m-check ${n(d.seconds)}s linear ${at} both; }`,
    `.fig-tile.m-fade { animation: fig-m-fade ${n(m.fade)}s ${cb('out')} ${at} both; }`,
    // Pressed: a tile in something that is pressed is drawn a little smaller, and comes back.
    `.fig-tile { transition: transform ${still} ${cb('out')}; }`,
    `:is(a, button, [role="button"], .contact):active .fig-tile { transform: scale(${n(m.press)}); }`,
    '@media (prefers-reduced-motion: reduce) {',
    `  .fig-tile .m-ring.in, .fig-tile .m-dot.in { animation: fig-m-in ${still} ${cb('out')} ${at} both !important; transform: none; }`,
    `  .fig-tile .m-ring.out, .fig-tile .m-dot.out { animation: fig-m-out ${still} ${cb('in')} ${at} both !important; }`,
    `  .fig-tile.m-done .t-icon { animation: fig-m-icon ${n(d.seconds)}s linear ${at} both !important; }`,
    '  .fig-tile .t-check { stroke-dasharray: none; animation-name: fig-m-check-still; }',
    '  .fig-tile .m-pulse { display: none; }',
    '  .fig-tile { transition: none; }',
    '  :is(a, button, [role="button"], .contact):active .fig-tile { transform: none; }',
    '}',
  ];
}

function use(d) {
  def = check(d);
  moves = movesCss();
  const doc = root.document;
  if (doc) {
    let el = doc.getElementById('figure-moves');
    if (!el) { el = doc.createElement('style'); el.id = 'figure-moves'; doc.head.appendChild(el); }
    el.textContent = moves;
    redraw(doc);
  }
}

// The bare heads drawn before the definition was here (its first load went wrong), drawn again from it:
// each in the state, colour and outfit it was asked in. Nothing else on the page is touched.
function redraw(doc) {
  for (const el of doc.querySelectorAll('svg.fig[data-asked]')) {
    let what;
    try { what = JSON.parse(el.dataset.asked); } catch { continue; }
    if (!what || typeof what !== 'object') continue;
    const color = el.style.getPropertyValue('--c');
    el.outerHTML = what.small ? small(color, what.outfit, el.dataset.bot) : svg(what.state, color, what.outfit);
  }
}

// The hat of an outfit, when this page can draw it: placed on the head, as large as the definition says.
function hatOf(outfit) {
  const wanted = (outfit === CHIEF ? def.chief?.outfit : outfit)?.hat;
  const k = def.kit?.hat;
  const a = def.attach?.hat;
  if (!wanted || !k || !a || !pair(k.origin)) return '';
  const piece = typeof wanted === 'string' ? (Object.hasOwn(k.pieces || {}, wanted) ? k.pieces[wanted] : null) : wanted;
  if (!Array.isArray(piece?.shapes)) return '';
  try {
    return `<g class="hat" transform="translate(${n(a.at[0])} ${n(a.at[1])}) scale(${n(a.scale)}) translate(${n(-k.origin[0])} ${n(-k.origin[1])})">${shapesSvg(piece.shapes, HAT_TONES)}</g>`;
  } catch { return ''; /* drawn without its hat */ }
}

const headSvg = (d) => `<circle class="f-main s-none" cx="${n(d.head.cx)}" cy="${n(d.head.cy)}" r="${n(d.head.r)}"/>`;
// The colours are in the style: the bot's, and the definition's white and ink.
const tonesOf = (d, color) => `--c:${paint(color)};--w:${d.tones.white};--k:${d.tones.ink}`;

// A colour mixed part of the way towards another, both #rrggbb; anything else is left as it is.
function mixed(color, toward, by) {
  const c = paint(color);
  if (!HEX.test(c)) return c;
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(c, i) + (ch(toward, i) - ch(c, i)) * by).toString(16).padStart(2, '0')).join('');
}
// The icon of an outfit on the tile: the one it names, or the one its hat stands for, or the default; one
// the page can't draw is left out and the tile is drawn without it. Every shape is in the tile's ink.
function iconOf(outfit) {
  const t = def.tile;
  const o = outfit === CHIEF ? def.chief?.outfit : outfit;
  const pieces = def.kit?.icon?.pieces || {};
  const origin = def.kit?.icon?.origin || [0, 0];
  const name = [o?.icon, typeof o?.hat === 'string' ? t.byHat?.[o.hat] : null, t.default].find((v) => typeof v === 'string' && Object.hasOwn(pieces, v));
  if (!name || !Array.isArray(pieces[name]?.shapes) || !pair(origin)) return '';
  try {
    return `<g class="t-icon" style="--c:${t.ink};--deep:${t.ink}" transform="translate(${n(t.icon.at[0])} ${n(t.icon.at[1])}) scale(${n(t.icon.scale)}) translate(${n(-origin[0])} ${n(-origin[1])})">${shapesSvg(pieces[name].shapes, HAT_TONES)}</g>`;
  } catch { return ''; }
}
const tileRect = (t, color) => `<rect class="t-tile" x="${n(t.rect.x)}" y="${n(t.rect.y)}" width="${n(t.rect.w)}" height="${n(t.rect.h)}" rx="${n(t.rect.r)}" fill="${mixed(color, t.mute.toward, t.mute.by)}"/>`;
// What the state adds to the tile: a turning ring, or a dot cut out of what is behind it.
function signalOf(name) {
  const t = def.tile;
  const sig = t.states?.[name];
  const [cx, cy] = [def.box[0] / 2, def.box[1] / 2];
  if (sig?.ring) return `<g class="t-ring"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(t.ring.r)}" pathLength="1" stroke-dasharray="${n(t.ring.arc)} ${n(1 - t.ring.arc)}" stroke="${sig.ring}" stroke-width="${n(t.ring.width)}"/></g>`;
  if (sig?.dot) return `<circle class="t-cut" cx="${n(t.dot.cx)}" cy="${n(t.dot.cy)}" r="${n(t.dot.r + t.dot.gap)}"/><circle class="t-dot" cx="${n(t.dot.cx)}" cy="${n(t.dot.cy)}" r="${n(t.dot.r)}" fill="${sig.dot}"/>`;
  return '';
}

// The state each bot was last seen in, and the one before it with when it changed (performance.now(), ms).
// A tile only moves for a change the page saw happen: the first state it sees of a bot is just drawn.
const changes = new Map();
const clock = () => root.performance?.now() || 0;
function saw(bot, state) {
  if (!bot || !def?.states) return;
  const name = Object.hasOwn(def.states, state) ? state : def.default;
  const c = changes.get(bot);
  if (!c) changes.set(bot, { state: name, from: null, at: 0 });
  else if (c.state !== name) changes.set(bot, { state: name, from: c.state, at: clock() });
}
// The change a bot's tile is still moving for, drawn in the state it was seen in: { from, ago } (ms), or null.
function moving(bot, name) {
  const m = def.tile.motion;
  const c = bot ? changes.get(bot) : null;
  if (!m || !c || c.from === null || c.state !== name) return null;
  const ago = clock() - c.at;
  const longest = 1000 * Math.max(m.ring.in, m.ring.out, m.dot.in, m.dot.out, m.pulse.after + m.pulse.seconds, m.done.seconds, m.fade);
  return ago < longest ? { from: c.from, ago } : null;
}
// The tile's state with what moves for the change: the old ring or dot going, the new one coming, the pulse,
// the check of a run that ended well. Returns [the svg's classes, its style, what goes under, what goes over],
// or null when it has all moved.
function motionOf(mv, name) {
  const t = def.tile, m = t.motion, S = t.states || {};
  const a = mv.ago / 1000;
  const now = S[name] || {}, was = S[mv.from] || {};
  const cls = [];
  let style = `;--ago:${-Math.round(mv.ago)}ms`;
  let under = '', over = '', signal = signalOf(name);
  if (now.ring && !was.ring && a < m.ring.in) signal = `<g class="m-ring in">${signal}</g>`;
  if (now.dot && !was.dot && a < m.dot.in) signal = `<g class="m-dot in">${signal}</g>`;
  if (was.ring && !now.ring && a < m.ring.out) over += `<g class="m-ring out">${signalOf(mv.from)}</g>`;
  if (was.dot && !now.dot && a < m.dot.out) over += `<g class="m-dot out">${signalOf(mv.from)}</g>`;
  if (now.dot && m.pulse.states.includes(name) && a < m.pulse.after + m.pulse.seconds) over += `<circle class="m-pulse" cx="${n(t.dot.cx)}" cy="${n(t.dot.cy)}" r="${n(t.dot.r)}" stroke="${now.dot}" stroke-width="${n(m.pulse.width)}"/>`;
  if (mv.from === m.done.from && name === m.done.to && a < m.done.seconds) {
    cls.push('m-done');
    under = `<path class="t-check" d="${m.done.check.map((c) => `${c[0]} ${n(c[1])} ${n(c[2])}`).join(' ')}" stroke="${t.ink}" stroke-width="${n(m.done.width)}" pathLength="1"/>`;
  }
  const o = def.states[name].opacity ?? 1, oWas = def.states[mv.from]?.opacity ?? 1;
  if (o !== oWas && a < m.fade) { cls.push('m-fade'); style += `;--was:${n(oWas)}`; }
  if (!cls.length && !under && !over && signal === signalOf(name)) return null; // it has all moved
  return [cls.map((c) => ` ${c}`).join(''), style, under, signal + over];
}

// bot: its id, when the tile shows the bot's state now (not a run's from before): the tile then moves when that
// state changes (saw).
function svg(state, color, outfit, bot) {
  if (def?.tile) {
    const name = Object.hasOwn(def.states, state) ? state : def.default;
    const s = def.states[name];
    const ph = -((root.performance?.now() || 0) / 1000).toFixed(2);
    const mv = moving(bot, name);
    const [cls, style, under, signal] = (mv && motionOf(mv, name)) || ['', '', '', signalOf(name)];
    return `<svg class="fig fig-${name} fig-tile${cls}" viewBox="0 0 ${n(def.box[0])} ${n(def.box[1])}"${(s.opacity ?? 1) < 1 ? ` opacity="${n(s.opacity)}"` : ''} style="--ph:${ph}s${style}" aria-hidden="true">${tileRect(def.tile, color)}${iconOf(outfit)}${under}${signal}</svg>`;
  }
  // Start the movement where the clock says it is, not from its beginning.
  const ph = -((root.performance?.now() || 0) / 1000).toFixed(2);
  const d = def || BARE;
  const name = def ? (Object.hasOwn(def.states, state) ? state : def.default) : 'plain';
  const s = def ? def.states[name] : BARE;
  const p = poseOf(s);
  const open = `<svg class="fig fig-${name}" viewBox="0 0 ${n(d.box[0])} ${n(d.box[1])}"${(s.opacity ?? 1) < 1 ? ` opacity="${n(s.opacity)}"` : ''} style="${tonesOf(d, color)};--ph:${ph}s" aria-hidden="true"${def ? '' : asked({ state, outfit: outfit || undefined })}>`;
  const face = `<g class="l-eyes" transform="${layerAt(d, 'eyes', p)}">${shapesSvg(s.eyes, FACE_TONES)}<g class="l-pupils" transform="${layerAt(d, 'pupils', p)}">${shapesSvg(s.pupils, FACE_TONES)}</g></g>`;
  // The hat is drawn last, over the head and the face.
  return `${open}<g class="l-head" transform="${layerAt(d, 'head', p)}">${headSvg(d)}${face}${def ? hatOf(outfit) : ''}</g></svg>`;
}

// The mark beside a bot's name in text, and for each thing that waits in "Needs you": the head and its
// hat, without eyes. It never moves. Only the part small.view of the box is shown.
function small(color, outfit, bot) {
  if (def?.tile) {
    const view = def.tile.small?.view || [0, 0, ...def.box];
    return `<svg class="fig fig-small fig-tile" viewBox="${view.map(n).join(' ')}" style="aspect-ratio:${n(view[2])}/${n(view[3])}" aria-hidden="true"${bot ? ` data-bot="${attr(bot)}"` : ''}>${tileRect(def.tile, color)}${iconOf(outfit)}</svg>`;
  }
  const d = def || BARE;
  const view = d.small?.view || [0, 0, ...d.box]; // a definition that doesn't say: the whole box
  // The mark's own shape is in the style, so the page only says how tall it is.
  const open = `<svg class="fig fig-small" viewBox="${view.map(n).join(' ')}" style="${tonesOf(d, color)};aspect-ratio:${n(view[2])}/${n(view[3])}" aria-hidden="true"${bot ? ` data-bot="${attr(bot)}"` : ''}${def ? '' : asked({ small: true, outfit: outfit || undefined })}>`;
  return `${open}${headSvg(d)}${def ? hatOf(outfit) : ''}</svg>`;
}

root.Figure = { use, svg, small, saw, css: () => moves, chief: () => def?.chief?.outfit || null, CHIEF, VERSION };

})(typeof window !== 'undefined' ? window : globalThis);
