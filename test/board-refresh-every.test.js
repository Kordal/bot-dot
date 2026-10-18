// How often a tile reads again is the owner's choice, kept with the tile as `every` (#42): seconds, or 0 for
// "only when tapped". A tile read only by hand is still read once, so it shows something, and then only when asked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dashboard = require('../lib/dashboard');

function board() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-every-'));
  const reads = [];
  const d = dashboard.create(dir, { run: async (tile) => { reads.push(tile.title); return '7'; } });
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true })); // after the board saves what waits
  return { d, reads };
}
const script = { type: 'script', script: 'echo 7' };
const tile = (title, extra = {}) => ({ kind: 'value', title, bot: 'b_1', read: script, ...extra });

test('a tile keeps the refresh the owner chose, and the apps see it', () => {
  const { d } = board();
  assert.equal(d.add(tile('Default'), { by: 'you' }).every, 60, 'no choice: every minute');
  assert.equal(d.add(tile('Quarter', { every: 900 }), { by: 'you' }).every, 900);
  assert.equal(d.add(tile('Daily', { every: 86400 }), { by: 'you' }).every, 86400);
  assert.equal(d.add(tile('Too often', { every: 5 }), { by: 'you' }).every, 10, 'at least 10 seconds');
  const manual = d.add(tile('By hand', { every: 0 }), { by: 'you' });
  assert.equal(manual.every, 0, 'only when tapped');
  assert.equal(d.view(d.get(manual.id)).every, 0, 'GET /api/dashboard has it');
  assert.equal(d.list().tiles.find((x) => x.id === manual.id).every, 0);
  const note = d.add({ kind: 'note', title: 'Filled by its bot', value: 'Hi' }, { by: 'you' });
  assert.equal('every' in d.view(d.get(note.id)), false, 'a tile that reads nothing has no refresh to show');

  // Changed later (the Chief's update_tile, or the owner's PUT); other changes keep it.
  assert.equal(d.update(manual.id, { title: 'By hand only' }, { by: 'you' }).every, 0);
  assert.equal(d.update(manual.id, { every: 3600 }, { by: 'you' }).every, 3600);
  assert.equal(d.update(manual.id, { every: 0 }, { by: 'you' }).every, 0);
});

test('a tile read only by hand is read once, then only when tapped; the others when stale', async (t) => {
  const { d, reads } = board();
  const manual = d.add(tile('By hand', { every: 0 }), { by: 'you' });
  d.add(tile('Minute', { every: 60 }), { by: 'you' });
  await d.refresh();
  assert.deepEqual(reads.sort(), ['By hand', 'Minute'], 'read once, so it shows something');

  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  Date.now = () => realNow() + 2 * 86400_000;
  reads.length = 0;
  await d.refresh();
  assert.deepEqual(reads, ['Minute'], 'two days on, only the timed tile is read again');

  reads.length = 0;
  const tapped = await d.tap(manual.id);
  assert.deepEqual(reads, ['By hand'], 'a tap reads it');
  assert.equal(tapped.value.text, '7');
});
