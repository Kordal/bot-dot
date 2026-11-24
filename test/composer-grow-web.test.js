// A message box that grows with its text (fitHeight, app.js) never shows a scrollbar for a fraction of a pixel: the
// text is 36.3px tall, scrollHeight says 36, and a box that high scrolled by 0.3px (an empty box, right after a send).
// The page's own code, cut out of it and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { cut, read } = require('./web-page');

const ctx = vm.createContext({});
vm.runInContext(`${cut('// A message box grows with its text', 'function esc(s)')}; this.fitHeight = fitHeight;`, ctx);

// A box whose content is `content` px tall; the height it was set to is what it then shows.
const box = (content, border = 0) => {
  const ta = { style: {}, scrollHeight: content, offsetHeight: content + border, clientHeight: content };
  return ta;
};

test('web: a box fitted to a text of 36px has a pixel to spare, and no scrollbar', () => {
  const ta = box(36);
  ctx.fitHeight(ta);
  assert.equal(ta.style.height, '37px');
  assert.equal(ta.style.overflowY, 'hidden');
});

test('web: a box counts its border, and stops growing at 200px, scrolling only from there', () => {
  const ta = box(40, 2);
  ctx.fitHeight(ta);
  assert.equal(ta.style.height, '43px');
  const tall = box(500);
  ctx.fitHeight(tall);
  assert.equal(tall.style.height, '200px');
  assert.equal(tall.style.overflowY, 'auto');
  const edge = box(199);
  ctx.fitHeight(edge);
  assert.equal(edge.style.height, '200px');
  assert.equal(edge.style.overflowY, 'hidden', 'it fits in the 200px: nothing to scroll');
});

test('web: the message boxes use it, and their CSS hides the scrollbar until the cap', () => {
  assert.match(read('chief.js'), /const grow = \(\) => \{ fitHeight\(ta\); paint\(\); \}/);
  assert.match(read('app.js'), /ta\.oninput = \(\) => \{\s*fitHeight\(ta\);/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /^\.composer textarea \{[^}]*overflow-y: hidden/m);
  assert.match(css, /^\.ask-card textarea \{[^}]*overflow-y: hidden/m);
});
