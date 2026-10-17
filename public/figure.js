// A bot's mark, drawn as SVG from the one definition the botdot server hands out (GET /api/figure,
// lib/figure.json; docs/adr/003-one-figure-definition-for-all-apps.md): a head in the bot's colour, the
// face of its state and its hat. This file is only a renderer: the head, the faces, their movements and
// the hats all come from the definition.
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
  if (d.small !== undefined) {
    const v = d.small?.view;
    if (!Array.isArray(v) || v.length !== 4 || !v.every(num) || !(v[2] > 0 && v[3] > 0)) fail('small: view must be [x, y, width, height]');
  }
  return d;
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

function svg(state, color, outfit) {
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
  const d = def || BARE;
  const view = d.small?.view || [0, 0, ...d.box]; // a definition that doesn't say: the whole box
  // The mark's own shape is in the style, so the page only says how tall it is.
  const open = `<svg class="fig fig-small" viewBox="${view.map(n).join(' ')}" style="${tonesOf(d, color)};aspect-ratio:${n(view[2])}/${n(view[3])}" aria-hidden="true"${bot ? ` data-bot="${attr(bot)}"` : ''}${def ? '' : asked({ small: true, outfit: outfit || undefined })}>`;
  return `${open}${headSvg(d)}${def ? hatOf(outfit) : ''}</svg>`;
}

root.Figure = { use, svg, small, css: () => moves, chief: () => def?.chief?.outfit || null, CHIEF, VERSION };

})(typeof window !== 'undefined' ? window : globalThis);
