// The board as a free canvas (#783): the owner sends the whole layout, the Chief places one tile, the server keeps no
// two tiles overlapping, leaves out the tiles of objectives and teams that are gone, and null gives botdot's own back.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, writeData } = require('./helpers');
const B = require('../public/board-canvas.js');

let srv;
before(async () => {
  srv = await startServer();
  writeData(path.join(srv.data, 'company.json'), { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z', objectives: [{ id: 'o1', name: 'Reach 100 users', target: 100, current: 7 }] });
});
after(async () => { await srv.stop(); });

const at = (p) => `${p}?project=p1`;
const put = (body, as = srv.api) => as(at('/company/layout'), { method: 'PUT', body });

test('the server says it has the layout', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-layout'));
});

test('a project never arranged has no layout', async () => {
  assert.equal('layout' in (await srv.api(at('/company'))).data.company, false);
});

test('the owner sends the whole layout: fitted, settled, kept; a gone objective\'s tile is left out', async () => {
  const r = await put({ layout: { calendar: [0, 0, 600, 300], todo: [100, 100, 400, 400], 'goal:o1': [0, 900, 400, 200], 'goal:gone': [0, 2000, 400, 200] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const l = (await srv.api(at('/company'))).data.company.layout;
  assert.deepEqual(Object.keys(l).sort(), ['calendar', 'goal:o1', 'todo']);
  assert.deepEqual(l.calendar, [0, 0, 600, 300]);
  assert.equal(l.todo[1], 316);
  for (const a of Object.keys(l)) for (const b of Object.keys(l)) if (a < b) assert.ok(!B.hits(l[a], l[b]));
});

test('one tile placed by the Chief: the rest slides down below it', async () => {
  const r = await put({ tile: 'todo', x: 0, y: 0 }, srv.asChief);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.layout.todo, [0, 0, 400, 400]);
  assert.equal(r.data.layout.calendar[1], 416);
});

test('a new tile placed without a size takes its kind\'s first size', async () => {
  const r = await put({ tile: 'new-card', x: 800, y: 0 });
  assert.deepEqual(r.data.layout['new-card'], [800, 0, B.KINDS['new-card'].size[0], B.KINDS['new-card'].size[1]]);
});

test('anything else is refused and changes nothing', async () => {
  const was = (await srv.api(at('/company'))).data.company.layout;
  assert.equal((await put({ layout: { desk: [0, 0, 1, 1] } })).status, 400);
  assert.equal((await put({ layout: { calendar: [0, 0] } })).status, 400);
  assert.equal((await put({ tile: 'whiteboard', x: 0, y: 0 })).status, 400);
  assert.equal((await put({ tile: 'chief', x: 0 })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.deepEqual((await srv.api(at('/company'))).data.company.layout, was);
});

test('null gives the board botdot\'s own arrangement again', async () => {
  const r = await put({ layout: null });
  assert.equal(r.status, 200);
  assert.equal('layout' in r.data, false);
});
