// The row of docked chats on the Projects screen (public/dock-row.js, #691): what a device keeps, the order, how many
// fit, "+N", the open panel always shown, a sideways drag and a phone's sheet. Pure functions, run in node as the page
// loads them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Row = require('../public/dock-row.js');

const bot = (id) => ({ kind: 'bot', id });
const ids = (list) => list.map((p) => p.id);

test('parse: what this device kept, each panel once, or an empty row', () => {
  assert.deepEqual(Row.parse(JSON.stringify({ items: [bot('a'), bot('b'), bot('a')], sheet: 'full' })), { items: [bot('a'), bot('b')], sheet: 'full' });
  assert.deepEqual(Row.parse('not json'), { items: [], sheet: 'half' });
  assert.deepEqual(Row.parse(null), { items: [], sheet: 'half' });
  assert.deepEqual(Row.parse({ items: [{ kind: 'bot' }, { kind: 'Bad kind', id: 'x' }, { kind: 'team', id: 't1' }, 'x'] }).items, [{ kind: 'team', id: 't1' }]);
});

test('add: a new panel goes to the right end; one already there stays where it is', () => {
  const row = [bot('a'), bot('b')];
  assert.deepEqual(ids(Row.add(row, bot('c'))), ['a', 'b', 'c']);
  assert.deepEqual(ids(Row.add(row, bot('a'))), ['a', 'b']);
  assert.deepEqual(Row.add(row, { kind: 'team', id: 'a' }).length, 3, 'a team and a bot with the same id are two panels');
});

test('remove and move keep the others in their order', () => {
  const row = ['a', 'b', 'c', 'd'].map(bot);
  assert.deepEqual(ids(Row.remove(row, bot('b'))), ['a', 'c', 'd']);
  assert.deepEqual(ids(Row.move(row, 0, 3)), ['b', 'c', 'd', 'a']);
  assert.deepEqual(ids(Row.move(row, 3, 1)), ['a', 'd', 'b', 'c']);
  assert.deepEqual(ids(Row.move(row, 1, 9)), ['a', 'c', 'd', 'b']);
});

test('fit: as many as the width holds, room for "+N" when some do not fit, never none', () => {
  assert.equal(Row.fit(2, 1000), 2);
  assert.equal(Row.fit(3, 1040), 3); // 3 x 340 + 2 x 10
  assert.equal(Row.fit(4, 1040), 2); // "+N" takes room
  assert.equal(Row.fit(5, 300), 1);
  assert.equal(Row.fit(0, 1000), 0);
});

test('split: the newest shown, the older under "+N" newest first; the open one never hidden', () => {
  const row = ['a', 'b', 'c', 'd'].map(bot);
  let s = Row.split(row, 2, null);
  assert.deepEqual(ids(s.shown), ['c', 'd']);
  assert.deepEqual(ids(s.hidden), ['b', 'a']);
  s = Row.split(row, 2, bot('a'));
  assert.deepEqual(ids(s.items), ['b', 'c', 'd', 'a'], 'the open one moves to the right end');
  assert.deepEqual(ids(s.shown), ['d', 'a']);
  s = Row.split(row, 2, bot('c'));
  assert.deepEqual(ids(s.items), ['a', 'b', 'c', 'd'], 'shown already: it stays');
});

test('dropAt: a dragged panel lands before the first whose middle is right of its own', () => {
  const middles = [100, 450, 800];
  assert.equal(Row.dropAt(middles, 0, 600), 1);
  assert.equal(Row.dropAt(middles, 0, 900), 2);
  assert.equal(Row.dropAt(middles, 2, 50), 0);
  assert.equal(Row.dropAt(middles, 1, 460), 1);
});

test("sheetAfter: a phone's sheet goes up to full, down to half, and down from half closes it", () => {
  assert.equal(Row.sheetAfter('half', -80), 'full');
  assert.equal(Row.sheetAfter('full', 80), 'half');
  assert.equal(Row.sheetAfter('half', 80), 'closed');
  assert.equal(Row.sheetAfter('full', 10), 'full');
});
