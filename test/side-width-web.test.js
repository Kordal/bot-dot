// The list's width on the web page (#385): the part of public/app.js that keeps it, cut out and run against
// stand-in elements and a stand-in localStorage: the limits, the drag, the arrow keys, the double-click and
// what is remembered. And the stylesheet: the handle is there only where the list has its full layout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, element, finders } = require('./web-page');
const { rulesAt, winner } = require('./css-rules');

const css = read('style.css');
const html = read('index.html');

// The page with what the browser kept from last time. `most`: the widest the stylesheet lets the list be in
// this window (its max-width).
function page({ most = Infinity, kept = {}, storage = true } = {}) {
  const store = new Map(Object.entries(kept));
  const vars = new Map();
  const app = element({}, { style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k) } });
  const attrs = new Map();
  const captured = [];
  const grip = element({}, { setAttribute: (k, v) => attrs.set(k, String(v)), setPointerCapture: (id) => captured.push(id) });
  const side = element({}, { getBoundingClientRect: () => ({ left: 0, width: Math.min(most, Number.parseFloat(vars.get('--side-w') || '300')) }) });
  const doc = element({ '#app': app, '#side-grip': grip, '.sidebar': side });
  const localStorage = storage
    ? { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
    : { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); }, removeItem() { throw new Error('private mode'); } };
  const win = { listeners: {}, addEventListener(type, fn) { (win.listeners[type] ||= []).push(fn); } };
  const ctx = vm.createContext({ ...finders(doc), localStorage, window: win, Math, Number, String });
  vm.runInContext(`${cut('// ---------- the list\'s width ----------', '// ---------- contacts (sidebar) ----------')}\nthis.sideWidth = sideWidth; this.initSideGrip = initSideGrip;`, ctx);
  ctx.initSideGrip();
  const fire = (type, ev = {}) => { for (const fn of grip.listeners[type] || []) fn({ preventDefault() {}, pointerId: 1, ...ev }); };
  return { ctx, win, fire, grip, captured, width: () => vars.get('--side-w') ?? null, kept: () => store.get('botdot.side.width') ?? null, value: () => attrs.get('aria-valuenow') };
}

test('web: the list is never narrower than 72 or wider than 480', () => {
  const { ctx } = page();
  assert.equal(ctx.sideWidth(20), 72);
  assert.equal(ctx.sideWidth(120), 120);
  assert.equal(ctx.sideWidth(333.4), 333);
  assert.equal(ctx.sideWidth(900), 480);
});

test('web: a click on the handle that drags nowhere keeps nothing', () => {
  const narrow = page({ most: 380, kept: { 'botdot.side.width': '460' } });
  narrow.fire('pointerdown', { button: 0, clientX: 380 });
  narrow.fire('pointerup', { clientX: 380 });
  assert.equal(narrow.kept(), '460', 'a narrow window showing 380 does not become what is kept');
  const fresh = page();
  fresh.fire('pointerdown', { button: 0, clientX: 300 });
  fresh.fire('pointerup', { clientX: 300 });
  assert.equal(fresh.kept(), null);
  assert.equal(fresh.width(), null);
});

test('web: a narrow window does not cut down what is kept: the list is wide again when the window is', () => {
  const { width, kept, value, win, grip } = page({ most: 380, kept: { 'botdot.side.width': '460' } });
  assert.equal(width(), '460px', 'the stylesheet, not this number, keeps the chat its room');
  assert.equal(kept(), '460');
  assert.equal(value(), '380', 'the handle says the width the list has');
  assert.equal(win.listeners.resize.length, 1, 'and says it again when the window changes');
  assert.equal(grip.listeners.pointerdown.length, 1);
});

test('web: a list nobody resized has no width of its own: the stylesheet gives it one', () => {
  const { width, value } = page();
  assert.equal(width(), null);
  assert.equal(value(), '300');
  assert.equal(winner(cssAt(1000), SIDE, 'width').value, 'var(--side-w, 260px)', 'wider than 1000 the keypad takes the list\'s place (keypad-web.test.js)');
});

test('web: dragging the edge sets the width under the pointer, and letting go keeps it', () => {
  const { fire, width, kept, captured, grip, value } = page();
  fire('pointerdown', { button: 0, clientX: 300 });
  assert.deepEqual(captured, [1], 'the handle keeps the pointer while it is dragged');
  assert.ok(grip.classList.contains('dragging'));
  fire('pointermove', { clientX: 352 });
  assert.equal(width(), '352px');
  assert.equal(kept(), null, 'nothing is written while the pointer moves');
  fire('pointermove', { clientX: 40 });
  assert.equal(width(), '72px');
  fire('pointermove', { clientX: 1300 });
  assert.equal(width(), '480px');
  fire('pointermove', { clientX: 410 });
  fire('pointerup', { clientX: 410 });
  assert.equal(kept(), '410');
  assert.equal(value(), '410');
  assert.ok(!grip.classList.contains('dragging'));
  fire('pointermove', { clientX: 250 });
  assert.equal(width(), '410px', 'a pointer that only passes over the handle moves nothing');
});

test('web: a drag that is taken away (pointercancel) keeps the width it reached', () => {
  const { fire, kept, grip } = page();
  fire('pointerdown', { button: 0, clientX: 300 });
  fire('pointermove', { clientX: 260 });
  fire('pointercancel', {});
  assert.equal(kept(), '260');
  assert.ok(!grip.classList.contains('dragging'));
});

test('web: only the main button drags', () => {
  const { fire, width, captured } = page();
  fire('pointerdown', { button: 2, clientX: 300 });
  fire('pointermove', { clientX: 400 });
  assert.equal(width(), null);
  assert.deepEqual(captured, []);
});

test('web: the width kept last time is the width after a reload', () => {
  assert.equal(page({ kept: { 'botdot.side.width': '410' } }).width(), '410px');
  assert.equal(page({ kept: { 'botdot.side.width': '4100' } }).width(), '480px');
  for (const junk of ['', 'wide', '-40', 'NaN', '0']) assert.equal(page({ kept: { 'botdot.side.width': junk } }).width(), null, `"${junk}" is no width`);
});

test('web: a double-click on the handle puts the list back as the stylesheet has it', () => {
  const { fire, width, kept, value } = page({ kept: { 'botdot.side.width': '410' } });
  fire('dblclick');
  assert.equal(width(), null);
  assert.equal(kept(), null);
  assert.equal(value(), '300');
});

test('web: the arrow keys move the handle by 16, Home puts the list back', () => {
  const { fire, width, kept } = page();
  fire('keydown', { key: 'ArrowRight' });
  assert.equal(width(), '316px');
  assert.equal(kept(), '316');
  fire('keydown', { key: 'ArrowLeft' });
  fire('keydown', { key: 'ArrowLeft' });
  assert.equal(width(), '284px');
  fire('keydown', { key: 'a' });
  assert.equal(width(), '284px');
  fire('keydown', { key: 'Home' });
  assert.equal(width(), null);
  assert.equal(kept(), null);
});

test('web: a browser that keeps nothing (private mode) still resizes', () => {
  const { fire, width } = page({ storage: false });
  fire('pointerdown', { button: 0, clientX: 300 });
  fire('pointermove', { clientX: 360 });
  fire('pointerup', { clientX: 360 });
  assert.equal(width(), '360px');
  fire('dblclick');
  assert.equal(width(), null);
});

test('web: the handle is a separator the keyboard reaches, between the list and the chat', () => {
  const grip = html.match(/<div class="side-grip"[^>]*>/);
  assert.ok(grip, 'index.html has the handle');
  assert.match(grip[0], /id="side-grip"/);
  assert.match(grip[0], /role="separator"/);
  assert.match(grip[0], /aria-orientation="vertical"/);
  assert.match(grip[0], /tabindex="0"/);
  assert.match(grip[0], /aria-valuemin="72"/);
  assert.match(grip[0], /aria-valuemax="480"/);
  assert.match(html, /<\/aside>\s*<!--[^>]*-->\s*<div class="side-grip"|<\/aside>\s*<div class="side-grip"/);
});

// The stylesheet with only the rules that hold in a window `wide` wide, around a list `side` wide.
const cssAt = (wide, side = 300) => rulesAt(css, wide, side);
const GRIP = [{ tag: 'div', classes: ['app'], index: 1 }, { tag: 'div', classes: ['side-grip'], index: 2 }];
const SIDE = [{ tag: 'div', classes: ['app'], index: 1 }, { tag: 'aside', classes: ['sidebar'], index: 1 }];

test('web: the handle is there only while the list has its full layout (a window from 761 to 1000)', () => {
  assert.equal(winner(cssAt(1400), GRIP, 'display').value, 'none', 'wider, the keypad has no handle');
  for (const wide of [761, 1000]) {
    assert.notEqual(winner(cssAt(wide), GRIP, 'display').value, 'none', `${wide}`);
    assert.match(winner(cssAt(wide), SIDE, 'width').value, /^var\(--side-w, (300|260)px\)$/, `${wide}`);
    assert.equal(winner(cssAt(wide), SIDE, 'max-width').value, 'calc(100vw - 420px)', `${wide}: the chat keeps 420`);
  }
  assert.equal(winner(cssAt(760), GRIP, 'display').value, 'none');
  assert.equal(winner(cssAt(760), SIDE, 'width').value, '200px', 'the compact list stays 200');
  assert.equal(winner(cssAt(760), SIDE, 'max-width'), null);
  assert.equal(winner(cssAt(400), GRIP, 'display').value, 'none');
  assert.equal(winner(cssAt(400), SIDE, 'width').value, '100%', 'a phone shows the list alone');
  assert.equal(winner(cssAt(400), SIDE, 'max-width'), null);
});

// A row of the list and what is in it.
const ROW = [...SIDE, { tag: 'div', classes: ['contacts'], index: 3 }, { tag: 'button', classes: ['contact'], index: 2 }];
const inRow = (...classes) => [...ROW, { tag: 'div', classes: ['grow'], index: 2 }, { tag: 'div', classes: ['top'], index: 1 }, { tag: 'span', classes, index: 1 }];
const shown = (rules, chain) => winner(rules, chain, 'display')?.value !== 'none';

test('web: a list under 240 leaves out the previews and the times, and one under 140 the names too', () => {
  const PREV = [...ROW, { tag: 'div', classes: ['grow'], index: 2 }, { tag: 'div', classes: ['prev'], index: 2 }];
  for (const [side, name, prev] of [[300, true, true], [240, true, true], [239, true, false], [140, true, false], [139, false, false], [72, false, false]]) {
    const rules = cssAt(1000, side);
    assert.equal(shown(rules, inRow('name')), name, `${side}: the name`);
    assert.equal(shown(rules, PREV), prev, `${side}: the preview`);
    assert.equal(shown(rules, inRow('time')), prev, `${side}: the time`);
    assert.equal(shown(rules, inRow('unread-dots')), true, `${side}: the dots of a new reply are always there`);
    assert.equal(shown(rules, inRow('asks-mark')), true, `${side}: and so is the mark of a bot that asks`);
  }
});

test('web: a narrow window\'s compact list is the same layout as a list dragged to 200', () => {
  assert.equal(winner(cssAt(700, 200), [...ROW, { tag: 'div', classes: ['avatar'], index: 1 }], 'width').value, '34px');
  assert.equal(winner(cssAt(1000, 200), [...ROW, { tag: 'div', classes: ['avatar'], index: 1 }], 'width').value, '34px');
  assert.equal(winner(cssAt(1000, 300), [...ROW, { tag: 'div', classes: ['avatar'], index: 1 }], 'width').value, '42px');
});

test('web: a list of figures only has no search, a mark for the Board, and a line for a category', () => {
  // The search (#635): its icon in the top bar, and its field once opened.
  const OPEN = [SIDE[0], { ...SIDE[1], classes: ['sidebar', 'search-open'] }];
  const HEAD = (side) => [...side, { tag: 'div', classes: ['side-head'], index: 1 }];
  const FIELD = [...HEAD(OPEN), { tag: 'div', classes: ['search'], index: 4 }];
  const ICON = [...HEAD(SIDE), { tag: 'nav', classes: ['side-tools'], index: 5 }, { tag: 'button', classes: ['more-btn'], index: 1, id: 'search-btn' }];
  const STRIP = [...SIDE, { tag: 'div', classes: ['contacts'], index: 3 }, { tag: 'button', classes: ['dash-strip'], index: 1 }];
  const mark = [...STRIP, { tag: 'svg', classes: ['board-ico'], index: 1 }], tiles = [...STRIP, { tag: 'span', classes: ['tiles'], index: 2 }];
  const heading = [...SIDE, { tag: 'div', classes: ['contacts'], index: 3 }, { tag: 'div', classes: ['group-head'], index: 4 }, { tag: 'button', classes: ['group-toggle'], index: 1 }];
  for (const [side, rail] of [[300, false], [200, false], [140, false], [139, true], [72, true]]) {
    const rules = cssAt(1000, side);
    assert.equal(shown(rules, ICON), !rail, `${side}: the search's icon`);
    assert.equal(shown(rules, FIELD), !rail, `${side}: its field, opened`);
    assert.equal(shown(rules, tiles), !rail, `${side}: the Board's tiles`);
    assert.equal(shown(rules, mark), rail, `${side}: the Board's mark`);
    assert.equal(shown(rules, heading), !rail, `${side}: a category's name`);
  }
  assert.doesNotMatch(html, /side-search-btn/);
});

test('web: every row carries its name as its title, for a list that shows figures only', () => {
  const { app } = require('./web-page');
  assert.match(app, /data-contact="chief" title="\$\{esc\(chiefName\(\)\)\}">/);
  assert.match(app, /draggable="true" title="\$\{esc\(b\.name\)\}">/);
  assert.match(read('groups.js'), /draggable="true" title="\$\{esc\(g\.name\)\}">/);
});
