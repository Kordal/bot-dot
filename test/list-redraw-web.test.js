// The list, the keypad and a phone's home draw nothing that did not change (#1065): a working line that changes every
// second elsewhere leaves their rows and keys as they are, so a press on one is not lost. The page's own code, cut out
// of public/list.js, against stand-in elements that count what is drawn into them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut } = require('./web-page');

const box = () => {
  const el = { draws: 0, html: '' };
  Object.defineProperty(el, 'innerHTML', { get: () => el.html, set: (v) => { el.draws++; el.html = v; } });
  return el;
};

test('web: the same HTML is not drawn again into the list, the keypad or a phone\'s home (#1065)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${cut('const drawnKey = ', '// Where the window is wide enough')} this.drawHTML = drawHTML;`, ctx);
  const el = box();
  assert.equal(ctx.drawHTML(el, '<b>a</b>'), true);
  assert.equal(ctx.drawHTML(el, '<b>a</b>'), false, 'the same again draws nothing');
  assert.equal(ctx.drawHTML(el, '<b>b</b>'), true);
  assert.equal(el.draws, 2);
  assert.equal(ctx.drawHTML(null, 'x'), false, 'no element, nothing drawn');
  // Every place of the list, the keypad and a phone's home goes through it.
  const list = cut('function drawContacts(', '// ---------- the keypad');
  assert.match(list, /if \(!drew\) return false; \/\/ the rows as they stand, wired already\n  before\(\);\n  drawHTML\(\$\('#contacts'\), html\);/);
  const keypad = cut('// ---------- the keypad', '// Drag a key (#499)');
  assert.doesNotMatch(keypad.replace('  el.innerHTML = html;', ''), /\.innerHTML =/, 'the keypad and a phone\'s home draw only through drawHTML');
  assert.match(keypad, /drawHTML\(keys, /);
  assert.match(keypad, /drawHTML\(sections, /);
  assert.match(keypad, /drawHTML\(chief, /);
  assert.match(keypad, /if \(!drawHTML\(el, boardLine\(\)\)\) return;/);
});

test('web: a list that stayed as it was is not measured for its glide (#1065)', () => {
  let measured = 0;
  const row = { dataset: { contact: 'a' }, getBoundingClientRect: () => { measured++; return { top: 0 }; }, animate() {} };
  const ctx = vm.createContext({ $$: () => [row], reducedMotion: () => false, Map, Math, NaN });
  vm.runInContext(`${cut('function glideContacts(draw) {', '// A bot\'s row in the list')} this.glideContacts = glideContacts;`, ctx);
  ctx.glideContacts((before) => false);
  assert.equal(measured, 0, 'nothing drawn: no rect is read');
  ctx.glideContacts((before) => { before(); return true; });
  assert.equal(measured, 2, 'drawn: read before and after');
});

test('web: a head\'s clock phase alone is no change (#1065)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${cut('const drawnKey = ', '// Where the window is wide enough')} this.drawHTML = drawHTML;`, ctx);
  const el = box();
  ctx.drawHTML(el, '<svg style="--c:#d85a30;--ph:-2.62s"></svg>');
  assert.equal(ctx.drawHTML(el, '<svg style="--c:#d85a30;--ph:-2.73s"></svg>'), false, 'the head that stands moves on by itself');
  assert.equal(ctx.drawHTML(el, '<svg style="--c:#378add;--ph:-2.73s"></svg>'), true);
});
