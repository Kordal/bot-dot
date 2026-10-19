// The head: the one definition every app draws bots from (lib/figure.json, ADR 003), the web page's
// renderer (public/figure.js, loaded the way the browser loads it) and the route that hands the
// definition out.
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
  assert.deepEqual(Object.keys(def.kit), ['limits', 'hat']);
  assert.deepEqual(Object.keys(def.kit.hat), ['box', 'origin', 'pieces'], 'the hat is placed by attach.hat, and by nothing in the kit');
  assert.deepEqual(def.chief, { outfit: { hat: 'top-hat' } });
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
  Figure.use(copy(def));
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
  Figure.use(copy(def));
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
  Figure.use({ ...copy(def), small: { view: [2, 1, 20, 23] } });
  assert.match(Figure.small('#378add'), /viewBox="2 1 20 23" style="[^"]*;aspect-ratio:20\/23"/);
  const old = copy(def);
  delete old.small;
  Figure.use(old);
  assert.match(Figure.small('#378add'), /viewBox="0 0 24 24"/, 'a definition that does not say: the whole box');
  Figure.use({ ...old, box: [48, 30] });
  assert.match(Figure.small('#378add'), /viewBox="0 0 48 30" style="[^"]*;aspect-ratio:48\/30"/, 'whatever the box is');
  for (const small of [null, {}, { view: [0, 0, 0, 1] }, { view: [0, 0, 1] }, { view: '0 0 1 1' }]) {
    assert.throws(() => Figure.use({ ...copy(def), small }), /Figure definition: small/, JSON.stringify(small));
  }
});

test('renderer: a state the page does not know is drawn as idle', () => {
  const Figure = page();
  Figure.use(copy(def));
  for (const odd of ['sleeping', '', undefined, 'constructor', '"><script>']) assert.equal(Figure.svg(odd, '#378add'), Figure.svg('idle', '#378add'), String(odd));
});

test('renderer: only the layers that move get keyframes', () => {
  const Figure = page();
  assert.equal(Figure.css(), '');
  Figure.use(copy(def));
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
  Figure.use(copy(def));
  const svg = Figure.svg('idle', '#fff;"><img src=x onerror=alert(1)>');
  assert.ok(svg.includes('style="--c:#fffimg srcx onerroralert(1);--w:'), 'only what a colour is written with stays');
  assert.equal(svg.split('<').length, Figure.svg('idle', '#fff').split('<').length);
  assert.ok(Figure.svg('idle').includes('--c:#888780'), 'no colour is grey');
});

test('renderer: a hat on the head, from the kit or drawn inline; one it cannot draw is left out', () => {
  const Figure = page();
  Figure.use(copy(def));
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
    const d = copy(def);
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
  Figure.use(copy(def));
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
  Figure.use({ ...copy(def), head: { cx: 12, cy: 16, r: 7 } });
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
  known.use(copy(def));
  const shapes = (svg) => body(look(svg)).replace(/ transform="[^"]*"/g, '');
  assert.equal(shapes(Figure.svg('idle', '#378add')), shapes(known.svg('idle', '#378add')));
  assert.match(Figure.small('#378add', { hat: 'cap' }), /^<svg class="fig fig-small" viewBox="0 0 24 24" [^>]*data-asked="[^"]*"><circle class="f-main s-none" cx="12" cy="16.5" r="7.5"\/><\/svg>$/);
  const state = (over) => ({ ...copy(def), states: { idle: { ...copy(def.states.idle), ...over } } });
  const bad = [
    null,
    { ...copy(def), version: 1 },
    { ...copy(def), version: 3 },
    { ...copy(def), head: { cx: 12, cy: 16 } },
    { ...copy(def), tones: { white: 'url(x)', ink: '#000000' } },
    { ...copy(def), pivot: { head: [12, 16] } },
    { ...copy(def), attach: { hat: { at: [12, 9], scale: 0 } } },
    { ...copy(def), default: 'nobody' },
    { ...copy(def), default: 'constructor' },
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
  Figure.use({ ...copy(def), mouth: {}, states: { ...copy(def.states), dancing: { ...copy(def.states.idle), pose: { head: { turn: 20 } } } } });
  assert.match(Figure.svg('dancing', '#378add'), /fig-dancing/);
});

// The table the Android and Mac renderers are checked against too (FigureTest.kt, FigureTests.swift), so
// that a definition one app draws from is one every app draws from.
test('renderer: the definitions every app must take alike are taken so here', () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'figure-cases.json'), 'utf8'));
  assert.ok(cases.length >= 15);
  for (const c of cases) {
    const Figure = page();
    const d = { ...copy(def), states: { ...copy(def.states), extra: c.state } };
    if (!c.accepted) { assert.throws(() => Figure.use(d), /Figure definition/, c.what); continue; }
    assert.doesNotThrow(() => Figure.use(d), c.what);
    assert.match(Figure.svg('extra', '#378add'), /fig-extra/, c.what);
    assert.equal(Figure.css().includes('fig-extra-'), c.moves, c.what);
  }
});

test('renderer: a small mark says whose it is when told, and keeps that when it is drawn again', () => {
  const Figure = page();
  Figure.use(copy(def));
  const plain = Figure.small('#378add', { hat: 'cap' });
  assert.ok(!plain.includes('data-bot'));
  assert.equal(Figure.small('#378add', { hat: 'cap' }, 'mail-keeper'), plain.replace(' aria-hidden="true"', ' aria-hidden="true" data-bot="mail-keeper"'));
  assert.equal(Figure.small('#378add', null, '"><img src=x>').split('<').length, Figure.small('#378add').split('<').length, 'an id cannot carry markup');
  // Drawn bare before the definition arrived, then drawn again from it: still its bot's.
  const { Figure: late, els } = pageWithDocument([(F) => F.small('#378add', { hat: 'cap' }, 'mail-keeper')]);
  assert.match(els[0].outerHTML, / data-bot="mail-keeper" data-asked=/);
  late.use(copy(def));
  assert.equal(els[0].outerHTML, late.small('#378add', { hat: 'cap' }, 'mail-keeper'));
  assert.ok(els[0].outerHTML.includes('class="hat"') && els[0].outerHTML.includes('data-bot="mail-keeper"'));
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
  assert.match(await get('/'), /<script src="\/figure\.js"><\/script>\s*<script src="\/app\.js">/);
  assert.match(await get('/figure.js'), /root\.Figure = /);
  assert.ok(!/\.bd\b|bd-av|botDot\(/.test((await get('/style.css')) + webSource()));
  assert.ok(!/name-dot|needs-dots/.test((await get('/style.css')) + webSource() + (await get('/mentions.js'))));
  assert.ok(!/stick figure|\.b-head|b-at-|held object|small figure/.test((await get('/style.css')) + webSource() + (await get('/figure.js'))));
  // Beside a name, a bot's small head wears its hat.
  assert.match(await get('/app.js'), /const botMark = \(b\) => Figure\.small\(colorOf\(b\), outfitOf\(b\), botById\(b\?\.id\)\?\.id\);/);
  // The avatar has no circle behind the head.
  assert.match(await get('/style.css'), /^\.avatar\.head \{ background: none;/m);
});
