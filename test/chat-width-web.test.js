// The chat's width beside the keypad on the web page (#28): the part of public/app.js that keeps it, cut out and
// run against stand-in elements and a stand-in localStorage: the limits, the drag, the arrow keys, the
// double-click and what is remembered. And the stylesheet: the handle is there only beside the keypad (a window
// wider than 1000), and the keypad keeps its room.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, element, finders } = require('./web-page');
const { rulesAt, winner } = require('./css-rules');
const { webSource } = require('./web-source');

const css = read('style.css');
const html = read('index.html');

// The page with what the browser kept from last time. The chat column's right edge is the window's, at 1400;
// `most`: the widest the stylesheet lets the chat be in this window (its max-width).
function page({ most = Infinity, kept = {}, storage = true } = {}) {
  const store = new Map(Object.entries(kept));
  const vars = new Map();
  const app = element({}, { style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k) } });
  const attrs = new Map();
  const captured = [];
  const grip = element({}, { setAttribute: (k, v) => attrs.set(k, String(v)), setPointerCapture: (id) => captured.push(id) });
  const main = element({}, { getBoundingClientRect: () => {
    const width = Math.min(most, Number.parseFloat(vars.get('--chat-w') || '480'));
    return { left: 1400 - width, right: 1400, width };
  } });
  const doc = element({ '#app': app, '#chat-grip': grip, '.main': main });
  const localStorage = storage
    ? { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
    : { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); }, removeItem() { throw new Error('private mode'); } };
  const win = { listeners: {}, addEventListener(type, fn) { (win.listeners[type] ||= []).push(fn); } };
  const ctx = vm.createContext({ ...finders(doc), localStorage, window: win, Math, Number, String });
  vm.runInContext(`${cut('// ---------- the list\'s width ----------', '// ---------- contacts (sidebar) ----------')}\nthis.chatWidth = chatWidth; this.initChatGrip = initChatGrip;`, ctx);
  ctx.initChatGrip();
  const fire = (type, ev = {}) => { for (const fn of grip.listeners[type] || []) fn({ preventDefault() {}, pointerId: 1, ...ev }); };
  return { ctx, win, fire, grip, captured, width: () => vars.get('--chat-w') ?? null, side: () => vars.get('--side-w') ?? null, kept: () => store.get('botdot.chat.width') ?? null, value: () => attrs.get('aria-valuenow') };
}

test('web: the chat beside the keypad is never narrower than 400 or wider than 900', () => {
  const { ctx } = page();
  assert.equal(ctx.chatWidth(120), 400);
  assert.equal(ctx.chatWidth(612.6), 613);
  assert.equal(ctx.chatWidth(2000), 900);
});

test('web: a chat nobody resized has no width of its own: the stylesheet gives it one', () => {
  const { width, value, win, grip } = page();
  assert.equal(width(), null);
  assert.equal(value(), '480');
  assert.equal(win.listeners.resize.length, 1, 'the handle says the width again when the window changes');
  assert.equal(grip.listeners.pointerdown.length, 1);
});

test('web: dragging the divider left widens the chat, right narrows it, and letting go keeps it', () => {
  const { fire, width, side, kept, captured, grip, value } = page();
  fire('pointerdown', { button: 0, clientX: 920 });
  assert.deepEqual(captured, [1], 'the handle keeps the pointer while it is dragged');
  assert.ok(grip.classList.contains('dragging'));
  fire('pointermove', { clientX: 800 });
  assert.equal(width(), '600px', 'the chat runs from the pointer to the window\'s right edge');
  assert.equal(kept(), null, 'nothing is written while the pointer moves');
  fire('pointermove', { clientX: 1300 });
  assert.equal(width(), '400px');
  fire('pointermove', { clientX: 10 });
  assert.equal(width(), '900px');
  fire('pointermove', { clientX: 700 });
  fire('pointerup', { clientX: 700 });
  assert.equal(kept(), '700');
  assert.equal(value(), '700');
  assert.equal(side(), null, 'the list\'s width is not touched');
  assert.ok(!grip.classList.contains('dragging'));
  fire('pointermove', { clientX: 1000 });
  assert.equal(width(), '700px', 'a pointer that only passes over the handle moves nothing');
});

test('web: a click on the divider that drags nowhere keeps nothing', () => {
  const narrow = page({ most: 441, kept: { 'botdot.chat.width': '800' } });
  narrow.fire('pointerdown', { button: 0, clientX: 959 });
  narrow.fire('pointerup', { clientX: 959 });
  assert.equal(narrow.kept(), '800', 'a narrow window showing 441 does not become what is kept');
  assert.equal(narrow.width(), '800px', 'the stylesheet, not this number, keeps the keypad its room');
  assert.equal(narrow.value(), '441', 'the handle says the width the chat has');
});

test('web: only the main button drags, and a drag taken away keeps the width it reached', () => {
  const right = page();
  right.fire('pointerdown', { button: 2, clientX: 920 });
  right.fire('pointermove', { clientX: 800 });
  assert.equal(right.width(), null);
  assert.deepEqual(right.captured, []);
  const cancelled = page();
  cancelled.fire('pointerdown', { button: 0, clientX: 920 });
  cancelled.fire('pointermove', { clientX: 860 });
  cancelled.fire('pointercancel', {});
  assert.equal(cancelled.kept(), '540');
});

test('web: the chat\'s width kept last time is its width after a reload', () => {
  assert.equal(page({ kept: { 'botdot.chat.width': '640' } }).width(), '640px');
  assert.equal(page({ kept: { 'botdot.chat.width': '5000' } }).width(), '900px');
  for (const junk of ['', 'wide', '-40', 'NaN', '0']) assert.equal(page({ kept: { 'botdot.chat.width': junk } }).width(), null, `"${junk}" is no width`);
});

test('web: a double-click on the divider, or Home, puts the chat back as the stylesheet has it', () => {
  const { fire, width, kept, value } = page({ kept: { 'botdot.chat.width': '640' } });
  fire('dblclick');
  assert.equal(width(), null);
  assert.equal(kept(), null);
  assert.equal(value(), '480');
  fire('keydown', { key: 'ArrowLeft' });
  fire('keydown', { key: 'Home' });
  assert.equal(width(), null);
  assert.equal(kept(), null);
});

test('web: the arrow keys move the divider by 16: left widens the chat, right narrows it', () => {
  const { fire, width, kept } = page();
  fire('keydown', { key: 'ArrowLeft' });
  assert.equal(width(), '496px');
  assert.equal(kept(), '496');
  fire('keydown', { key: 'ArrowRight' });
  fire('keydown', { key: 'ArrowRight' });
  assert.equal(width(), '464px');
  fire('keydown', { key: 'a' });
  assert.equal(width(), '464px');
});

test('web: a browser that keeps nothing (private mode) still resizes the chat', () => {
  const { fire, width } = page({ storage: false });
  fire('pointerdown', { button: 0, clientX: 920 });
  fire('pointermove', { clientX: 820 });
  fire('pointerup', { clientX: 820 });
  assert.equal(width(), '580px');
  fire('dblclick');
  assert.equal(width(), null);
});

test('web: the divider is a separator the keyboard reaches, between the keypad and the chat', () => {
  const grip = html.match(/<div class="chat-grip"[^>]*>/);
  assert.ok(grip, 'index.html has the handle');
  assert.match(grip[0], /id="chat-grip"/);
  assert.match(grip[0], /role="separator"/);
  assert.match(grip[0], /aria-orientation="vertical"/);
  assert.match(grip[0], /aria-label="Width of the chat"/);
  assert.match(grip[0], /tabindex="0"/);
  assert.match(grip[0], /aria-valuemin="400"/);
  assert.match(grip[0], /aria-valuemax="900"/);
  assert.match(html, /<\/aside>[\s\S]*<div class="side-grip"[^>]*><\/div>\s*(<!--[^>]*-->\s*)?<div class="chat-grip"[^>]*><\/div>\s*<main class="main">/);
  assert.match(webSource(), /^initSideGrip\(\);\ninitChatGrip\(\);$/m);
});

const APP = { tag: 'div', classes: ['app'], index: 1 };
const GRIP = [APP, { tag: 'div', classes: ['chat-grip'], index: 3 }];
const MAIN = [APP, { tag: 'main', classes: ['main'], index: 4 }];
const shown = (wide) => winner(rulesAt(css, wide), GRIP, 'display')?.value !== 'none';

test('web: the divider is there only beside the keypad (a window wider than 1000)', () => {
  for (const wide of [1001, 1280, 1920]) assert.equal(shown(wide), true, `${wide}`);
  for (const wide of [1000, 900, 760, 400]) assert.equal(shown(wide), false, `${wide}: the list has its own handle, or none`);
});

test('web: beside the keypad the chat is the owner\'s width, the stylesheet\'s until then, and the keypad keeps 560', () => {
  const rules = rulesAt(css, 1280);
  assert.equal(winner(rules, MAIN, 'width').value, 'var(--chat-w, clamp(400px, 38vw, 560px))');
  assert.equal(winner(rules, MAIN, 'max-width').value, 'calc(100vw - 560px)');
  assert.equal(winner(rulesAt(css, 900), MAIN, 'max-width'), null, 'in a narrower window the chat takes what the list leaves');
});
