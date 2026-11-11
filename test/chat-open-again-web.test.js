// The chat that is open already, opened again (its key on Home or a project, a notification about it): it stays where
// the owner reads, and is not taken up to the "New" line it got when it came on screen, which stays drawn while the
// chat is open and is far up by then. A chat that comes on screen still goes to its line or its end. The page's own
// placesThread (public/app.js), as show() asks it; test/browser/chat-open-again.cjs checks it in a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut } = require('./web-page');

const page = vm.createContext({});
vm.runInContext(`${cut('const placesThread = ', '\n')}\nthis.placesThread = placesThread;`, page);
const { placesThread } = page;

test('web: the open chat opened again stays where it is', () => {
  assert.equal(placesThread({ panelOnly: false, again: true, hid: false, covered: false }), false);
});

test('web: a chat that comes on screen goes to its line or its end', () => {
  assert.equal(placesThread({ panelOnly: false, again: false, hid: false, covered: false }), true);
});

test('web: a panel opened or closed beside the chat leaves it where it is', () => {
  assert.equal(placesThread({ panelOnly: true, again: false, hid: false, covered: false }), false);
});

test('web: a chat drawn under the panel is placed once the panel leaves it, opened again or not', () => {
  assert.equal(placesThread({ panelOnly: true, again: false, hid: true, covered: false }), true);
  assert.equal(placesThread({ panelOnly: false, again: true, hid: true, covered: false }), true);
  assert.equal(placesThread({ panelOnly: false, again: true, hid: true, covered: true }), false);
});
