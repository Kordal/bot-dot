// A project's folder follows its name (#865, ADR 135): the move on the computer comes first, the list after it, and a
// list that can't follow puts the folder back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.BOT_DOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-follow-'));
const P = require('../lib/projects');
const PF = require('../lib/project-folder');
const write = (list) => fs.writeFileSync(P.FILE, JSON.stringify(list));
const read = () => JSON.parse(fs.readFileSync(P.FILE, 'utf8'));

function fakeComputers(answer) {
  const scripts = [];
  return { scripts, inspect: async () => ({ state: 'running' }), ensure: async () => {}, runShell: async (seat, { command }) => { scripts.push(command); return { code: 0, stdout: answer(command, scripts.length) }; } };
}

test('the names: as at its making, " (n)" kept, other projects\' names skipped', () => {
  write([{ name: 'Old', bots: [], project: 'p1' }, { name: 'New', bots: [], project: 'p2' }]);
  assert.equal(P.follows('p1', 'Old'), null);
  assert.deepEqual(P.follows('p1', 'New/Shop').to.slice(0, 2), ['New Shop', 'New Shop (2)']);
  assert.deepEqual(P.follows('p1', 'New').to.slice(0, 1), ['New (2)'], 'another project has New');
  write([{ name: 'New (3)', bots: [], project: 'p1' }]);
  assert.equal(P.follows('p1', 'New'), null, '"New (3)" carries the name');
  assert.equal(P.follows('nope', 'X'), null);
});

test('moved, then the list follows', async () => {
  write([{ name: 'Old', bots: [], project: 'p1' }]);
  const c = fakeComputers(() => 'moved New\n');
  assert.equal(await PF.create({ computers: c }).follow('p1', 'New'), 'renamed');
  assert.equal(read()[0].name, 'New');
  assert.match(c.scripts[0], /mv -T -- '\/workspace\/projects\/Old' '\/workspace\/projects\/New'/);
});

test('a list that changed meanwhile puts the folder back', async () => {
  write([{ name: 'Old', bots: [], project: 'p1' }]);
  const c = fakeComputers((cmd, n) => {
    if (n === 1) { write([{ name: 'Old', bots: [], project: 'p1' }, { name: 'New', bots: [], project: 'p9' }]); return 'moved New\n'; }
    return 'moved Old\n';
  });
  assert.equal(await PF.create({ computers: c }).follow('p1', 'New'), 'later');
  assert.equal(read()[0].name, 'Old');
  assert.match(c.scripts[1], /mv -T -- '\/workspace\/projects\/New' '\/workspace\/projects\/Old'/);
});

test('busy, off or no free name: nothing moves', async () => {
  write([{ name: 'Old', bots: [], project: 'p1' }]);
  const c = fakeComputers(() => 'taken\n');
  const f = PF.create({ computers: c });
  assert.equal(await f.follow('p1', 'New', () => true), 'later');
  assert.equal(c.scripts.length, 0);
  assert.equal(await f.follow('p1', 'New'), 'later');
  assert.equal(read()[0].name, 'Old');
  const off = { ...fakeComputers(() => ''), inspect: async () => ({ state: 'exited' }) };
  assert.equal(await PF.create({ computers: off }).follow('p1', 'New'), 'later');
  assert.equal(off.scripts.length, 0);
});

test('the move script never moves over anything and quotes names', () => {
  const s = P.moveScript("It's", ['A', 'A (2)']);
  assert.match(s, /\[ ! -e '\/workspace\/projects\/A' \] && \[ ! -L '\/workspace\/projects\/A' \]/);
  assert.match(s, /'\/workspace\/projects\/It'\\''s'/);
  assert.match(s, /echo taken$/);
});
