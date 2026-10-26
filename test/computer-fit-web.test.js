// A bot's computer fits the window on the web page (#43): the part of public/app.js that sizes its screen, cut out
// and run against a stand-in dialog. The screen is no wider than the height left for it at 4:3 lets it be, so the
// whole dialog is in the window. In a real browser, off and on, in several windows and after a resize:
// test/browser/computer-fit.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element, finders } = require('./web-page');

// The dialog with its screen `screen` tall and everything else in it `rest` tall, in a window `height` tall.
function dialog({ height, screen, rest, open = true, ratio }) {
  const vars = new Map();
  const frame = element({}, { offsetHeight: screen });
  const m = element({ '#screen-frame': frame }, { open, scrollHeight: screen + rest, style: { setProperty: (k, v) => vars.set(k, v), getPropertyValue: (k) => vars.get(k) || '' } });
  const ctx = vm.createContext({ ...finders(m), window: { innerHeight: height }, Math });
  vm.runInContext(`${cut('function fitScreen(m, ratio = 4 / 3) {', '// A bot\'s machine of its own on boat.dev')}\nthis.fitScreen = fitScreen;`, ctx);
  ctx.fitScreen(m, ratio);
  return vars.get('--screen-w') ?? null;
}

test('web: in a window 837 tall the computer\'s screen is 882 wide, under 133 of title and buttons', () => {
  // 837 less the dialog's margin of 40 and border of 2, less 133: 662 for the screen, 882.67 wide at 4:3.
  assert.equal(dialog({ height: 837, screen: 773, rest: 133 }), '882px');
});

test("web: a boat.dev machine's desktop is fitted at its 16:9 (#564)", () => {
  // 662 for the screen, as above: 1176.89 wide at 16:9.
  assert.equal(dialog({ height: 837, screen: 773, rest: 133, ratio: 16 / 9 }), '1176px');
});

test('web: the screen grows again when the window does, measured from what it is now', () => {
  assert.equal(dialog({ height: 1255, screen: 300, rest: 133 }), '1440px', 'the stylesheet keeps it within the dialog');
});

test('web: a note under the screen leaves it less room', () => {
  assert.equal(dialog({ height: 837, screen: 773, rest: 213 }), '776px');
});

test('web: in a window too short for it the screen stays 240 wide, and the dialog scrolls', () => {
  assert.equal(dialog({ height: 300, screen: 500, rest: 200 }), '240px');
});

test('web: a closed dialog is not sized', () => {
  assert.equal(dialog({ height: 837, screen: 773, rest: 133, open: false }), null);
});
