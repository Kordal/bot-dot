// The web page's motion system (#497): the tokens of public/style.css, the movements that use them, reduced motion,
// and public/motion.js against stand-in elements. The movements themselves are walked in test/browser/motion.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, cut } = require('./web-page');
const Motion = require('../public/motion.js');

const css = read('style.css');
const motion = css.slice(css.indexOf('/* ---------- motion (#497'));

test('web: three times and two curves on :root, and every movement of the motion section uses them', () => {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  assert.match(root, /--t1: 120ms;/);
  assert.match(root, /--t2: 200ms;/);
  assert.match(root, /--t3: 260ms;/);
  assert.match(root, /--out: cubic-bezier\(\.2, \.8, \.2, 1\);/);
  assert.match(root, /--in: cubic-bezier\(\.4, 0, 1, 1\);/);
  assert.ok(motion.length > 500, 'the motion section is there');
  for (const [, decl] of motion.matchAll(/animation:([^;}]*)/g)) assert.doesNotMatch(decl, /\b\d+(\.\d+)?m?s\b/, `no time of its own: ${decl}`);
  for (const [, body] of motion.matchAll(/@keyframes [\w-]+ \{(.*)\}$/gm)) {
    assert.doesNotMatch(body, /\b(width|height|top|left|margin|padding)\s*:/, `only transform and opacity move: ${body}`);
  }
});

test('web: the enters take --out and the exits --in, one step shorter', () => {
  assert.match(motion, /\.m-board-in \{ animation: m-grow var\(--t2\) var\(--out\); \}/);
  assert.match(motion, /\.m-board-out \{ animation: m-shrink var\(--t1\) var\(--in\) forwards; \}/);
  assert.match(motion, /\.m-push \{ animation: m-push var\(--t3\) var\(--out\); \}/);
  assert.match(motion, /\.m-push-out \{ animation: m-push-out var\(--t2\) var\(--in\) forwards; \}/);
  assert.match(motion, /\.toast:popover-open \{ animation: m-rise var\(--t2\) var\(--out\); \}/);
  assert.match(motion, /\.toast\.leaving \{ animation: m-sink var\(--t1\) var\(--in\) forwards; \}/);
  assert.match(motion, /animation-delay: calc\(var\(--m-i\) \* 20ms\)/, 'the tiles 20 ms apart');
  assert.match(motion, /\.m-board-in \.tile \{ --m-i: 6;/, 'at most 120 ms');
  assert.match(css, /\.tile\.pop \{ animation: tile-pop var\(--t3\) var\(--out\); \}/, 'the tile pop takes 260 ms, not 450');
});

test('web: what leaves takes no clicks, and with reduced motion only fades are left', () => {
  assert.match(motion, /\.m-leaving \{[^}]*pointer-events: none;/);
  assert.match(motion, /dialog:not\(\[open\]\) \{[^}]*pointer-events: none;/);
  const reduced = motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /animation: m-fade-in var\(--t1\) linear;/);
  assert.match(reduced, /animation: m-fade-out var\(--t1\) linear forwards;/);
  assert.match(reduced, /\.m-board-in \.tile \{ animation: none; \}/);
  assert.match(reduced, /scale: none; translate: none;/);
});

test('web: the Board leaves towards its key and grows out of it; a phone pushes the chat in and Back pulls it out', () => {
  const show = cut('function show({ view: v', 'function threadToEnd');
  assert.match(show, /if \(changed && from === 'dashboard'\) Motion\.leave\(\$\('#view-dashboard'\), 'm-board-out'\);[^\n]*\n\s+\$\$\('\.view'\)/, 'measured before it is hidden');
  assert.match(show, /if \(changed && v === 'dashboard'\) boardIn\(\);/);
  assert.match(show, /if \(phone && !inMain\) \{ Motion\.leave\(\$\('\.sidebar'\), 'm-recede'\); Motion\.play\(\$\('\.main'\), 'm-push'\); \}\n\s+\$\('#app'\)\.classList\.add\('in-main'\);/);
  assert.match(cut('function showList()', 'const ICON'), /Motion\.leave\(\$\('\.main'\), 'm-push-out'\); Motion\.play\(\$\('\.sidebar'\), 'm-return'\);/);
});

test('motion: a key is just done when its last word was Working, for a moment only', () => {
  assert.equal(Motion.justDone('k1', 'idle', 0), false, 'first seen');
  assert.equal(Motion.justDone('k1', 'working', 10), false);
  assert.equal(Motion.justDone('k1', 'done', 1000), true);
  assert.equal(Motion.justDone('k1', 'done', 1100), true, 'drawn again at once (the keypad and a phone): still');
  assert.equal(Motion.justDone('k1', 'done', 1400), false, 'later draws do not pop it again');
  assert.equal(Motion.justDone('k2', 'done', 0), false, 'done when first seen: no pop');
  Motion.justDone('k3', 'unread', 0);
  assert.equal(Motion.justDone('k3', 'done', 10), false, 'only from Working');
});

// A stand-in element with a place on the page, its classes and the animations asked of it.
function box(key, at) {
  const classes = new Set();
  return { key, at, moves: [], getAttribute: () => key, getBoundingClientRect: () => ({ left: 0, top: at, width: 100, height: 50 }),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }, classes,
    get offsetWidth() { return 100; }, animate(frames) { this.moves.push(frames); } };
}

test('motion: a redraw moves each card from where it was to where it is, and a new one arrives', () => {
  let cards = [box('a', 0), box('b', 60), box('c', 120)];
  const root = { querySelectorAll: () => cards };
  // b was answered: it goes last, c closes up behind a, and d is new.
  Motion.flip(root, '.card', 'data-need', () => { cards = [box('a', 0), box('c', 60), box('b', 120), box('d', 180)]; });
  const [a, c, b, d] = cards;
  assert.deepEqual(a.moves, [], 'what stays put does not move');
  assert.deepEqual(c.moves, [[{ translate: '0px 60px' }, { translate: '0 0' }]]);
  assert.deepEqual(b.moves, [[{ translate: '0px -60px' }, { translate: '0 0' }]]);
  assert.ok(d.classes.has('arrives'), 'a new card arrives as a message does');
  clearTimeout(d._play);

  cards = [];
  let drawn = 0;
  Motion.flip(root, '.card', 'data-need', () => { drawn++; cards = [box('x', 0)]; });
  assert.equal(drawn, 1);
  assert.ok(!cards[0].classes.has('arrives'), 'the first draw: nothing arrives');
});
