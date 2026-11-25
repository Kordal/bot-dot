// The message box of a chat on the web page, when its text is more than one line: a pill has ends that cut into
// several lines, so the box becomes a rounded rectangle (`tall`), and a pill again when the text is one line or gone.
// The box grows with its text up to 200px and scrolls beyond, with a scrollbar only then, and the copy of the text
// drawn behind it (the chip of a command or a mention) stays under the words. wireComposer is cut out of
// public/chief.js and run against stand-in elements whose heights the test sets: a line is 36px (the one-line
// textarea, its padding included), each further line 20px.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, element, finders, words } = require('./web-page');
const { rulesAt, winner } = require('./css-rules');

const LINE = 36, MORE = 20;
// fitHeight (app.js) sets a box 1px taller than its text, so a fraction of a pixel never shows a scrollbar.
const heightOf = (text, wrapped = 0) => LINE + MORE * (text.split('\n').length - 1 + wrapped);

function box(onSend = async () => {}) {
  const ta = element({}, { clientHeight: LINE, offsetWidth: 300, scrollTop: 0 });
  // The browser: scrollHeight is the text's height, the textarea's own clientHeight what it is drawn at.
  const state = { wrapped: 0 }; // lines the browser added by wrapping
  Object.defineProperty(ta, 'scrollHeight', { get: () => heightOf(ta.value, state.wrapped) });
  Object.defineProperty(ta, 'offsetHeight', { get: () => ta.clientHeight }); // no border
  const pill = element({}, {});
  const mark = element({});
  const form = element({ '.send-btn': element(), '.send-note': element({}, { classes: ['hidden'] }), '.attach-list': element({}, { classes: ['hidden'] }), '.attach-btn': element(), '.composer-box': pill, '.ta-mark': mark }, { text: ta, files: element() });
  const ctx = vm.createContext({ ...words, ...finders(), Math, String, Promise, Map, WeakSet, crypto: globalThis.crypto,
    readyFiles: () => [], toast() {}, askFirst: async () => true, looksLikeSecret: () => false, matchMedia: () => ({ matches: false }), fileChipHTML: (f) => `[${f.name}]`, fetch: () => assert.fail('nothing is uploaded') });
  vm.runInContext(`${cut('// A message box grows with its text', 'function esc(s)')}
    ${cut('const messageKey = ', '// Copy a whole message')}
    ${cut('function wireAttachments(form, uploadTo)', '// "@" suggestions above the message box')}
    ${cut('function sendNoteText(err)', 'function setSendBusy(form, busy, onStop)')}
    this.wireComposer = wireComposer;`, ctx);
  ctx.wireComposer(form, onSend, () => 'chief');
  const type = (text) => { ta.value = text; ta.oninput(); };
  return { ctx, form, state, ta, pill, mark, type, tall: () => pill.classList.contains('tall'), submit: () => form.onsubmit({ preventDefault() {} }) };
}

test('web: one line is a pill, a second line makes the box a rounded rectangle, and deleting it makes a pill again', () => {
  const b = box();
  b.type('Hello');
  assert.equal(b.tall(), false);
  assert.equal(b.ta.style.height, `${LINE + 1}px`);
  b.type('Hello\nthere');
  assert.equal(b.tall(), true);
  assert.equal(b.ta.style.height, `${LINE + MORE + 1}px`);
  b.type('Hello');
  assert.equal(b.tall(), false);
});

test('web: a long text that wraps, with no newline in it, is tall too', () => {
  const b = box();
  b.type('x'.repeat(10));
  assert.equal(b.tall(), false);
  b.state.wrapped = 1; // the browser wrapped it
  b.ta.oninput();
  assert.equal(b.tall(), true);
});

test('web: the box stops at 200px and scrolls from there, with a scrollbar only then', () => {
  const b = box();
  b.type('a\nb\nc');
  assert.equal(b.ta.style.height, `${heightOf('a\nb\nc') + 1}px`);
  assert.equal(b.ta.style.overflowY, 'hidden', 'no scrollbar while the text fits');
  const many = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  b.type(many);
  assert.equal(b.ta.style.height, '200px');
  assert.equal(b.ta.style.overflowY, 'auto');
  assert.equal(b.tall(), true);
  b.type('short');
  assert.equal(b.ta.style.overflowY, 'hidden');
  assert.equal(b.ta.style.height, `${LINE + 1}px`);
});

test('web: the copy of the text behind the box follows the scroll and the room a scrollbar takes', () => {
  const b = box();
  b.type(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
  b.ta.scrollTop = 80;
  b.ta.clientWidth = 285;
  b.ta.listeners.scroll.forEach((fn) => fn());
  assert.equal(b.mark.style.transform, 'translateY(-80px)');
  assert.equal(b.mark.style.right, '15px');
  b.ta.clientWidth = 300;
  b.ta.scrollTop = 0;
  b.ta.oninput();
  assert.equal(b.mark.style.right, '0px');
});

test('web: a send empties the box, and it is a pill again; a send that failed puts the text back and the box is tall again', async () => {
  let fail = false;
  const b = box(async () => { if (fail) throw Object.assign(new Error("Can't reach botdot."), { unreached: true }); });
  b.type('one\ntwo\nthree');
  assert.equal(b.tall(), true);
  await b.submit();
  assert.equal(b.ta.value, '');
  assert.equal(b.tall(), false);
  assert.equal(b.ta.style.height, `${LINE + 1}px`);
  fail = true;
  b.type('one\ntwo\nthree');
  await b.submit();
  assert.equal(b.ta.value, 'one\ntwo\nthree', 'the text is back');
  assert.equal(b.tall(), true);
});

test('web: a message the owner takes back is tall when it has several lines', () => {
  const b = box();
  b.form._takeBack('a\nb', []);
  assert.equal(b.tall(), true);
});

test('web: the stylesheet: the box is a pill, tall is a rounded rectangle of a token radius, on a phone as well', () => {
  const css = read('style.css');
  const BOX = [{ tag: 'div', classes: ['composer-box'], index: 1 }];
  const TALL = [{ tag: 'div', classes: ['composer-box', 'tall'], index: 1 }];
  const TA = [{ tag: 'div', classes: ['composer-box'], index: 1 }, { tag: 'textarea', classes: [], index: 1 }];
  for (const wide of [1400, 390]) {
    const rules = rulesAt(css, wide);
    assert.equal(winner(rules, BOX, 'border-radius').value, 'var(--r-pill)', `${wide}: one line`);
    assert.equal(winner(rules, TALL, 'border-radius').value, 'var(--r-14)', `${wide}: more lines`);
    assert.equal(winner(rules, [{ tag: 'form', classes: ['composer'], index: 1 }, ...TA], 'overflow-y').value, 'hidden', `${wide}: the scrollbar is the script's to ask for`);
  }
  assert.match(css, /\.composer \.?textarea \{[^}]*max-height: 200px/, 'the cap the script grows to');
  assert.match(read('chief.js'), /MAX_BOX_TEXT = 200;/);
});
