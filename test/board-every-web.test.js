// A tile's pop-up on the web page says how often it refreshes (#42), as the owner chose it; the Chief changes it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut } = require('./web-page');

const words = () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${cut('// How often a tile refreshes, in words', 'function openTilePanel(')}\nthis.refreshLine = refreshLine;`, ctx);
  return ctx.refreshLine;
};

test('web: a tile pop-up says how often the tile refreshes, and nothing for a tile that reads nothing', () => {
  const line = words();
  const change = ' Ask the Chief of Staff to change it.';
  assert.equal(line({ every: 60 }), `Refreshes every minute while the Board is open.${change}`);
  assert.equal(line({ every: 900 }), `Refreshes every 15 minutes while the Board is open.${change}`);
  assert.equal(line({ every: 3600 }), `Refreshes every hour while the Board is open.${change}`);
  assert.equal(line({ every: 7200 }), `Refreshes every 2 hours while the Board is open.${change}`);
  assert.equal(line({ every: 86400 }), `Refreshes every day while the Board is open.${change}`);
  assert.equal(line({ every: 30 }), `Refreshes every 30 seconds while the Board is open.${change}`);
  assert.equal(line({ every: 0 }), `Refreshes only when tapped.${change}`);
  assert.equal(line({}), '', 'an older server, or a tile that reads nothing');
});

test('web: the pop-up draws that line under its blocks', () => {
  const panel = cut('function renderPanel() {', 'function findBlock(');
  assert.match(panel, /refreshLine\(t\)/);
  assert.match(panel, /class="faint tile-every"/);
});
