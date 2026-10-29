// A project's board as a free canvas (public/board-canvas.js, #783): no two tiles overlap, a covered tile slides down,
// sizes keep their kind's smallest, new tiles take the first free spot, and what botdot accepts as a layout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../public/board-canvas.js');

const clear = (layout) => {
  const ids = Object.keys(layout);
  for (const a of ids) for (const b of ids) if (a < b) assert.ok(!B.hits(layout[a], layout[b]), `${a} and ${b} overlap`);
};

test('kindOf: the known kinds, with an id where the kind names one and none where it does not', () => {
  assert.equal(B.kindOf('calendar'), 'calendar');
  assert.equal(B.kindOf('goal:o1'), 'goal');
  assert.equal(B.kindOf('new-card'), 'new-card');
  assert.equal(B.kindOf('goal'), null);
  assert.equal(B.kindOf('calendar:x'), null);
  assert.equal(B.kindOf('desk:1'), null);
  assert.equal(B.kindOf('room:a/b'), null);
  assert.equal(B.kindOf(''), null);
});

test('fit: whole units, on the canvas, never under the kind\'s smallest', () => {
  assert.deepEqual(B.fit('calendar', [1100.4, -5, 10, 10]), [1200 - 420, 0, 420, 260]);
  assert.deepEqual(B.fit('todo', [10.6, 20.2, 5000, 300]), [0, 20, 1200, 300]);
});

test('settle: the moved tile stays, the one it covers slides below it, and that one pushes the next', () => {
  const layout = { a: [0, 0, 400, 200], b: [0, 216, 400, 200], c: [0, 432, 400, 200] };
  const out = B.settle({ ...layout, a: [0, 100, 400, 200] }, 'a');
  assert.deepEqual(out.a, [0, 100, 400, 200]);
  assert.deepEqual(out.b, [0, 316, 400, 200]);
  assert.deepEqual(out.c, [0, 532, 400, 200]);
  clear(out);
});

test('settle: tiles side by side with the gap stay where they are; nothing is pulled up', () => {
  const layout = { a: [0, 0, 400, 200], b: [416, 0, 400, 200], c: [0, 900, 400, 100] };
  assert.deepEqual(B.settle(layout, 'a'), layout);
});

test('drag: moving onto another pushes it down; resizing from the corner pushes what it grows into', () => {
  const layout = { calendar: [0, 0, 600, 300], todo: [616, 0, 400, 400] };
  const moved = B.drag(layout, 'calendar', null, 500, 0);
  assert.deepEqual(moved.calendar, [500, 0, 600, 300]);
  assert.equal(moved.todo[1], 316);
  clear(moved);
  const grown = B.drag(layout, 'calendar', 'se', 200, 50);
  assert.deepEqual(grown.calendar, [0, 0, 800, 350]);
  assert.equal(grown.todo[1], 366);
  clear(grown);
});

test('drag: from the left edge the right edge stays, and the smallest size holds', () => {
  const out = B.drag({ calendar: [100, 0, 600, 300] }, 'calendar', 'w', 500, 0);
  assert.deepEqual(out.calendar, [280, 0, 420, 300]);
});

test('complete: placed tiles keep their place, a new one goes to the first free spot, unknown tiles are left out', () => {
  const out = B.complete({ calendar: [0, 0, 600, 300], 'goal:gone': [0, 400, 400, 200] }, ['calendar', 'new-card']);
  assert.deepEqual(Object.keys(out).sort(), ['calendar', 'new-card']);
  assert.deepEqual(out.calendar, [0, 0, 600, 300]);
  assert.deepEqual(out['new-card'], [616, 0, 392, 64]);
  clear(out);
});

test('complete: a tile too wide for the row beside goes under the others', () => {
  const out = B.complete({ calendar: [0, 0, 1000, 300] }, ['calendar', 'todo']);
  assert.deepEqual(out.todo, [0, 316, 392, 560]);
});

test('measured: the tiles as they stand, scaled to the canvas, without overlap', () => {
  const out = B.measured({ days: [0, 0, 600, 70], todo: [400, 50, 200, 280], 'x:1': [0, 0, 1, 1] }, 600);
  assert.deepEqual(Object.keys(out).sort(), ['days', 'todo']);
  assert.deepEqual(out.days, [0, 0, 1200, 140]);
  assert.equal(out.todo[1], 156);
  clear(out);
});

test('check: a layout of known tiles and four numbers, fitted; null for none; anything else refused', () => {
  assert.equal(B.check(null), null);
  assert.deepEqual(B.check({ calendar: [0, 0, 10, 10] }), { calendar: [0, 0, 420, 260] });
  assert.throws(() => B.check([]), /layout/);
  assert.throws(() => B.check({ desk: [0, 0, 1, 1] }), /no tile/);
  assert.throws(() => B.check({ calendar: [0, 0, 1] }), /\[x, y, w, h\]/);
  assert.throws(() => B.check({ calendar: [0, 0, 1, 'a'] }), /\[x, y, w, h\]/);
  assert.throws(() => B.check(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`card:c${i}`, [0, 0, 1, 1]]))), /at most/);
});

test('height: the bottom of the lowest tile', () => {
  assert.equal(B.height({}), 0);
  assert.equal(B.height({ a: [0, 10, 5, 20], b: [0, 0, 5, 5] }), 30);
});
