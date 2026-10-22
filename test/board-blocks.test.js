// The Board's block kit (#394): kpi, status, callout and the charts' series and bars, checked and filled in by
// lib/tile-blocks.js; the recent values a tile keeps, with their times; and what a tile says of its source.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const blocks = require('../lib/tile-blocks');
const { startServer, makeBot } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const tile = (fields = {}) => ({ id: 't1', kind: 'custom', read: { type: 'http' }, reads: { mail: { type: 'http' } }, ...fields });
const checked = (t, look) => Object.assign(t, blocks.check(look, t));
const H = 3600e3;

test('a kpi: its number with unit and "of", its change and sparkline from the recent values, and a bar', () => {
  const t = checked(tile(), { face: [{ type: 'kpi', bind: 'value.temp', unit: '°C', good: 'up', sub: '{{value.room}}', subColor: 'muted' }, { type: 'kpi', bind: 'value.disk', unit: '%', max: 100, of: '{{value.of}}', spark: false }] });
  const t0 = Date.parse('2026-10-22T08:00:00Z');
  const look = blocks.look(t, {
    data: { value: { temp: 21.5, disk: 62, of: 4, room: 'Living room' } },
    history: { 'value.temp': [20.7, 21, 21.5], 'value.disk': [61, 62] },
    times: { 'value.temp': [t0, t0 + H, t0 + 2 * H], 'value.disk': [t0, t0 + H] },
  });
  assert.deepEqual(look.face[0], {
    type: 'kpi', text: '21.5', unit: '°C', sub: 'Living room', subColor: 'muted',
    points: [20.7, 21, 21.5], times: [t0, t0 + H, t0 + 2 * H],
    delta: { text: '0.8', dir: 'up', good: true }, since: '2026-10-22T08:00:00.000Z',
  });
  assert.equal(look.face[1].ratio, 0.62);
  assert.equal(look.face[1].of, '4');
  assert.equal(look.face[1].points, undefined, 'spark: false');
  assert.deepEqual(look.face[1].delta, { text: '1', dir: 'up', good: true });

  // Kept before times were, or only one value yet: no times, no change.
  const old = blocks.look(t, { data: { value: { temp: 3 } }, history: { 'value.temp': [5, 3] } });
  assert.deepEqual([old.face[0].delta, old.face[0].since, old.face[0].times], [{ text: '2', dir: 'down', good: false }, undefined, undefined]);
  assert.equal(blocks.look(t, { data: { value: { temp: 3 } }, history: { 'value.temp': [3] } }).face[0].delta, undefined);

  assert.throws(() => blocks.check({ face: [{ type: 'kpi', bind: 'value.x', good: 'sideways' }] }, tile()), /good is up, down, none/);
  assert.throws(() => blocks.check({ face: [{ type: 'kpi' }] }, tile()), /bind/);
  assert.deepEqual(blocks.historyPaths(t), ['value.temp', 'value.disk']);
});

test('which way is good news, and how much it changed', () => {
  assert.deepEqual(blocks.deltaOf([3, 5], 'up'), { text: '2', dir: 'up', good: true });
  assert.deepEqual(blocks.deltaOf([3, 5], 'down'), { text: '2', dir: 'up', good: false });
  assert.deepEqual(blocks.deltaOf([3, 5], 'none'), { text: '2', dir: 'up', good: null });
  assert.deepEqual(blocks.deltaOf([5, 5]), { text: '0', dir: 'flat', good: null });
  assert.deepEqual(blocks.deltaOf([0.1, 0.3]), { text: '0.2', dir: 'up', good: true }, 'no float noise');
  assert.deepEqual(blocks.deltaOf([1.234, 1.2]), { text: '0.03', dir: 'down', good: false }, 'two decimals at most');
});

test('status pills and callouts: a level, fixed or from the data, and rules that change it', () => {
  const t = checked(tile(), {
    face: [
      { type: 'status', text: '{{value.state}}', level: '{{value.state|map:ok=ok,failed=err}}' },
      { type: 'status', text: 'Backups', level: 'ok', rules: [{ when: 'value.late', above: 0, set: { level: 'warn', text: 'Late' } }] },
      { type: 'callout', title: 'Waiting for you', text: '{{value.waiting}} updates', level: 'bad' },
      { type: 'callout', text: '{{value.nothing}}' },
    ],
  });
  const look = blocks.look(t, { data: { value: { state: 'failed', late: 2, waiting: 3 } } });
  assert.deepEqual(look.face, [
    { type: 'status', text: 'failed', level: 'err' },
    { type: 'status', text: 'Late', level: 'warn' },
    { type: 'callout', text: '3 updates', level: 'err', title: 'Waiting for you' },
  ], 'bad is err; an empty callout is left out');
  assert.equal(blocks.look(t, { data: { value: { state: 'odd' } } }).face[0].level, 'info', 'a level the data does not know: info');
  assert.throws(() => blocks.check({ face: [{ type: 'status', text: 'x', level: 'purple' }] }, tile()), /a level is one of ok, warn, err, info, plan/);
  assert.throws(() => blocks.check({ face: [{ type: 'callout' }] }, tile()), /write its text/);
});

test('a chart: several series with their recent values and times, a list with labels, horizontal bars', () => {
  const t = checked(tile(), {
    face: [
      { type: 'chart', style: 'area', series: [{ bind: 'value.cpu', label: 'CPU', color: '#3b82f6' }, { bind: 'value.ram', label: 'RAM', color: 'ok' }], unit: '%', label: 'last hour' },
      { type: 'chart', style: 'bar', bind: 'value.runs', item: 'n', labelItem: 'day' },
      { type: 'chart', style: 'hbar', bind: 'mail', unit: 'mails' },
      { type: 'chart', bind: 'value.cpu' },
    ],
  });
  const t0 = 1_700_000_000_000;
  const look = blocks.look(t, {
    data: { value: { cpu: 64, ram: 68, runs: [{ day: 'Mon', n: 3 }, { day: 'Tue', n: 'x' }, { day: 'Wed', n: 5 }] }, mail: { Inbox: 14, Spam: 7, Odd: 'n/a' } },
    history: { 'value.cpu': [50, 60, 64], 'value.ram': [66, 67, 68] },
    times: { 'value.cpu': [t0, t0 + 60e3, t0 + 120e3], 'value.ram': [t0, t0 + 60e3, t0 + 120e3] },
  });
  assert.deepEqual(look.face[0], {
    type: 'chart', style: 'area', points: [50, 60, 64], text: 'last hour', unit: '%', times: [t0, t0 + 60e3, t0 + 120e3],
    series: [{ points: [50, 60, 64], label: 'CPU', color: '#3b82f6' }, { points: [66, 67, 68], label: 'RAM', color: 'ok' }],
  });
  assert.deepEqual(look.face[1], { type: 'chart', style: 'bar', points: [3, 5], labels: ['Mon', 'Tue', 'Wed'] }, 'points (for apps of before) leave the gap out');
  assert.deepEqual(look.face[2], { type: 'chart', style: 'hbar', points: [], bars: [{ label: 'Inbox', text: '14 mails', ratio: 1 }, { label: 'Spam', text: '7 mails', ratio: 0.5 }] });
  assert.deepEqual(look.face[3], { type: 'chart', points: [50, 60, 64], times: [t0, t0 + 60e3, t0 + 120e3] }, 'one line, as before, now with its times');
  assert.deepEqual(blocks.chartPaths(t), ['value.cpu', 'value.ram', 'value.runs'], 'bars keep no history');
  assert.throws(() => blocks.check({ face: [{ type: 'chart', style: 'pie', bind: 'value' }] }, tile()), /style is one of line, area, bar, stacked, hbar/);
  assert.throws(() => blocks.check({ face: [{ type: 'chart', series: [] }] }, tile()), /series is 1 to 4/);
  assert.throws(() => blocks.check({ face: [{ type: 'chart', style: 'hbar', series: [{ bind: 'value' }] }] }, tile()), /not series/);
});

test('a value tile shows how its number changed, good news by its levels', () => {
  const t = { id: 't2', kind: 'value', read: { type: 'http' }, unit: '%', levels: { warn: 80, bad: 95 } };
  assert.deepEqual(blocks.historyPaths(t), ['value']);
  const look = blocks.look(t, { shaped: { text: '62', level: 'ok' }, data: { value: 62 }, history: { value: [60, 62] }, times: { value: [1, 2] } });
  assert.deepEqual(look.face, [{ type: 'value', text: '62', unit: '%', points: [60, 62], times: [1, 2], since: new Date(1).toISOString(), delta: { text: '2', dir: 'up', good: false } }]);
  assert.deepEqual(blocks.look({ ...t, levels: null }, { shaped: { text: '62' }, history: { value: [62] } }).face, [{ type: 'value', text: '62', unit: '%' }], 'one value: as before');
  assert.deepEqual(blocks.historyPaths({ ...t, face: [{ type: 'text', text: 'x' }] }), [], 'its own blocks keep their own');
});

test('the Board keeps each value with its time, says where a value comes from, and what a bot wrote', async () => {
  const bot = await makeBot(srv, { name: 'Summary Bot' });
  const note = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Morning summary', bot: bot.id } })).data;
  const count = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Unread mail', bot: bot.id, value: 12 } })).data;
  assert.equal(count.ai, true, 'the Chief gave it');
  await srv.api(`/dashboard/tiles/${count.id}/value`, { method: 'PUT', body: { value: 14 } });
  const reads = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Disk', bot: bot.id, every: 30, read: { type: 'http', login: 'x', url: 'https://example.invalid/disk' } } })).data;
  const tapOnly = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Load', bot: bot.id, every: 0, read: { type: 'http', login: 'x', url: 'https://example.invalid/load' } } })).data;
  const board = (await srv.api('/dashboard')).data;
  const byId = (id) => board.tiles.find((x) => x.id === id);
  assert.equal(byId(reads.id).source, 'http · 30 s');
  assert.equal(byId(tapOnly.id).source, 'http · on tap');
  assert.equal(byId(reads.id).ai, undefined, 'a tile that reads its value is no one\'s writing');
  assert.equal(byId(count.id).ai, undefined, 'the owner gave it last');
  assert.equal(byId(count.id).source, undefined);
  const face = byId(count.id).look.face[0];
  assert.deepEqual([face.text, face.points, face.delta], ['14', [12, 14], { text: '2', dir: 'up', good: null }]);
  assert.equal(face.times.length, 2);
  assert.ok(Date.parse(face.since) <= Date.now());

  await srv.asChief(`/dashboard/tiles/${note.id}/value`, { method: 'PUT', body: { value: '**Rail strike called off.**' } });
  assert.equal((await srv.api('/dashboard')).data.tiles.find((x) => x.id === note.id).ai, true, 'the Chief wrote it');
  assert.ok((await srv.api('/version')).data.features.includes('board-blocks'));
});
