// The one definition every app draws bots from (lib/figure.json, ADR 003): the tile (ADR 169) and the head
// apps from before the tile draw, the web page's renderer (public/figure.js, loaded the way the browser
// loads it) and the route that hands the definition out.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer } = require('./helpers');
const { webSource } = require('./web-source');

const FILE = path.join(__dirname, '..', 'lib', 'figure.json');
const def = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const STATES = ['idle', 'working', 'waiting', 'needs_you', 'failed', 'paused']; // botStates() in server.js
const LAYERS = { head: ['move', 'turn'], eyes: ['move', 'scale'], pupils: ['move'] }; // ADR 003: what a pose may say of each layer
const copy = (x) => JSON.parse(JSON.stringify(x));
// The definition with a ring for working, as a definition may give one (ADR 169); lib/figure.json gives none.
const ringed = () => { const d = copy(def); d.tile.states = { working: { ring: '#5fb98f' }, ...d.tile.states }; return d; };
const headDef = (({ tile, ...d }) => d)(def); // the definition as apps from before the tile read it: the head

// A fresh page with the renderer in it.
function page() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'figure.js'), 'utf8'), ctx);
  return ctx.Figure;
}
const body = (svg) => svg.replace(/^<svg[^>]*>/, '');

test('definition: a head, its tones, its pivots and where the hat sits; no body, limbs or held objects', () => {
  assert.equal(def.version, 2);
  assert.deepEqual(def.box, [24, 24]);
  const { cx, cy, r } = def.head;
  // The head fills the avatar: more than half its width, and it stays inside the box.
  assert.ok(2 * r / def.box[0] >= 0.6, 'the head is at least 60% of the avatar\'s width');
  assert.ok(cx - r >= 0 && cx + r <= def.box[0] && cy - r >= 0 && cy + r <= def.box[1]);
  assert.match(def.tones.white, /^#[0-9a-f]{6}$/);
  assert.match(def.tones.ink, /^#[0-9a-f]{6}$/);
  assert.deepEqual(def.pivot.head, [cx, cy], 'the head turns about its middle');
  assert.ok(Math.hypot(def.pivot.eyes[0] - cx, def.pivot.eyes[1] - cy) < r / 2, 'the eyes close about a point in the face');
  // The hat's origin lands on the top of the head, and its box, drawn larger, is at most a unit past the avatar.
  assert.deepEqual(def.attach.hat.at, [cx, cy - r]);
  const { box, origin } = def.kit.hat;
  const s = def.attach.hat.scale;
  const [left, top, right, bottom] = [cx - origin[0] * s, cy - r - origin[1] * s, cx + (box[0] - origin[0]) * s, cy - r + (box[1] - origin[1]) * s];
  assert.ok(left >= -1 && right <= def.box[0] + 1 && top >= -1, `the hat's box on the avatar: ${[left, top, right, bottom]}`);
  assert.ok((right - left) / def.box[0] >= 0.9, 'a hat may be as wide as the avatar');
  assert.ok(bottom < def.pivot.eyes[1], 'a hat ends above the middle of the eyes');
  for (const gone of ['bones', 'hip', 'stroke']) assert.equal(def[gone], undefined, `no ${gone}`);
  assert.deepEqual(Object.keys(def.attach), ['hat']);
  assert.deepEqual(Object.keys(def.kit), ['limits', 'hat', 'icon']);
  assert.deepEqual(Object.keys(def.kit.hat), ['box', 'origin', 'pieces'], 'the hat is placed by attach.hat, and by nothing in the kit');
  assert.deepEqual(def.chief, { outfit: { hat: 'top-hat', icon: 'compass' } });
  assert.ok(!JSON.stringify(def).includes('"holds"') && !JSON.stringify(def).includes('"held"'));
});

// Every point of a face's shape, with half its stroke around it.
function reach(s) {
  const pad = s.stroke ? s.width / 2 : 0;
  if (s.shape === 'circle') return [[s.cx - s.r - pad, s.cy - s.r - pad], [s.cx + s.r + pad, s.cy + s.r + pad]];
  if (s.shape === 'line') return [[Math.min(s.x1, s.x2) - pad, Math.min(s.y1, s.y2) - pad], [Math.max(s.x1, s.x2) + pad, Math.max(s.y1, s.y2) + pad]];
  if (s.shape === 'rect') return [[s.x - pad, s.y - pad], [s.x + s.w + pad, s.y + s.h + pad]];
  const pts = s.d.flatMap((c) => { const out = []; for (let i = 1; i < c.length; i += 2) out.push([c[i], c[i + 1]]); return out; });
  return [[Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad], [Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad]];
}

test('definition: each of the six states has a face of its own, on the head, and a still pose', () => {
  assert.deepEqual(Object.keys(def.states).sort(), [...STATES].sort(), 'the six states the server sends');
  assert.equal(def.default, 'idle');
  const { cx, cy, r } = def.head;
  for (const name of STATES) {
    const s = def.states[name];
    assert.ok(Array.isArray(s.eyes) && s.eyes.length >= 2, `${name} has two eyes`);
    assert.ok(Array.isArray(s.pupils), `${name} says what looks around, also when nothing does`);
    for (const shape of [...s.eyes, ...s.pupils]) {
      assert.ok(['white', 'ink'].includes(shape.fill || shape.stroke), `${name}: an eye is white and ink`);
      if (shape.shape === 'circle') assert.ok(Math.hypot(shape.cx - cx, shape.cy - cy) + shape.r <= r, `${name}: its eye is on the head`);
      else for (const [x, y] of reach(shape)) assert.ok(Math.hypot(x - cx, y - cy) <= r + 0.5, `${name}: its face is on the head (${x}, ${y})`);
    }
    for (const p of [s.pose, ...(s.move?.keys || [])]) {
      for (const [layer, v] of Object.entries(p).filter(([k]) => k !== 'at')) {
        assert.ok(LAYERS[layer], `${name}: ${layer} is a layer`);
        for (const k of Object.keys(v)) assert.ok(LAYERS[layer].includes(k), `${name}: ${layer} may ${k}`);
      }
    }
  }
  // Told apart standing still: the still faces differ in what is drawn, not only in where a pupil is.
  const drawn = (name) => JSON.stringify([def.states[name].eyes, def.states[name].pupils.length, def.states[name].pose.head || null, def.states[name].pose.eyes || null, def.states[name].opacity || 1]);
  assert.equal(new Set(STATES.map(drawn)).size, STATES.length);
  const eyes = (name) => JSON.stringify(def.states[name].eyes);
  assert.notEqual(eyes('working'), eyes('needs_you'), 'working and needs you differ in the shape of the eyes');
  assert.notEqual(eyes('working'), eyes('idle'));
  const white = (name) => def.states[name].eyes.find((x) => x.shape === 'circle' && x.fill === 'white').r;
  assert.ok(white('needs_you') >= white('idle') * 1.5, 'needs you has wide eyes');
  assert.ok(def.states.waiting.pose.eyes.move[0] > 1 && def.states.waiting.pose.pupils.move[0] > 0, 'waiting looks to one side');
  for (const name of ['failed', 'paused']) assert.ok(def.states[name].eyes.every((x) => x.stroke === 'ink') && !def.states[name].pupils.length, `${name} has no open eyes`);
  assert.ok(def.states.failed.pose.head.turn >= 10, 'failed tilts its head');
  assert.ok(def.states.paused.opacity < 0.5, 'paused is faded');
});

test('definition: a movement loops without a jump; only paused is still', () => {
  const moving = STATES.filter((name) => def.states[name].move);
  assert.deepEqual(moving.sort(), ['failed', 'idle', 'needs_you', 'waiting', 'working']);
  for (const name of moving) {
    const { seconds, easing, keys } = def.states[name].move;
    assert.ok(seconds > 0);
    assert.ok(['linear', 'ease-in-out'].includes(easing));
    assert.equal(keys[0].at, 0);
    assert.equal(keys.at(-1).at, 1);
    keys.slice(1).forEach((k, i) => assert.ok(k.at > keys[i].at, `${name}: the keys go up`));
    assert.deepEqual({ ...keys.at(-1), at: 0 }, keys[0], `${name}: ends where it began`);
    assert.ok(keys.some((k) => Object.keys(k).length > 1), `${name} moves`);
  }
  const moved = (name) => [...new Set(def.states[name].move.keys.flatMap((k) => Object.keys(k).filter((x) => x !== 'at')))].sort();
  assert.deepEqual(moved('idle'), ['eyes'], 'idle blinks');
  assert.deepEqual(moved('working'), ['pupils'], 'working moves its eyes');
  assert.deepEqual(moved('waiting'), ['pupils']);
  assert.deepEqual(moved('needs_you'), ['head'], 'needs you bobs its head');
  assert.deepEqual(moved('failed'), ['head']);
});

test('renderer: each state is drawn differently, in the colour, a head with two eyes', () => {
  const Figure = page();
  Figure.use(copy(headDef));
  const drawn = STATES.map((s) => Figure.svg(s, '#378add'));
  assert.equal(new Set(drawn.map(body)).size, STATES.length, 'the still faces differ');
  for (const [i, svg] of drawn.entries()) {
    assert.match(svg, /^<svg class="fig fig-[a-z_]+" viewBox="0 0 24 24"/);
    assert.ok(svg.includes(`fig-${STATES[i]}"`));
    assert.ok(svg.includes(`style="--c:#378add;--w:${def.tones.white};--k:${def.tones.ink};--ph:`));
    assert.match(svg, /<g class="l-head" transform="[^"]*"><circle class="f-main s-none" cx="12" cy="16\.5" r="7\.5"\/><g class="l-eyes" transform="[^"]*">.*<g class="l-pupils" transform="[^"]*">.*<\/g><\/g><\/g><\/svg>$/);
    assert.ok(!svg.includes('<line x1="0"') && !svg.includes('b-'), 'no body, no limbs');
    assert.ok(!svg.includes('class="hat"'), 'no outfit, no hat');
  }
  const of = (state) => drawn[STATES.indexOf(state)];
  assert.ok(of('paused').includes('opacity="0.4"'), 'paused is faded');
  assert.ok(of('failed').includes('<g class="l-head" transform="translate(12 16.5) rotate(12) scale(1 1) translate(-12 -16.5)">'), 'failed is tilted about the middle of the head');
  assert.ok(of('idle').includes('<g class="l-head" transform="translate(12 16.5) rotate(0) scale(1 1) translate(-12 -16.5)">'));
  assert.ok(of('waiting').includes('<g class="l-pupils" transform="translate(1 -0.5) rotate(0) scale(1 1) translate(0 0)">'), 'waiting looks aside');
});

test('renderer: the small mark is the head with its hat, without eyes, and never moves', () => {
  const Figure = page();
  Figure.use(copy(headDef));
  const bare = Figure.small('#378add');
  assert.equal(bare, `<svg class="fig fig-small" viewBox="0 0 24 24" style="--c:#378add;--w:${def.tones.white};--k:${def.tones.ink};aspect-ratio:24/24" aria-hidden="true"><circle class="f-main s-none" cx="12" cy="16.5" r="7.5"/></svg>`);
  const capped = Figure.small('#378add', { hat: 'cap' });
  const hat = Figure.svg('idle', '#378add', { hat: 'cap' }).match(/<g class="hat".*?<\/g>/)[0];
  assert.equal(body(capped), `<circle class="f-main s-none" cx="12" cy="16.5" r="7.5"/>${hat}</svg>`, 'the same hat in the same place as on the avatar');
  for (const svg of [bare, capped]) {
    assert.ok(!svg.includes('l-eyes') && !svg.includes('f-white') && !svg.includes('f-ink'), 'no eyes');
    // No state's class and no layer, so none of the movements' keyframes apply to it.
    for (const s of STATES) assert.ok(!svg.includes(`fig-${s}`));
    assert.ok(!svg.includes('class="l-'));
  }
  assert.equal(body(Figure.small('#d85a30', Figure.CHIEF)), body(Figure.small('#d85a30', { hat: 'top-hat' })), 'the Chief\'s is its fixed hat');
  assert.equal(Figure.small('#378add', { hat: 'bonnet' }), bare, 'a hat it does not know is left out');
  assert.ok(Figure.small().includes('--c:#888780'), 'no colour is grey');
  assert.equal(Figure.small('#fff;"><img src=x onerror=alert(1)>').split('<').length, bare.split('<').length, 'a colour cannot carry markup');
  // The view is the definition's.
  Figure.use({ ...copy(headDef), small: { view: [2, 1, 20, 23] } });
  assert.match(Figure.small('#378add'), /viewBox="2 1 20 23" style="[^"]*;aspect-ratio:20\/23"/);
  const old = copy(headDef);
  delete old.small;
  Figure.use(old);
  assert.match(Figure.small('#378add'), /viewBox="0 0 24 24"/, 'a definition that does not say: the whole box');
  Figure.use({ ...old, box: [48, 30] });
  assert.match(Figure.small('#378add'), /viewBox="0 0 48 30" style="[^"]*;aspect-ratio:48\/30"/, 'whatever the box is');
  for (const small of [null, {}, { view: [0, 0, 0, 1] }, { view: [0, 0, 1] }, { view: '0 0 1 1' }]) {
    assert.throws(() => Figure.use({ ...copy(headDef), small }), /Figure definition: small/, JSON.stringify(small));
  }
});

test('renderer: a state the page does not know is drawn as idle', () => {
  const Figure = page();
  Figure.use(copy(headDef));
  for (const odd of ['sleeping', '', undefined, 'constructor', '"><script>']) assert.equal(Figure.svg(odd, '#378add'), Figure.svg('idle', '#378add'), String(odd));
});

test('renderer: only the layers that move get keyframes', () => {
  const Figure = page();
  assert.equal(Figure.css(), '');
  Figure.use(copy(headDef));
  const css = Figure.css();
  assert.match(css, /@keyframes fig-working-pupils \{ 0% \{ transform: translate\(-1\.1px, 0px\) rotate\(0deg\) scale\(1, 1\) translate\(0px, 0px\); \} 50% \{ transform: translate\(1\.1px, 0px\) rotate\(0deg\) scale\(1, 1\) translate\(0px, 0px\); \} 100% /);
  assert.match(css, /\.fig-working \.l-pupils \{ animation: fig-working-pupils 1\.4s cubic-bezier\(\.42, 0, \.58, 1\) var\(--ph, 0s\) infinite; \}/);
  assert.match(css, /@keyframes fig-idle-eyes \{ 0% \{ transform: translate\(12px, 17\.1px\) rotate\(0deg\) scale\(1, 1\) translate\(-12px, -17\.1px\); \}.* 94% \{ transform: translate\(12px, 17\.1px\) rotate\(0deg\) scale\(1, 0\.1\) translate\(-12px, -17\.1px\); \}/, 'a blink closes the eyes about their own middle');
  assert.match(css, /@keyframes fig-needs_you-head /);
  assert.match(css, /@keyframes fig-failed-head \{ 0% \{ transform: translate\(12px, 16\.5px\) rotate\(12deg\) /);
  assert.ok(!css.includes('fig-needs_you-pupils') && !css.includes('fig-working-head') && !css.includes('fig-idle-head'), 'what stays still has none');
  assert.ok(!css.includes('fig-paused'), 'paused is still');
  // Every keyframe of a layer is the same four steps, so a browser moves between them number by number.
  for (const frame of css.match(/transform: [^;]*;/g)) assert.match(frame, /^transform: translate\([^)]*\) rotate\([^)]*\) scale\([^)]*\) translate\([^)]*\);$/);
});

test('renderer: a colour cannot carry markup', () => {
  const Figure = page();
  Figure.use(copy(headDef));
  const svg = Figure.svg('idle', '#fff;"><img src=x onerror=alert(1)>');
  assert.ok(svg.includes('style="--c:#fffimg srcx onerroralert(1);--w:'), 'only what a colour is written with stays');
  assert.equal(svg.split('<').length, Figure.svg('idle', '#fff').split('<').length);
  assert.ok(Figure.svg('idle').includes('--c:#888780'), 'no colour is grey');
});

test('renderer: a hat on the head, from the kit or drawn inline; one it cannot draw is left out', () => {
  const Figure = page();
  Figure.use(copy(headDef));
  const bare = Figure.svg('idle', '#378add');
  const capped = Figure.svg('idle', '#378add', { hat: 'cap' });
  assert.ok(capped.includes('<g class="hat" transform="translate(12 9) scale(2.6) translate(-5 -3.5)"><path class="f-deep s-none" d="M2.7 4.4Q2.7 1.4 5 1.4Q7.3 1.4 7.3 4.4Z"/>'), 'the hat\'s origin on the top of the head, drawn larger');
  assert.match(capped, /<\/g><\/g><g class="hat"[^>]*>.*<\/g><\/g><\/svg>$/, 'in the head\'s layer, after the face: it moves and tilts with the head and lies over the eyes');
  assert.equal(Figure.svg('idle', '#378add', { hat: { shapes: def.kit.hat.pieces.cap.shapes } }), capped, 'a drawn hat is drawn like a kit hat');
  for (const odd of [null, {}, { hat: '' }, { hat: 'bonnet' }, { hat: 'constructor' }, { hat: 7 }, { hat: { shapes: 'M0 0' } }, { hat: { shapes: [{ shape: 'spiral' }] } }, { hat: { shapes: [null] } },
    { hat: { shapes: [{ shape: 'rect', x: 1, y: 1, w: '2', h: 2, fill: 'main' }] } }, { hat: { shapes: [{ shape: 'rect', x: 1, y: 1, w: 2, h: 2, fill: 'white' }] } }, { hat: { shapes: [{ shape: 'rect', x: 1, y: 1, w: 2, h: 2, fill: 'main', stroke: 'ink', width: 1 }] } },
    { hat: { shapes: [{ shape: 'rect', x: 1, y: 1, w: 2, h: 2, fill: 'main', stroke: '"><script>', width: 1 }] } }, { hat: { shapes: [def.kit.hat.pieces.cap.shapes[0], { shape: 'circle', cx: 5, cy: 3, r: 1, fill: 'gold' }] } }, { holds: 'envelope' }]) {
    assert.equal(Figure.svg('idle', '#378add', odd), bare, JSON.stringify(odd));
  }
  assert.equal(Figure.svg('idle', '#378add', { hat: 'cap', holds: 'envelope' }), capped, 'what an old bot held is not drawn');
  assert.equal(body(Figure.svg('idle', '#d85a30', Figure.CHIEF)), body(Figure.svg('idle', '#d85a30', { hat: 'top-hat' })));
  // A definition without a kit, or without a place for the hat: bare heads, whatever the outfit.
  for (const gone of ['kit', 'attach', 'chief']) {
    const d = copy(headDef);
    delete d[gone];
    Figure.use(d);
    assert.equal(Figure.svg('idle', '#378add', gone === 'chief' ? Figure.CHIEF : { hat: 'cap' }), bare, gone);
  }
});

// A page with one element per head drawn so far, enough of a document for use() to redraw them.
function pageWithDocument(drawn) {
  const els = [];
  const attr = (svg, name) => (svg.match(new RegExp(` ${name}="([^"]*)"`)) || [])[1];
  const decode = (t) => t.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c));
  const style = { textContent: '' };
  const ctx = vm.createContext({ document: {
    head: { appendChild() {} },
    getElementById: () => style,
    createElement: () => style,
    querySelectorAll: (sel) => { assert.equal(sel, 'svg.fig[data-asked]'); return els.filter((e) => attr(e.outerHTML, 'data-asked') !== undefined); },
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'figure.js'), 'utf8'), ctx);
  for (const make of drawn) {
    const el = { outerHTML: make(ctx.Figure) };
    el.dataset = { get asked() { return decode(attr(el.outerHTML, 'data-asked')); }, get bot() { return attr(el.outerHTML, 'data-bot'); } };
    el.style = { getPropertyValue: (name) => (attr(el.outerHTML, 'style').match(new RegExp(`${name}:([^;]*)`)) || [])[1] };
    els.push(el);
  }
  return { Figure: ctx.Figure, els };
}

test('renderer: heads drawn bare before the definition arrived are drawn again from it', () => {
  const outfit = { hat: { shapes: [{ shape: 'circle', cx: 5, cy: 3, r: 2, fill: 'deep' }] } };
  const { Figure, els } = pageWithDocument([
    (F) => F.svg('working', '#378add', outfit),
    (F) => F.svg('paused', '#e24b4a', null),
    (F) => F.small('#1d9e75', { hat: 'cap' }),
    (F) => F.svg('"><img src=x onerror=alert(1)>', '#7f77dd'),
    (F) => F.svg('idle', '#d85a30', F.CHIEF),
    (F) => F.small('#d85a30', F.CHIEF),
  ]);
  for (const el of els) assert.match(el.outerHTML, / data-asked="[^"<>]*">/, 'a bare head says what it stands for, as text');
  assert.match(els[0].outerHTML, /^<svg class="fig fig-plain" /);
  Figure.use(copy(headDef));
  const fresh = (svg) => svg.replace(/--ph:-?[\d.]+s/, '--ph:0s');
  assert.equal(fresh(els[0].outerHTML), fresh(Figure.svg('working', '#378add', outfit)), 'in its state, colour and hat, a drawn one too');
  assert.ok(els[0].outerHTML.includes('class="fig fig-working"') && els[0].outerHTML.includes('<circle class="f-deep s-none" cx="5" cy="3" r="2"/>'));
  assert.equal(fresh(els[1].outerHTML), fresh(Figure.svg('paused', '#e24b4a')));
  assert.equal(els[2].outerHTML, Figure.small('#1d9e75', { hat: 'cap' }));
  assert.equal(fresh(els[3].outerHTML), fresh(Figure.svg('idle', '#7f77dd')), 'a state it does not know is the default one, and nothing of it is markup');
  assert.equal(fresh(els[4].outerHTML), fresh(Figure.svg('idle', '#d85a30', Figure.chief())), 'the Chief gets the hat the definition gives it, which nobody knew when it was drawn bare');
  assert.equal(els[5].outerHTML, Figure.small('#d85a30', { hat: 'top-hat' }));
  for (const el of els) assert.ok(!el.outerHTML.includes('data-asked'), 'a head drawn from the definition carries nothing');
  // A second definition leaves them alone: only bare heads are redrawn.
  const before = els.map((e) => e.outerHTML);
  Figure.use({ ...copy(headDef), head: { cx: 12, cy: 16, r: 7 } });
  assert.deepEqual(els.map((e) => e.outerHTML), before);
});

test('renderer: without a definition, or with one it cannot use, the one bare head built in', () => {
  const Figure = page();
  const plain = Figure.svg('working', '#378add', { hat: 'cap' });
  assert.match(plain, /^<svg class="fig fig-plain" /);
  const look = (svg) => svg.replace(/ data-asked="[^"]*"/, '');
  assert.equal(look(Figure.svg('failed', '#378add')), look(plain), 'the fallback has no states and no hat');
  assert.ok(plain.includes('<circle class="f-main s-none" cx="12" cy="16.5" r="7.5"/>') && plain.split('<circle').length === 6, 'a head with two eyes');
  // The built-in head is the definition's own idle one, so a bot looks the same once the definition is here.
  const known = page();
  known.use(copy(headDef));
  const shapes = (svg) => body(look(svg)).replace(/ transform="[^"]*"/g, '');
  assert.equal(shapes(Figure.svg('idle', '#378add')), shapes(known.svg('idle', '#378add')));
  assert.match(Figure.small('#378add', { hat: 'cap' }), /^<svg class="fig fig-small" viewBox="0 0 24 24" [^>]*data-asked="[^"]*"><circle class="f-main s-none" cx="12" cy="16.5" r="7.5"\/><\/svg>$/);
  const state = (over) => ({ ...copy(headDef), states: { idle: { ...copy(def.states.idle), ...over } } });
  const bad = [
    null,
    { ...copy(headDef), version: 1 },
    { ...copy(headDef), version: 3 },
    { ...copy(headDef), head: { cx: 12, cy: 16 } },
    { ...copy(headDef), tones: { white: 'url(x)', ink: '#000000' } },
    { ...copy(headDef), pivot: { head: [12, 16] } },
    { ...copy(headDef), attach: { hat: { at: [12, 9], scale: 0 } } },
    { ...copy(headDef), default: 'nobody' },
    { ...copy(headDef), default: 'constructor' },
    state({ eyes: undefined }),
    state({ eyes: [{ shape: 'spiral', fill: 'white' }] }),
    state({ eyes: [{ shape: 'circle', cx: 9, cy: 17, r: 2, fill: 'gold', stroke: 'ink', width: 1 }] }), // a tone it doesn't know, beside one it does
    state({ pupils: [{ shape: 'circle', cx: 1, cy: 1, r: '"><script>', fill: 'ink' }] }),
    state({ pose: { tail: {}, head: { scale: [1, 1] } } }),
    state({ pose: { pupils: { turn: 5 } } }),
    state({ pose: { eyes: { move: [1] } } }),
    state({ move: { seconds: 1, easing: 'bounce', keys: [{ at: 0 }, { at: 1 }] } }),
    state({ move: { seconds: 1, easing: 'linear', keys: [{ at: 0 }, { at: 1, head: { turn: 5 } }] } }),
    state({ move: { seconds: 1, easing: 'linear', keys: [{ at: 0.1 }, { at: 1 }] } }),
  ];
  for (const d of bad) {
    assert.throws(() => Figure.use(d), /Figure definition/, JSON.stringify(d)?.slice(0, 80));
    assert.equal(Figure.svg('working', '#378add', { hat: 'cap' }), plain);
  }
  // A definition with more in it than this page knows (a new key, a new state) is still used.
  Figure.use({ ...copy(headDef), mouth: {}, states: { ...copy(headDef.states), dancing: { ...copy(def.states.idle), pose: { head: { turn: 20 } } } } });
  assert.match(Figure.svg('dancing', '#378add'), /fig-dancing/);
});

// The table the Android and Mac renderers are checked against too (FigureTest.kt, FigureTests.swift), so
// that a definition one app draws from is one every app draws from.
test('renderer: the definitions every app must take alike are taken so here', () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'figure-cases.json'), 'utf8'));
  assert.ok(cases.length >= 15);
  for (const c of cases) {
    const Figure = page();
    const d = { ...copy(headDef), states: { ...copy(headDef.states), extra: c.state } };
    if (!c.accepted) { assert.throws(() => Figure.use(d), /Figure definition/, c.what); continue; }
    assert.doesNotThrow(() => Figure.use(d), c.what);
    assert.match(Figure.svg('extra', '#378add'), /fig-extra/, c.what);
    assert.equal(Figure.css().includes('fig-extra-'), c.moves, c.what);
  }
});

test('renderer: a small mark says whose it is when told, and keeps that when it is drawn again', () => {
  const Figure = page();
  Figure.use(copy(headDef));
  const plain = Figure.small('#378add', { hat: 'cap' });
  assert.ok(!plain.includes('data-bot'));
  assert.equal(Figure.small('#378add', { hat: 'cap' }, 'mail-keeper'), plain.replace(' aria-hidden="true"', ' aria-hidden="true" data-bot="mail-keeper"'));
  assert.equal(Figure.small('#378add', null, '"><img src=x>').split('<').length, Figure.small('#378add').split('<').length, 'an id cannot carry markup');
  // Drawn bare before the definition arrived, then drawn again from it: still its bot's.
  const { Figure: late, els } = pageWithDocument([(F) => F.small('#378add', { hat: 'cap' }, 'mail-keeper')]);
  assert.match(els[0].outerHTML, / data-bot="mail-keeper" data-asked=/);
  late.use(copy(headDef));
  assert.equal(els[0].outerHTML, late.small('#378add', { hat: 'cap' }, 'mail-keeper'));
  assert.ok(els[0].outerHTML.includes('class="hat"') && els[0].outerHTML.includes('data-bot="mail-keeper"'));
});

test('definition: the tile, its icon inside it, a ring around it and a dot on its corner (ADR 169)', () => {
  const t = def.tile;
  const { x, y, w, h } = t.rect;
  assert.ok(x >= 0 && y >= 0 && x + w <= def.box[0] && y + h <= def.box[1], 'the tile is inside the box');
  assert.ok(w / def.box[0] >= 0.8, 'and fills most of it');
  const [ix, iy] = t.icon.at;
  const [iw, ih] = def.kit.icon.box.map((v) => v * t.icon.scale);
  assert.ok(ix > x && iy > y && ix + iw < x + w && iy + ih < y + h, 'the icon sits inside the tile with room around it');
  assert.ok(Math.abs(ix + iw / 2 - (x + w / 2)) < 0.01 && Math.abs(iy + ih / 2 - (y + h / 2)) < 0.01, 'in its middle');
  const corner = Math.hypot(w / 2 - t.rect.r, h / 2 - t.rect.r) + t.rect.r;
  assert.ok(t.ring.r - t.ring.width / 2 > corner, 'the ring clears the corners of the tile');
  for (const name of Object.keys(t.states)) assert.ok(STATES.includes(name), `${name} is a state`);
  assert.deepEqual(Object.keys(t.states).sort(), ['failed', 'needs_you', 'waiting']);
  assert.ok(!Object.values(t.states).some((v) => v.ring), 'no state turns a ring: a working bot says so in words under its name');
  assert.ok(def.states.paused.opacity < 1, 'a paused bot is faded');
  // The ink of the icon reads on every colour a bot can have, muted as the tile mutes it: 3 to 1 at least.
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const mute = (hex) => '#' + [1, 3, 5].map((i) => { const a = parseInt(hex.slice(i, i + 2), 16); const b = parseInt(t.mute.toward.slice(i, i + 2), 16); return Math.round(a + (b - a) * t.mute.by).toString(16).padStart(2, '0'); }).join('');
  const { COLORS } = require('../lib/bots');
  for (const c of [...COLORS, '#d85a30']) {
    const ratio = (lum(t.ink) + 0.05) / (lum(mute(c)) + 0.05);
    assert.ok(ratio >= 3, `white on ${c} (${mute(c)}): ${ratio.toFixed(2)}`);
  }
});

test('renderer: a bot is a tile in its muted colour with its icon; the state is a ring, a dot or a fade', () => {
  const Figure = page();
  Figure.use(copy(def));
  const fill = (svg) => svg.match(/class="t-tile"[^>]*fill="(#[0-9a-f]{6})"/)[1];
  const idle = Figure.svg('idle', '#1d9e75', { hat: 'cap', icon: 'news' });
  assert.match(idle, /^<svg class="fig fig-idle fig-tile" viewBox="0 0 24 24"/);
  assert.equal(fill(idle), '#258666', 'the colour mixed a part of the way towards the definition\'s grey');
  assert.ok(!/l-head|l-eyes|class="hat"/.test(idle), 'no head, no face, no hat');
  const icon = (svg) => body(svg).match(/<g class="t-icon"[^>]*>(.*?)<\/g>/)[1];
  const drawn = (name) => icon(Figure.svg('idle', '#378add', { icon: name }));
  assert.notEqual(drawn('news'), drawn('mail'), 'each icon is drawn from its own shapes');
  assert.equal(icon(Figure.svg('idle', '#378add', { hat: 'chef' })), drawn('food'), 'a bot without an icon shows the one its hat stands for');
  for (const none of [null, undefined, { hat: '' }, { hat: { shapes: [] } }, { icon: 'unicorn' }, { icon: '<b>' }]) assert.equal(icon(Figure.svg('idle', '#378add', none)), drawn('spark'), `the default icon for ${JSON.stringify(none)}`);
  assert.equal(icon(Figure.svg('idle', '#d85a30', Figure.CHIEF)), drawn('compass'), "the Chief's own icon");
  assert.match(idle, /<g class="t-icon" style="--c:#ffffff;--deep:#ffffff" transform="translate\(6 6\) scale\(0\.5\) translate\(0 0\)">/, 'in the tile\'s ink, in its middle');
  assert.ok(!/t-ring|t-dot/.test(idle), 'an idle bot shows nothing more');
  assert.ok(!/t-ring|t-dot/.test(Figure.svg('working', '#1d9e75', { icon: 'news' })), 'a working bot shows nothing more either');
  Figure.use(ringed());
  const working = Figure.svg('working', '#1d9e75', { icon: 'news' });
  assert.match(working, /<g class="t-ring"><circle cx="12" cy="12" r="12\.6" pathLength="1" stroke-dasharray="0\.22 0\.78" stroke="#5fb98f" stroke-width="1\.5"\/><\/g>/);
  for (const [st, c] of [['needs_you', '#e0a23a'], ['failed', '#d9534f'], ['waiting', '#9a9890']]) {
    const svg = Figure.svg(st, '#1d9e75', { icon: 'news' });
    assert.match(svg, new RegExp(`<circle class="t-cut" cx="20.5" cy="20.5" r="4.5"/><circle class="t-dot" cx="20.5" cy="20.5" r="3" fill="${c}"/></svg>$`), st);
  }
  assert.match(Figure.svg('paused', '#1d9e75', { icon: 'news' }), /^<svg class="fig fig-paused fig-tile"[^>]* opacity="0\.\d+"/);
  assert.match(Figure.svg('dancing', '#1d9e75', null), /^<svg class="fig fig-idle fig-tile"/, 'a state it does not know is idle');
  assert.match(Figure.css(), /@keyframes fig-tile-turn \{ to \{ transform: rotate\(360deg\); \} \}/);
  assert.match(Figure.css(), /\.fig \.t-ring \{ transform-origin: 12px 12px; animation: fig-tile-turn 1\.4s linear var\(--ph, 0s\) infinite; \}/);
  Figure.use(copy(def));
  // A colour that is no #rrggbb is not mixed, and carries no markup.
  assert.ok(!Figure.svg('idle', '"><script>x</script>', null).includes('<script'));
  // The small mark: the tile and its icon, no state.
  const small = Figure.small('#1d9e75', { icon: 'news' }, 'b1');
  assert.match(small, /^<svg class="fig fig-small fig-tile" viewBox="-1 -1 26 26" style="aspect-ratio:26\/26" aria-hidden="true" data-bot="b1">/);
  assert.equal(icon(small), drawn('news'));
  assert.ok(!/t-ring|t-dot/.test(small));
});

test('renderer: a tile moves once, for a change of state the page saw, and carries on where it was when drawn again', () => {
  let now = 1000;
  const ctx = vm.createContext({ performance: { now: () => now } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'figure.js'), 'utf8'), ctx);
  const { Figure } = ctx;
  Figure.use(ringed()); // a definition that still turns a ring for working, so the ring's moves stay covered
  const m = def.tile.motion;
  const tile = (st, bot = 'b1') => Figure.svg(st, '#1d9e75', { icon: 'news' }, bot);
  Figure.saw('b1', 'idle');
  assert.equal(tile('idle'), Figure.svg('idle', '#1d9e75', { icon: 'news' }), 'the first state seen is just drawn');
  Figure.saw('b1', 'working');
  now += 50;
  let svg = tile('working');
  assert.match(svg, /style="--ph:-?[\d.]+s;--ago:-50ms"/, 'the move started 50 ms ago');
  assert.match(svg, /<g class="m-ring in"><g class="t-ring">/, 'the ring fades in');
  assert.equal(Figure.svg('working', '#1d9e75', { icon: 'news' }), Figure.svg('working', '#1d9e75', { icon: 'news' }, ''), 'a tile without its bot never moves');
  assert.ok(!tile('working', 'b2').includes('m-ring'), 'nor one of a bot whose change it did not see');
  assert.ok(!tile('idle').includes('--ago'), 'nor one drawn in a state the bot is no longer in (a run from before)');
  now += 1000 * m.ring.in;
  assert.ok(!tile('working').includes('--ago'), 'once it has moved, the tile is drawn still');
  // A run that ended well: the ring goes, the check is drawn over the icon.
  Figure.saw('b1', 'idle');
  now += 300;
  svg = tile('idle');
  assert.match(svg, /^<svg class="fig fig-idle fig-tile m-done"/);
  assert.match(svg, /<path class="t-check" d="M 8\.3 12\.3 L 10\.9 14\.9 L 15\.9 9\.7" stroke="#ffffff" stroke-width="1\.25" pathLength="1"\/>/);
  assert.ok(!svg.includes('m-ring out'), 'the ring has gone by now');
  now = now - 300 + 100;
  assert.match(tile('idle'), /<g class="m-ring out"><g class="t-ring">/, 'and was fading out just after');
  // A dot grows, and the states that need the owner pulse once; waiting does not pulse.
  Figure.saw('b1', 'needs_you');
  now += 100;
  svg = tile('needs_you');
  assert.match(svg, /<g class="m-dot in"><circle class="t-cut"[^>]*\/><circle class="t-dot"[^>]*fill="#e0a23a"\/><\/g>/);
  assert.match(svg, /<circle class="m-pulse" cx="20\.5" cy="20\.5" r="3" stroke="#e0a23a" stroke-width="0\.8"\/>/);
  Figure.saw('b1', 'waiting');
  now += 50;
  svg = tile('waiting');
  assert.ok(!svg.includes('m-dot in') && !svg.includes('m-pulse'), 'a dot that only changes colour neither grows nor pulses');
  // Paused fades from where it was; the dot shrinks away.
  Figure.saw('b1', 'paused');
  now += 60;
  svg = tile('paused');
  assert.match(svg, /^<svg class="fig fig-paused fig-tile m-fade"[^>]*style="[^"]*;--was:1"/);
  assert.match(svg, /<g class="m-dot out"><circle class="t-cut"/);
  // The moves are CSS from the definition, and only fade under reduced motion.
  const css = Figure.css();
  assert.match(css, /\.fig-tile \.m-dot\.in \{ animation: fig-m-grow 0\.26s cubic-bezier\(0\.3, 1\.4, 0\.55, 1\) var\(--ago, 0s\) both; \}/);
  assert.match(css, /\.fig-tile \.m-pulse \{ animation: fig-m-pulse 0\.9s cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) calc\(var\(--ago, 0s\) \+ 0\.14s\) both; \}/);
  assert.match(css, /:is\(a, button, \[role="button"\], \.contact\):active \.fig-tile \{ transform: scale\(0\.94\); \}/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.fig-tile \.m-ring\.in, \.fig-tile \.m-dot\.in \{ animation: fig-m-in 0\.12s/);
  assert.match(reduced, /\.fig-tile \.m-pulse \{ display: none; \}/);
});

test('renderer: a tile it cannot draw is refused whole, and the definition is not used', () => {
  const Figure = page();
  for (const tile of [{}, { ...def.tile, rect: { x: 2, y: 2, w: 0, h: 20, r: 6 } }, { ...def.tile, mute: { toward: 'grey', by: 0.2 } }, { ...def.tile, ink: 'white' }, { ...def.tile, ring: { ...def.tile.ring, seconds: 0 } },
    { ...def.tile, states: { working: { ring: 'url(#x)' } } }, { ...def.tile, states: { working: { glow: '#ffffff' } } }, { ...def.tile, small: { view: [0, 0] } },
    { ...def.tile, motion: { ...def.tile.motion, ring: { in: 0 } } }, { ...def.tile, motion: { ...def.tile.motion, done: { ...def.tile.motion.done, from: 'dancing' } } }, { ...def.tile, motion: { ...def.tile.motion, done: { ...def.tile.motion.done, check: [['C', 1, 2]] } } }, { ...def.tile, motion: { ...def.tile.motion, press: 2 } }]) {
    assert.throws(() => Figure.use({ ...copy(def), tile }), /Figure definition: tile/, JSON.stringify(tile).slice(0, 80));
  }
});

test('the page keeps no face of its own beyond the one bare head', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  const js = read('figure.js');
  assert.equal(js.match(/cx: [\d.]+/g).length, 5, 'the built-in head and its two eyes, and nothing else drawn from numbers in the file');
  for (const name of STATES.filter((s) => s !== 'idle')) assert.ok(!js.includes(name), `nothing about ${name} in the renderer`);
  assert.ok(!/fig-(idle|working|waiting|needs_you|failed|paused)/.test(read('style.css')), 'and no state\'s look in the stylesheet');
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('the server hands the definition out, and says so in features', async () => {
  const r = await srv.api('/figure');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, def);
  assert.ok((await srv.api('/version')).data.features.includes('figure'));
});

test('the web page loads the renderer and has no dot and no stick figure left', async () => {
  const get = async (p) => (await fetch(`${srv.base}${p}`)).text();
  assert.match(await get("/"), /<script src="\/figure\.js(?:\?v=[\w-]+)?"><\/script>\s*<script src="\/app\.js(?:\?v=[\w-]+)?">/);
  assert.match(await get('/figure.js'), /root\.Figure = /);
  assert.ok(!/\.bd\b|bd-av|botDot\(/.test((await get('/style.css')) + webSource()));
  assert.ok(!/name-dot|needs-dots/.test((await get('/style.css')) + webSource() + (await get('/mentions.js'))));
  assert.ok(!/stick figure|\.b-head|b-at-|held object|small figure/.test((await get('/style.css')) + webSource() + (await get('/figure.js'))));
  // Beside a name, a bot's small head wears its hat.
  assert.match(await get('/app.js'), /const botMark = \(b\) => Figure\.small\(colorOf\(b\), outfitOf\(b\), botById\(b\?\.id\)\?\.id\);/);
  // The avatar has no circle behind the head.
  assert.match(await get('/style.css'), /^\.avatar\.head \{ background: none;/m);
});
