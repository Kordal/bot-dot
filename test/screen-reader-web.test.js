// What a screen reader hears on the web page (#1077): a reply that arrives in the open chat, the working line's words
// when they change, and a toast, an error at once. The page's own code, cut out of it and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, read } = require('./web-page');

const html = read('index.html');
const css = read('style.css');

// The live region: <p> rows that it keeps, the last three.
function region() {
  const box = { children: [], get childElementCount() { return box.children.length; }, get firstElementChild() { return box.children[0]; },
    append(p) { box.children.push(p); p.remove = () => box.children.splice(box.children.indexOf(p), 1); } };
  const ctx = vm.createContext({ String, $: (sel) => (sel === '#say' ? box : null), document: { createElement: () => ({ textContent: '' }) } });
  vm.runInContext(`${cut('// What a screen reader hears of a chat (#1077)', '// A status in the page\'s language')} this.say = say;`, ctx);
  return { say: ctx.say, said: () => box.children.map((p) => p.textContent) };
}

test('web: the page has one polite live region, heard and not seen, and the toast is read out', () => {
  assert.match(html, /<div id="say" class="sr-only" aria-live="polite"><\/div>/);
  assert.match(html, /<div id="toast" class="toast hidden" popover="manual" role="status" aria-live="polite"><\/div>/);
  assert.match(css, /\.sr-only \{ position: absolute; width: 1px; height: 1px;[^}]*clip-path: inset\(50%\);/);
  const toast = cut('function toast(msg, isErr = false) {', '// It sinks away');
  assert.ok(toast.includes("t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');"), 'an error is read at once');
  assert.ok(toast.indexOf("setAttribute('aria-live'") < toast.indexOf('t.textContent = msg'), 'set before its words change');
});

test('web: what is said is its words in one line; two at once are both kept, and only the last three stay', () => {
  const r = region();
  r.say('  Done.\n\nThree pull requests\tare open. ');
  r.say('');
  r.say(null);
  assert.deepEqual(r.said(), ['Done. Three pull requests are open.'], 'nothing for no words');
  r.say('Working');
  r.say('Reading the inbox');
  r.say('Two new mails.');
  assert.deepEqual(r.said(), ['Working', 'Reading the inbox', 'Two new mails.']);
  r.say('x'.repeat(1000));
  assert.equal(r.said().at(-1).length, 400, 'a long reply is cut');
});

test('web: a reply that arrives is said, motion or not, and the working line when its words change', () => {
  const arrive = cut('// A screen reader hears it, motion or not (#1077)', '// The Chief\'s chat as it is drawn');
  assert.match(arrive, /if \(!reducedMotion\(\)\) row\.classList\.add\('arrives'\);\n\s*if \(globalThis\.say\) say\(\[\.\.\.row\.querySelectorAll\('\.bubble'\)\]\.map\(\(b\) => b\.textContent\)\.join\(' '\)\);/);
  const line = cut('function drawStatusLine(thread', '// "Waiting for your OK"');
  assert.match(line, /if \(words && words !== thread\._said && globalThis\.say && onScreen\(thread\)\) \{ thread\._said = words; say\(words\); \}/);
  // The line is drawn anew each time: it is no live region of its own, so it is not read twice.
  assert.doesNotMatch(read('opening-line.js'), /status-line[^`]*role="status"/);
});
