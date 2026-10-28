// Quote on the web page (#97): public/quote.js loaded the way the browser loads it (a plain script, window.Quote),
// checked against the table every app follows (test/fixtures/quote-cases.json); the text of a selection read from a
// message as the owner saw it; and the Quote button (chief.js, initQuote) run against stand-in elements: it shows for
// text selected in one message of a chat, and a tap adds the quote to that chat's message box after the draft.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, read, words } = require('./web-page');
const table = require('./fixtures/quote-cases.json');

const page = vm.createContext({ ...words });
vm.runInContext(read('quote.js'), page);
const { Quote } = page;
const plain = (x) => JSON.parse(JSON.stringify(x)); // out of the page's realm, for deepEqual

test('web: the page gets Quote as window.Quote, loaded before app.js, and boot.js starts the button', () => {
  assert.equal(typeof Quote.add, 'function');
  assert.equal(page.module, undefined);
  const html = read('index.html');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/quote.js') > 0 && at('/quote.js') < at('/app.js'));
  assert.match(read('boot.js'), /^initQuote\(\);/m);
});

for (const c of table.blocks) test(`web table: ${c.name}`, () => assert.equal(Quote.block(c.selected), c.quote));

for (const c of table.adds) {
  test(`web table add: ${c.name}`, () => {
    const done = Quote.add(c.draft, c.selected);
    if (c.text === null) return assert.equal(done, null);
    assert.deepEqual(plain(done), { text: c.text, cursor: c.text.length });
  });
}

// ---------- reading a selection ----------

// A stand-in DOM node: an element (tag, attributes, children) or, for a string, a text node.
function h(tag, attrs = {}, ...kids) {
  const n = {
    nodeType: tag === '#fragment' ? 11 : 1, nodeName: tag.toUpperCase(), attrs, childNodes: [], parentNode: null,
    classList: { contains: (c) => String(attrs.class || '').split(' ').includes(c) },
    getAttribute: (a) => attrs[a] ?? null,
    closest(sel) {
      for (let x = n; x; x = x.parentNode) if (x.classList?.contains(sel.slice(1))) return x;
      return null;
    },
  };
  for (const k of kids) {
    const c = typeof k === 'string' ? { nodeType: 3, nodeName: '#text', nodeValue: k, parentNode: null } : k;
    c.parentNode = n;
    if (c.nodeType === 3) c.parentElement = n;
    n.childNodes.push(c);
  }
  return n;
}
const frag = (...kids) => h('#fragment', {}, ...kids);

test('web: a bot reply reads as it was shown: a heading, then a list that stays a list', () => {
  // How md() draws "## Today\n\n- netcup: …\n- Doctena: …", with its line breaks between the blocks.
  const got = Quote.read(frag(
    h('h2', {}, 'Today'), '\n',
    h('ul', {}, h('li', {}, 'netcup: pilne prace na hoscie (6)'), h('li', {}, 'Doctena: wizyta przelozona i przypomnienie (74, 75)')),
  ));
  assert.equal(got, 'Today\n\n- netcup: pilne prace na hoscie (6)\n- Doctena: wizyta przelozona i przypomnienie (74, 75)\n\n');
  assert.equal(Quote.block(got), '> Today\n>\n> - netcup: pilne prace na hoscie (6)\n> - Doctena: wizyta przelozona i przypomnienie (74, 75)');
});

test('web: paragraphs keep a blank line, a line break is one, spaces of the page source are one', () => {
  const got = Quote.read(frag(h('p', {}, 'First ', h('strong', {}, 'bold'), '\n   words'), '\n', h('p', {}, 'Line one', h('br'), 'line two')));
  assert.equal(Quote.block(got), '> First bold words\n>\n> Line one\n> line two');
});

test('web: a numbered list counts from its start, a sub-list is indented, items cut by the selection are items', () => {
  assert.equal(Quote.block(Quote.read(frag(h('ol', { start: '3' }, h('li', {}, 'three'), h('li', {}, 'four', h('ul', {}, h('li', {}, 'inside'))))))),
    '> 3. three\n> 4. four\n>   - inside');
  // A selection from the middle of one item to the middle of the next: the items without their list.
  assert.equal(Quote.block(Quote.read(frag(h('li', {}, 'tail of one'), h('li', {}, 'start of two')))), '> - tail of one\n> - start of two');
});

test('web: code keeps its spaces; a table is its rows; drawings, buttons and file chips are left out', () => {
  const got = Quote.read(frag(
    h('pre', {}, h('code', {}, 'if x:\n    go()')),
    h('table', {}, h('tr', {}, h('th', {}, 'Bot'), h('th', {}, 'State')), h('tr', {}, h('td', {}, 'Coder'), h('td', {}, 'idle'))),
    h('p', {}, h('svg', {}, 'icon'), 'Done ', h('button', {}, 'Copy')),
    h('div', { class: 'bubble-files' }, 'report.pdf'),
  ));
  assert.equal(Quote.block(got), '> if x:\n>     go()\n>\n> Bot | State\n> Coder | idle\n>\n> Done');
});

test("web: the owner's own message keeps its line breaks, and a bot named in it is its @ mention", () => {
  const got = Quote.read(frag(h('div', { class: 'clamp' }, 'Ask ', h('span', { class: 'mention', title: '@FleetDoctor' }, h('svg', {}), 'Fleet Doctor'), ' first\n  then  me')), true);
  assert.equal(Quote.block(got), '> Ask @FleetDoctor first\n>   then  me');
});

// ---------- the Quote button ----------

// A chat as the page draws it: a view with its thread of bubbles and its message box, and the page's own
// initQuote run against it. select(bubbleA, bubbleB?): text selected from one bubble to another (the same by default).
function chat() {
  const listeners = {};
  const btn = { classList: new Set(['hidden']), style: {}, offsetWidth: 70, offsetHeight: 30 };
  btn.classList.contains = btn.classList.has;
  btn.classList.toggle = (c, on) => (on ? btn.classList.add(c) : btn.classList.delete(c));
  const events = [];
  const ta = { value: '', scrollHeight: 120, scrollTop: 0, focused: false, cursor: null,
    dispatchEvent: (e) => events.push(e.type), focus() { ta.focused = true; }, setSelectionRange(a, b) { ta.cursor = [a, b]; } };
  const form = { text: ta };
  const view = h('section', { class: 'view' });
  const thread = h('div', { class: 'chat-thread' });
  const bot = h('div', { class: 'bubble from-bot' }, h('div', { class: 'md' }, h('p', {}, 'The backup ran at 3:00.')));
  const mine = h('div', { class: 'bubble from-me', pre: true }, h('div', { class: 'clamp' }, 'Check it\nagain'));
  bot.contents = () => h('p', {}, 'The backup ran at 3:00.');
  mine.contents = () => h('div', { class: 'clamp' }, 'Check it\nagain');
  for (const b of [bot, mine]) { b.parentNode = thread; thread.childNodes.push(b); }
  thread.parentNode = view;
  const box = h('textarea'); box.parentNode = view; // the message box, in the same view
  let selection = null, cleared = 0;
  const ctx = vm.createContext({ ...words,
    Quote, Math, Number,
    document: {
      body: { append: (el) => assert.equal(el, btn) },
      createElement: (tag) => { assert.equal(tag, 'button'); return btn; },
      addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    },
    $: (sel, root) => (sel === 'form.composer' && root === view ? form : null),
    getSelection: () => selection || { isCollapsed: true, rangeCount: 0, removeAllRanges() {} },
    getComputedStyle: (el) => ({ whiteSpace: el.attrs.pre ? 'pre-wrap' : 'normal' }),
    requestAnimationFrame: (fn) => fn(),
    matchMedia: () => ({ matches: false }),
    innerWidth: 1000, innerHeight: 800,
    Event: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(`${cut('function initQuote() {', '// Send stays')}\nthis.initQuote = initQuote;`, ctx);
  ctx.initQuote();
  const fire = (type, e = {}) => (listeners[type] || []).forEach((fn) => fn({ target: null, ...e }));
  const select = (from, to = from, contents = from.contents?.() ?? '') => {
    const text = (n) => n.childNodes[0]?.childNodes[0] ?? n.childNodes[0] ?? n;
    selection = { isCollapsed: false, rangeCount: 1, anchorNode: text(from), focusNode: text(to),
      getRangeAt: () => ({ cloneContents: () => frag(contents), getBoundingClientRect: () => ({ top: 300, bottom: 320, left: 120 }) }),
      removeAllRanges() { cleared++; selection = null; } };
    fire('selectionchange');
  };
  const shown = () => !btn.classList.has('hidden');
  const tap = () => { btn.onpointerdown({ preventDefault() {} }); btn.onclick(); };
  return { bot, mine, box, ta, btn, events, select, shown, tap, fire, cleared: () => cleared };
}

test('web: text selected in a bot reply shows Quote above it; a tap adds the quote to the box, the cursor after it', () => {
  const c = chat();
  assert.equal(c.shown(), false);
  c.select(c.bot);
  assert.equal(c.shown(), true);
  assert.deepEqual([c.btn.style.left, c.btn.style.top], ['120px', '262px'], 'above the selection, where the mouse is');
  c.tap();
  assert.equal(c.ta.value, '> The backup ran at 3:00.\n\n');
  assert.deepEqual(c.ta.cursor, [c.ta.value.length, c.ta.value.length]);
  assert.equal(c.ta.focused, true);
  assert.deepEqual(c.events, ['input'], 'the box grows, as after typing');
  assert.equal(c.shown(), false);
  assert.equal(c.cleared(), 1, 'the selection goes');
});

test('web: a draft stays, and quoting twice keeps the first quote', () => {
  const c = chat();
  c.ta.value = 'Is this right?';
  c.select(c.bot);
  c.tap();
  c.select(c.mine);
  c.tap();
  assert.equal(c.ta.value, 'Is this right?\n\n> The backup ran at 3:00.\n\n> Check it\n> again\n\n', "the owner's own message too, its line breaks kept");
});

test('web: no Quote over two messages, in the message box, while the mouse still selects, or for spaces only', () => {
  const c = chat();
  c.select(c.bot, c.mine);
  assert.equal(c.shown(), false, 'two messages');
  c.select(c.box, c.box, '');
  assert.equal(c.shown(), false, 'the message box');
  c.fire('pointerdown');
  c.select(c.bot);
  assert.equal(c.shown(), false, 'still selecting');
  c.fire('pointerup');
  assert.equal(c.shown(), true, 'shown once the mouse lets go');
  c.select(c.bot, c.bot, h('p', {}, '  \n '));
  assert.equal(c.shown(), false, 'spaces only');
});

test('web: a click that ends a selection in a folded message of yours does not unfold it', () => {
  for (const f of ['bot-chat.js', 'chief.js', 'groups.js']) {
    const src = read(f);
    const folds = src.match(/\$\$\('\[data-expand\]'.*/g);
    assert.ok(folds?.length, f);
    for (const line of folds) assert.match(line, /getSelection\(\)\.isCollapsed/, f);
  }
});

test('web: the Quote button is drawn dark like the page', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.quote-btn \{[^}]*position: fixed;[^}]*background: var\(--sunk\);[^}]*color: var\(--text\);/);
});
